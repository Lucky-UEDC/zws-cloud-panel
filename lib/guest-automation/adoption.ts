/**
 * Adopting an existing server into guest automation.
 *
 * Most servers on this platform were configured by Cloud-Init before it was
 * removed. Adopting one means answering three questions and recording them:
 * what OS does the guest actually report, which template matches it, and does
 * the guest agent answer at all.
 *
 * What adoption deliberately does not do is reconfigure anything. Rewriting a
 * running customer's network as a side effect of "let us manage this server" is
 * how a control panel takes production offline. Adoption is a read and a record;
 * the first actual change is a separate, explicit, verified request — and it goes
 * through the same change-driven plan as every other change, so a server that
 * already has the right value is left alone.
 */

import { prisma } from "@/lib/db"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { persistDetection } from "@/lib/guest-automation/os-detection"
import { createPanelLog } from "@/lib/panel-log"
import { GUEST_ERROR_MESSAGES } from "@/lib/guest-automation/constants"
import { UNAVAILABLE_DETECTION } from "@/lib/guest-automation/os-detection"

export type AdoptionOutcome =
  | {
      ok: true
      /** The guest answered and we have an OS. */
      vpsInstanceId: string
      os: { id: string; name: string | null; version: string | null; kernelVersion: string | null; engine: "linux" | "windows" }
      template: { id: string; name: string; version: number } | null
      supportedOperations: string[]
      automationReady: boolean
      /** The guest's current state, recorded so a later plan can be change-driven. */
      observed: { hostname: string | null; primaryInterface: string | null; ipv4: string[]; users: string[]; filesystems: number }
      /** Why adoption could not complete, when it could not. */
      unsupportedReason: string | null
    }
  | {
      ok: false
      vpsInstanceId: string
      code: "GUEST_AGENT_UNREACHABLE" | "OS_DETECTION_UNAVAILABLE" | "OS_UNSUPPORTED" | "VM_STOPPED" | "NO_INFRASTRUCTURE"
      message: string
      /** What an admin should actually do, which is never "try again". */
      remedy: string
    }

/**
 * Detect and record. No configuration is applied.
 */
