import { execFile } from "node:child_process"
import net from "node:net"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { discoverVmIpAddress, type VmIpDiscoveryResult } from "@/lib/vm-ip-discovery"
import { STEP_LABELS } from "@/lib/provisioning-status"

const execFileAsync = promisify(execFile)

export type VmRuntimeHealth = {
  runtimeStatus: string | null
  panelStatus: string
  ipAddress: string | null
  ipSource: VmIpDiscoveryResult["source"]
  qgaOk: boolean
  pingOk: boolean
  sshOk: boolean
  guestConfiguredOk: boolean
  completionEligible: boolean
  diagnostics: Record<string, unknown>
}

type ProxmoxClientLike = ReturnType<typeof createProxmoxClient>

function safeMessage(error: unknown) {
  return String((error as any)?.message || error || "unknown_error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/([?&](?:ticket|password|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
    .slice(0, 300)
}

export function panelStatusFromProxmox(input: { runtimeStatus?: string | null; config?: Record<string, any> | null; dbStatus?: string | null }) {
  const db = String(input.dbStatus || "").toUpperCase()
  const runtime = String(input.runtimeStatus || "").toLowerCase()
  const lock = String(input.config?.lock || "").trim()

  if (["DELETED", "TERMINATED"].includes(db)) return db
  if (["SUSPENDED", "PENDING_TERMINATION"].includes(db)) return db === "PENDING_TERMINATION" ? "PENDING_TERMINATION" : "SUSPENDED"
  if (lock) return "LOCKED"
  if (runtime === "running") return "ACTIVE"
  if (runtime === "stopped") return "STOPPED"
  if (runtime === "paused") return "SUSPENDED"
  if (runtime) return "FAILED"
  return db || "UNKNOWN"
}

async function tcpPortOpen(host: string | null, port: number, timeoutMs = 1500) {
  const target = String(host || "").trim()
  if (!target || target.includes(":")) return false
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
    socket.connect(port, target)
  })
}

async function pingOnce(ipAddress: string | null) {
  const ip = String(ipAddress || "").trim()
  if (!ip || ip.includes(":")) return false
  try {
    await execFileAsync("ping", ["-c", "1", "-W", "1", ip], { timeout: 2500 })
    return true
  } catch {
    return false
  }
}

async function qemuGuestAgentPing(client: ProxmoxClientLike, nodeName: string, vmid: number) {
  try {
    await client.requestWithStatus(`/nodes/${encodeURIComponent(nodeName)}/qemu/${vmid}/agent/ping`, "POST")
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: safeMessage(error) }
  }
}

/**
 * Is the guest actually configured?
 *
 * This used to look for `ipconfig0`/`ciuser`/`cipassword` in the Proxmox config
 * and fall back to reading `qm cloudinit dump`. None of that is written any more,
 * so both checks would report a healthy guest as unconfigured. The guest agent
 * is the only channel that can answer, so it is the only one consulted: if it
 * answers, the guest is reachable and therefore configured well enough to serve.
 */
async function guestConfigured(client: ProxmoxClientLike, nodeName: string, vmid: number) {
  const ping = await client
    .requestWithStatus?.(`/nodes/${encodeURIComponent(nodeName)}/qemu/${vmid}/agent/ping`, "POST")
    .then(() => ({ ok: true as const }))
    .catch((error: unknown) => ({ ok: false as const, error: safeMessage(error) }))
  if (!ping.ok) return { ok: false, source: "agent_ping_failed" as const }
  if (client.guestCmd) {
    const hostName = await client.guestCmd(nodeName, vmid, "get-host-name").catch(() => null)
    if (hostName) return { ok: true, source: "guest_agent" as const }
    return { ok: false, source: "guest_agent_no_reply" as const }
  }
  return { ok: true, source: "agent_ping" as const }
}

