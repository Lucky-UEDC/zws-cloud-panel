import { prisma } from "@/lib/db"
import { safeJson } from "@/lib/safe-json"
import { instanceDisplayName, internalVmHostname } from "@/lib/vm-hostname"

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}

function hasReportedDiskUsage(metric: any) {
  const usedBytes = numberValue(metric?.diskUsedBytes)
  const totalBytes = numberValue(metric?.diskTotalBytes)
  if (usedBytes > 0 && totalBytes > 0) return true
  const usage = metric?.metadata?.diskUsage
  return Boolean(usage?.ok && numberValue(usage?.totalBytes) > 0 && numberValue(usage?.usedBytes) === 0)
}

export async function loadCachedVmSnapshot(id: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], deletedAt: null },
    include: {
      proxmoxNode: { select: { id: true, nodeName: true, location: true } },
      order: { select: { id: true, status: true } },
    },
  })
  if (!vps) {
    const error = new Error("VM not found")
    ;(error as any).status = 404
    throw error
  }

  const [networkCache, legacyNetwork, metric, state, runtime] = await Promise.all([
    (prisma as any).vmNetworkCache.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null),
    (prisma as any).vmNetwork.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null),
    (prisma as any).vmMetricsCache.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null),
    (prisma as any).vmStateCache.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null),
    (prisma as any).vmRuntime.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null),
  ])
  const network = networkCache || legacyNetwork
  const runtimeStatus = String(metric?.runtimeStatus || state?.runtimeStatus || runtime?.runtimeStatus || "").toLowerCase()
  const powerState = String(state?.powerState || runtime?.powerState || runtimeStatus || "unknown").toLowerCase()
  const ramUsedBytes = numberValue(metric?.ramUsedBytes)
  const ramTotalBytes = numberValue(metric?.ramTotalBytes)
  const diskReported = hasReportedDiskUsage(metric)
  const diskUsedBytes = diskReported ? numberValue(metric?.diskUsedBytes) : 0
  const diskTotalBytes = diskReported ? numberValue(metric?.diskTotalBytes) : 0
  const diskFreeBytes = diskReported ? numberValue(metric?.diskFreeBytes) || Math.max(0, diskTotalBytes - diskUsedBytes) : 0

  return safeJson({
    source: "db-cache",
    generatedAt: new Date().toISOString(),
    vpsInstanceId: vps.id,
    orderId: vps.orderId,
    customerId: vps.customerId,
    vmid: Number(vps.vmid || 0),
    node: runtime?.nodeName || vps.proxmoxNode?.nodeName || null,
    proxmoxNodeId: vps.proxmoxNodeId || null,
    status: state?.status || runtime?.status || vps.status || "UNKNOWN",
    runtimeStatus: runtimeStatus || null,
    powerState,
    cpuPercent: numberValue(metric?.cpuPercent),
    ramUsedBytes,
    ramTotalBytes,
    ramPercent: percent(ramUsedBytes, ramTotalBytes),
    diskUsedBytes,
    diskTotalBytes,
    diskFreeBytes,
    diskPercent: percent(diskUsedBytes, diskTotalBytes),
    diskReadBytes: numberValue(metric?.diskReadBytes),
    diskWriteBytes: numberValue(metric?.diskWriteBytes),
    networkInBytes: numberValue(metric?.networkInBytes),
    networkOutBytes: numberValue(metric?.networkOutBytes),
    rxRateBps: numberValue(metric?.rxRateBps),
    txRateBps: numberValue(metric?.txRateBps),
    ipAddress: network?.primaryAssignedIp || null,
    instanceName: instanceDisplayName(vps),
    hostname: internalVmHostname(vps, network?.primaryAssignedIp || vps.ipAddress || null),
    ipSource: network?.primaryAssignedIp ? "vm_network_cache" : "none",
    agentStatus: runtimeStatus === "running" ? "cached" : "offline",
    networkStatus: network?.primaryAssignedIp ? "assigned" : "unassigned",
    networkIps: network?.primaryAssignedIp ? [network.primaryAssignedIp] : [],
    uptimeSeconds: numberValue(metric?.uptimeSeconds),
    configAvailable: Boolean(state?.proxmoxState),
    freshness: {
      state: metric?.staleAfter && new Date(metric.staleAfter).getTime() >= Date.now() ? "LIVE" : metric?.recordedAt ? "STALE" : "OFFLINE",
      lastUpdatedAt: metric?.recordedAt?.toISOString ? metric.recordedAt.toISOString() : metric?.recordedAt || null,
    },
    raw: {
      state: state?.proxmoxState || null,
      databaseState: state?.databaseState || null,
    },
    error: state?.lastError || null,
  })
}