export async function adoptVpsIntoGuestAutomation(input: {
  vps: {
    id: string
    vmid: number | null
    status: string
    operatingSystemId?: string | null
    proxmoxNode: { nodeName: string; host: string; tokenId: string; tokenSecret: string; allowInsecureTls: boolean | null } | null
  }
  actorEmail: string
  /** Also read the guest's current state, so the first plan can be change-driven. */
  observe?: boolean
}): Promise<AdoptionOutcome> {
  const { vps } = input
  if (!vps.proxmoxNode || !vps.vmid) {
    return {
      ok: false,
      vpsInstanceId: vps.id,
      code: "NO_INFRASTRUCTURE",
      message: "This server is not on a compute node, so there is nothing to adopt.",
      remedy: "Import the server onto a node first, then adopt it.",
    }
  }

  const service = new GuestAutomationService(
    guestContextFor({ vpsInstanceId: vps.id, vmid: vps.vmid, node: vps.proxmoxNode }),
  )

  const running = await service.isRunning()
  if (!running) {
    await persistDetection({
      vpsInstanceId: vps.id,
      osTemplateId: (vps as any).operatingSystemId ?? null,
      detected: { ...UNAVAILABLE_DETECTION, source: "unavailable" },
      guestAgentReachable: false,
      automationReady: false,
      unsupportedReason: GUEST_ERROR_MESSAGES.VM_STOPPED,
    })
    return {
      ok: false,
      vpsInstanceId: vps.id,
      code: "VM_STOPPED",
      message: "The server is stopped, so it cannot report what it is running.",
      remedy: "Start the server, then adopt it. Nothing will be reconfigured either way.",
    }
  }

  const detected = await service.detectOs(null)
  if (detected.kind === "unknown") {
    await persistDetection({
      vpsInstanceId: vps.id,
      osTemplateId: null,
      detected,
      guestAgentReachable: false,
      automationReady: false,
      unsupportedReason: GUEST_ERROR_MESSAGES.OS_DETECTION_UNAVAILABLE,
    })
    return {
      ok: false,
      vpsInstanceId: vps.id,
      code: "OS_DETECTION_UNAVAILABLE",
      message: GUEST_ERROR_MESSAGES.OS_DETECTION_UNAVAILABLE,
      // The most common cause by far: an image with no guest agent. Saying so
      // turns an opaque failure into one install command.
      remedy: "The QEMU guest agent is probably not installed in this image. Install it inside the guest, or adopt a server cloned from a template that has it.",
    }
  }

  const resolved = await service.getTemplate(detected)
  const template = resolved.ok ? { id: resolved.template.id, name: resolved.template.name, version: resolved.template.version } : null

  let observed: { hostname: string | null; primaryInterface: string | null; ipv4: string[]; users: string[]; filesystems: number } =
    { hostname: null, primaryInterface: null, ipv4: [], users: [], filesystems: 0 }
  let guestAgentReachable = false
  if (input.observe !== false && resolved.ok) {
    const state = await service.getState(detected.engine)
    observed = {
      hostname: state.hostname || null,
      primaryInterface: state.primaryInterface || null,
      ipv4: state.ipv4,
      users: state.users,
      filesystems: state.diskMounts?.length ?? 0,
    }
    guestAgentReachable = state.ipv4.length > 0 || Boolean(state.hostname)
  }

  await persistDetection({
    vpsInstanceId: vps.id,
    // The panel's own OS catalogue row, not the guest profile. They are
    // different things: one is which image it was cloned from, the other is
    // which guest profile will be used to configure it.
    osTemplateId: (vps as any).operatingSystemId ?? null,
    detected,
    guestAgentReachable,
    // Adoption makes a server manageable. It does not make it configured, and it
    // does not claim the configuration is correct.
    automationReady: Boolean(resolved.ok && guestAgentReachable),
    unsupportedReason: resolved.ok ? null : resolved.reason,
    state: observed,
  })

  if (resolved.ok) {
    await prisma.vmGuestAdoption.update({
      where: { vpsInstanceId: vps.id },
      data: { guestTemplateId: resolved.template.id, appliedTemplateVersion: resolved.template.version },
    }).catch(() => null)
  }

  await createPanelLog({
    category: "Guest Automation",
    message: resolved.ok ? `Server adopted into guest automation: ${detected.osId}` : `Server adoption incomplete: ${detected.osId}`,
    actorType: "admin",
    actorEmail: input.actorEmail,
    vpsInstanceId: vps.id,
    // Observed state, not commands. Recording the address, gateway and DNS the
    // guest reports is what makes the first real plan change-driven.
    metadata: {
      os: detected.osId,
      version: detected.version,
      engine: detected.engine,
      template: template?.name || null,
      templateVersion: template?.version || null,
      supported: resolved.ok,
      reason: resolved.ok ? null : resolved.reason,
      observed,
    },
  }).catch(() => null)

  if (!resolved.ok) {
    return {
      ok: false,
      vpsInstanceId: vps.id,
      code: "OS_UNSUPPORTED",
      message: resolved.reason,
      remedy: `No enabled guest automation template claims "${detected.osId}". Add one under Infrastructure → OS Guest Automation, or accept that this server stays unmanaged.`,
    }
  }

  return {
    ok: true,
    vpsInstanceId: vps.id,
    os: {
      id: detected.osId || "unknown",
      name: detected.name,
      version: detected.version,
      kernelVersion: detected.kernelVersion,
      engine: detected.engine as "linux" | "windows",
    },
    template,
    supportedOperations: [...resolved.template.operations.values()].filter((entry) => entry.enabled).map((entry) => entry.operation),
    automationReady: Boolean(guestAgentReachable),
    observed,
    unsupportedReason: null,
  }
}

/** Every server with an adoption record, for the admin list. */
export async function listAdoptions(options: { readyOnly?: boolean } = {}) {
  return prisma.vmGuestAdoption.findMany({
    where: options.readyOnly ? { automationReady: true } : undefined,
    include: { guestTemplate: { select: { id: true, name: true, version: true, engine: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  })
}

/** How many servers are managed, and how many are still outside automation. */
export async function adoptionSummary() {
  const totalServers = await prisma.vpsInstance.count({ where: { deletedAt: null, status: { not: "DELETED" }, vmid: { gt: 0 } } })
  const [ready, unreachable, unsupported, recovery] = await Promise.all([
    prisma.vmGuestAdoption.count({ where: { automationReady: true } }),
    prisma.vmGuestAdoption.count({ where: { guestAgentReachable: false } }),
    prisma.vmGuestAdoption.count({ where: { NOT: { unsupportedReason: null } } }),
    prisma.vmGuestAdoption.count({ where: { recoveryRequired: true } }),
  ])
  return {
    totalServers,
    adopted: ready + unreachable + unsupported,
    ready,
    notAdopted: Math.max(0, totalServers - ready - unreachable - unsupported),
    guestAgentUnreachable: unreachable,
    unsupported,
    recoveryRequired: recovery,
  }
}