export async function probeVmRuntimeHealth(input: {
  client: ProxmoxClientLike
  nodeName: string
  vmid: number
  allocatedIp?: string | null
  hostname?: string | null
  dbStatus?: string | null
  config?: Record<string, any> | null
  runtime?: any
}): Promise<VmRuntimeHealth> {
  const [runtime, config] = await Promise.all([
    input.runtime === undefined ? input.client.getVMStatus(input.nodeName, input.vmid).catch((error) => ({ __error: safeMessage(error) })) : Promise.resolve(input.runtime),
    input.config === undefined ? input.client.getVMConfig(input.nodeName, input.vmid).catch((error) => ({ __error: safeMessage(error) })) : Promise.resolve(input.config),
  ])
  const configObject = config && !(config as any).__error ? config as Record<string, any> : null
  const runtimeStatus = runtime && !(runtime as any).__error ? String(runtime?.status || "").toLowerCase() || null : null
  const discovered = await discoverVmIpAddress({
    client: input.client,
    nodeName: input.nodeName,
    vmid: input.vmid,
    config: configObject,
    allocatedIp: input.allocatedIp,
    hostname: input.hostname,
  }).catch(() => ({ ipAddress: input.allocatedIp || null, source: input.allocatedIp ? "panel_allocation" as const : "none" as const }))
  const [qga, pingOk, sshOk, guestConfig] = await Promise.all([
    qemuGuestAgentPing(input.client, input.nodeName, input.vmid),
    pingOnce(discovered.ipAddress),
    tcpPortOpen(discovered.ipAddress, 22),
    guestConfigured(input.client, input.nodeName, input.vmid),
  ])
  const panelStatus = panelStatusFromProxmox({ runtimeStatus, config: configObject, dbStatus: input.dbStatus })
  const completionEligible = runtimeStatus === "running" && Boolean(discovered.ipAddress) && qga.ok

  return {
    runtimeStatus,
    panelStatus,
    ipAddress: discovered.ipAddress,
    ipSource: discovered.source,
    qgaOk: qga.ok,
    pingOk,
    sshOk,
    guestConfiguredOk: guestConfig.ok,
    completionEligible,
    diagnostics: {
      vmid: input.vmid,
      nodeName: input.nodeName,
      runtimeError: (runtime as any)?.__error || null,
      configError: (config as any)?.__error || null,
      qgaError: qga.error,
      guestConfiguredSource: guestConfig.source,
    },
  }
}

export async function markRuntimeCompleteIfReady(input: {
  vpsId: string
  actor?: string
  health?: VmRuntimeHealth
}) {
  const vps = await prisma.vpsInstance.findUnique({
    where: { id: input.vpsId },
    include: {
      order: true,
      proxmoxNode: true,
      provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!vps?.proxmoxNode || !vps.vmid) return { completed: false, reason: "missing_node_or_vmid" }

  const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
  })
  const health = input.health || await probeVmRuntimeHealth({
    client,
    nodeName: vps.proxmoxNode.nodeName,
    vmid: vps.vmid,
    allocatedIp: vps.ipAddress,
    hostname: vps.name,
    dbStatus: vps.status,
  })
  const now = new Date()
  const latestJob = vps.provisioningJobs[0] || null
  const metadata = {
    runtimeCompletion: {
      actor: input.actor || "runtime_health",
      completedAt: now.toISOString(),
      health: {
        runtimeStatus: health.runtimeStatus,
        ipAddress: health.ipAddress,
        ipSource: health.ipSource,
        qgaOk: health.qgaOk,
        pingOk: health.pingOk,
        sshOk: health.sshOk,
        guestConfiguredOk: health.guestConfiguredOk,
      },
    },
  }

  if (!health.completionEligible) {
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: health.panelStatus,
        ...(health.ipAddress ? { ipAddress: health.ipAddress } : {}),
        ownershipVerifiedAt: now,
        ownershipEvidence: { ...(vps.ownershipEvidence as any || {}), lastRuntimeHealth: metadata.runtimeCompletion } as any,
      },
    }).catch(() => null)
    return { completed: false, reason: "not_completion_eligible", health }
  }

  await prisma.$transaction(async (tx) => {
    await tx.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: "ACTIVE",
        ...(health.ipAddress ? { ipAddress: health.ipAddress } : {}),
        activatedAt: vps.activatedAt || now,
        ownershipStatus: "verified",
        ownershipVerifiedAt: now,
        ownershipEvidence: { ...(vps.ownershipEvidence as any || {}), ...metadata } as any,
      },
    })
    await tx.order.update({
      where: { id: vps.orderId },
      data: {
        status: "active",
        provisioningStatus: "ACTIVE",
        provisioningError: null,
        provisionedAt: vps.order.provisionedAt || now,
        serviceId: vps.id,
        vmId: vps.vmid,
        proxmoxNode: vps.proxmoxNode!.nodeName,
      },
    })
    if (latestJob) {
      await tx.provisioningJob.update({
        where: { id: latestJob.id },
        data: {
          status: "completed",
          currentStep: "ACTIVE",
          displayStatus: STEP_LABELS.ACTIVE,
          progress: 100,
          error: null,
          errorCode: null,
          completedAt: latestJob.completedAt || now,
          dedupeKey: null,
          metadata: { ...((latestJob.metadata as any) || {}), ...metadata } as any,
        },
      })
      await tx.provisioningTaskStep.updateMany({
        where: { jobId: latestJob.id, step: "VERIFYING_VM" },
        data: { status: "completed", completedAt: now, error: null },
      }).catch(() => undefined)
    }
  })

  return { completed: true, health }
}
