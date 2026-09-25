import { boundedPercent, type ConsoleOverview } from "@/lib/console-contract"
import type { ConsoleSessionActor } from "@/lib/console-session"
import { computeConsoleMode } from "@/lib/console-mode"
import { evaluateConsoleAccess, getConsoleSettings } from "@/lib/console-access"
import { detectConsoleOsFamily } from "@/lib/console-resolution"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"

function percent(used: number, total: number) {
  return total > 0 ? boundedPercent((used / total) * 100) : 0
}

function numeric(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]).catch(() => null)
}

export async function getConsoleOverview(instanceId: string, actor: ConsoleSessionActor): Promise<ConsoleOverview | null> {
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id: instanceId }, { orderId: instanceId }],
      ...(actor.type === "client" ? { customerId: actor.customerId } : {}),
      deletedAt: null,
      status: { not: "DELETED" },
      order: { deletedAt: null },
    },
    include: {
      proxmoxNode: true,
      product: { select: { metadata: true } },
      operatingSystem: {
        select: {
          name: true,
          slug: true,
          osType: true,
          category: true,
          osFamily: true,
          osVersion: true,
          consoleType: true,
          proxmoxTemplateName: true,
          proxmoxConfig: true,
        },
      },
      order: {
        select: {
          osName: true,
          proxmoxNode: true,
          operatingSystem: {
            select: {
              name: true,
              slug: true,
              osType: true,
              category: true,
              osFamily: true,
              osVersion: true,
              consoleType: true,
              proxmoxTemplateName: true,
              proxmoxConfig: true,
            },
          },
        },
      },
    },
  })
  if (!vps) return null

  const node = vps.proxmoxNode || await prisma.proxmoxNode.findFirst({
    where: { OR: [{ id: vps.order.proxmoxNode || "" }, { nodeName: vps.order.proxmoxNode || "" }] },
  })
  const os = vps.operatingSystem || vps.order.operatingSystem
  const osInput = os ? { ...os, name: os.name || vps.order.osName } : { name: vps.order.osName }
  const osFamily = detectConsoleOsFamily(osInput)

  let runtime: Record<string, any> | null = null
  let config: Record<string, any> | null = null
  if (node) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
    })
    ;[runtime, config] = await Promise.all([
      withTimeout(client.getVMStatus(node.nodeName, vps.vmid), 4_500),
      withTimeout(client.getVMConfig(node.nodeName, vps.vmid), 4_500),
    ])
  }

  const mode = computeConsoleMode({
    targetKind: "qemu",
    vmConfig: config,
    osName: os?.name || vps.order.osName,
    osSlug: os?.slug,
    osType: os?.osType || os?.osFamily,
    osCategory: os?.category,
    templateName: os?.proxmoxTemplateName,
    templateConfig: os?.proxmoxConfig,
  })
  const access = evaluateConsoleAccess(await getConsoleSettings(), vps, mode)
  const availableModes = [
    ...(access.graphical ? ["vnc" as const] : []),
    ...(osFamily !== "windows" && access.terminal ? ["serial" as const] : []),
  ]
  const defaultMode = availableModes.includes(mode.defaultMode) ? mode.defaultMode : availableModes[0] || null

  const ramUsedBytes = numeric(runtime?.mem)
  const ramTotalBytes = numeric(runtime?.maxmem)
  const diskUsedBytes = numeric(runtime?.disk)
  const diskTotalBytes = numeric(runtime?.maxdisk)
  const status = String(runtime?.status || vps.status || "unknown").toLowerCase()

  return {
    success: true,
    id: vps.id,
    serverName: vps.name,
    status,
    node: node?.nodeName || node?.name || null,
    datacenter: node?.location || null,
    vmid: vps.vmid,
    ipAddress: vps.ipAddress || null,
    os: os?.name || vps.order.osName || "Unknown",
    osFamily,
    uptimeSeconds: numeric(runtime?.uptime),
    metrics: {
      cpuPercent: boundedPercent(numeric(runtime?.cpu) * 100),
      ramPercent: percent(ramUsedBytes, ramTotalBytes),
      ramUsedBytes,
      ramTotalBytes,
      diskPercent: percent(diskUsedBytes, diskTotalBytes),
      diskUsedBytes,
      diskTotalBytes,
      networkInBytes: numeric(runtime?.netin),
      networkOutBytes: numeric(runtime?.netout),
    },
    freshness: runtime ? "live" : node ? "stale" : "offline",
    observedAt: new Date().toISOString(),
    availableModes,
    defaultMode,
  }
}
