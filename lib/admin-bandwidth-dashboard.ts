import { bucketStart, tbToBytes } from "@/lib/bandwidth-accounting"
import { prisma } from "@/lib/db"
import { aggregateLiveBandwidthNodes, bytesPerSecondToKbps, bytesPerSecondToMbps, liveBandwidthState } from "@/lib/live-bandwidth"

export type AdminBandwidthDashboard = Awaited<ReturnType<typeof loadAdminBandwidthDashboard>>

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toIso(value: any) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value?.toISOString === "function") return value.toISOString()
  return String(value)
}

function productIncludedBytes(product: any, rollup: any) {
  const rollupIncluded = numberValue(rollup?.includedBytes)
  if (rollupIncluded > 0) return rollupIncluded
  return Number(tbToBytes(product?.bandwidthTb || 0))
}

export async function loadAdminBandwidthDashboard() {
  const monthBucket = bucketStart("month")
  const dayBucket = bucketStart("day")
  const [
    activeVpsRows,
    vpsRollups,
    nodeRollups,
    latestSamples,
    throttleRows,
    alerts,
    monthlyTotals,
    dailyTotals,
    activeVmCounts,
  ] = await Promise.all([
    prisma.vpsInstance.findMany({
      where: { deletedAt: null, proxmoxNodeId: { not: null }, vmid: { gt: 0 } },
      orderBy: { createdAt: "asc" },
      take: 500,
      include: {
        customer: { select: { id: true, name: true, email: true } },
        product: { select: { id: true, name: true, bandwidthTb: true } },
        proxmoxNode: { select: { id: true, name: true, nodeName: true } },
        bandwidthThrottleState: true,
      },
    }).catch(() => []),
    (prisma as any).bandwidthUsageRollup.findMany({
      where: { period: "month", scopeType: "vps", bucketAt: monthBucket },
      orderBy: { totalBytes: "desc" },
      take: 500,
      include: {
        vpsInstance: {
          include: {
            customer: { select: { id: true, name: true, email: true } },
            product: { select: { id: true, name: true, bandwidthTb: true } },
            proxmoxNode: { select: { id: true, name: true, nodeName: true } },
            bandwidthThrottleState: true,
          },
        },
      },
    }).catch(() => []),
    (prisma as any).bandwidthUsageRollup.findMany({
      where: { period: "month", scopeType: "node", bucketAt: monthBucket },
      orderBy: { totalBytes: "desc" },
      take: 100,
    }).catch(() => []),
    (prisma as any).bandwidthUsageSample.findMany({
      orderBy: { recordedAt: "desc" },
      take: 1000,
      select: { vpsInstanceId: true, rxRateBps: true, txRateBps: true, peakRateBps: true, recordedAt: true },
    }).catch(() => []),
    (prisma as any).bandwidthThrottleState.findMany({ where: { status: "throttled" } }).catch(() => []),
    (prisma as any).bandwidthUsageAlert.findMany({
      where: { status: "open" },
      orderBy: { lastSeenAt: "desc" },
      take: 50,
    }).catch(() => []),
    (prisma as any).bandwidthUsageRollup.aggregate({
      where: { period: "month", scopeType: "vps", bucketAt: monthBucket },
      _sum: { rxBytes: true, txBytes: true, totalBytes: true, estimatedInr: true },
      _max: { peakRateBps: true },
    }).catch(() => null),
    (prisma as any).bandwidthUsageRollup.aggregate({
      where: { period: "day", scopeType: "vps", bucketAt: dayBucket },
      _sum: { rxBytes: true, txBytes: true, totalBytes: true },
      _max: { peakRateBps: true },
    }).catch(() => null),
    prisma.vpsInstance.groupBy({
      by: ["proxmoxNodeId"],
      where: { deletedAt: null, proxmoxNodeId: { not: null }, status: { in: ["ACTIVE", "RUNNING", "STARTING_VM", "REBOOTING", "active", "running"] } },
      _count: { _all: true },
    }).catch(() => []),
  ])

  const latestByVps = new Map<string, any>()
  for (const sample of latestSamples as any[]) {
    if (!latestByVps.has(sample.vpsInstanceId)) latestByVps.set(sample.vpsInstanceId, sample)
  }
  const rollupByVps = new Map((vpsRollups as any[]).map((row) => [row.vpsInstanceId || row.scopeId, row]))
  const throttleByVps = new Map((throttleRows as any[]).map((row) => [row.vpsInstanceId, row]))
  const activeByNode = new Map((activeVmCounts as any[]).map((row) => [row.proxmoxNodeId, row._count?._all || 0]))
  const vpsById = new Map<string, any>()

  for (const vps of activeVpsRows as any[]) vpsById.set(vps.id, vps)
  for (const rollup of vpsRollups as any[]) {
    if (rollup.vpsInstance && !vpsById.has(rollup.vpsInstance.id)) vpsById.set(rollup.vpsInstance.id, rollup.vpsInstance)
  }

  const vms = Array.from(vpsById.values()).map((vps: any) => {
    const rollup = rollupByVps.get(vps.id) || {}
    const latest = latestByVps.get(vps.id) || {}
    const throttle = throttleByVps.get(vps.id) || vps.bandwidthThrottleState || null
    const includedBytes = productIncludedBytes(vps.product, rollup)
    const totalBytes = numberValue(rollup.totalBytes)
    const rxRateBps = numberValue(latest.rxRateBps)
    const txRateBps = numberValue(latest.txRateBps)
    const throttled = String(throttle?.status || "").toLowerCase() === "throttled"
    const sampledAt = toIso(latest.recordedAt) || null
    const currentRateLimit = throttle?.proxmoxRateValue == null ? null : numberValue(throttle.proxmoxRateValue)
    const throttleRateMbps = throttle?.throttleRateMbps == null ? (currentRateLimit ? Number((currentRateLimit * 8).toFixed(4)) : null) : numberValue(throttle.throttleRateMbps)
    return {
      id: rollup.id || vps.id,
      vpsInstanceId: vps.id,
      customerId: vps.customerId || rollup.customerId || null,
      customerName: vps.customer?.name || "Customer",
      customerEmail: vps.customer?.email || null,
      vmName: vps.name || vps.id,
      vmid: vps.vmid || null,
      ipAddress: vps.ipAddress || null,
      nodeId: vps.proxmoxNodeId || vps.proxmoxNode?.id || null,
      nodeName: vps.proxmoxNode?.name || vps.proxmoxNode?.nodeName || vps.proxmoxNodeId || "-",
      productName: vps.product?.name || null,
      bandwidthLimitTb: numberValue(vps.product?.bandwidthTb),
      includedBytes,
      remainingBytes: Math.max(0, includedBytes - totalBytes),
      rxBytes: numberValue(rollup.rxBytes),
      txBytes: numberValue(rollup.txBytes),
      totalBytes,
      rxRateBps,
      txRateBps,
      peakRateBps: Math.max(numberValue(rollup.peakRateBps), numberValue(latest.peakRateBps), rxRateBps + txRateBps),
      currentMbps: bytesPerSecondToMbps(rxRateBps + txRateBps),
      currentKbps: bytesPerSecondToKbps(rxRateBps + txRateBps),
      throttled,
      currentRateLimit,
      proxmoxRateValue: currentRateLimit,
      throttleRateMbps,
      cycleEndsAt: toIso(throttle?.cycleEndsAt),
      overLimit: includedBytes > 0 && totalBytes > includedBytes,
      sampledAt,
      liveState: liveBandwidthState({ rxRateBps, txRateBps, throttled, sampledAt }),
      source: sampledAt ? "db-latest-sample" : "db-snapshot",
    }
  }).sort((a, b) => b.totalBytes - a.totalBytes)

  const liveNodes = aggregateLiveBandwidthNodes(vms as any)
  const liveNodeById = new Map(liveNodes.map((node) => [node.nodeId || node.nodeName, node]))
  const nodes = (nodeRollups as any[]).map((row) => {
    const live = liveNodeById.get(row.scopeId) || null
    return {
      nodeId: row.scopeId,
      nodeName: live?.nodeName || row.scopeId,
      rxBytes: numberValue(row.rxBytes),
      txBytes: numberValue(row.txBytes),
      totalBytes: numberValue(row.totalBytes),
      peakRateBps: Math.max(numberValue(row.peakRateBps), numberValue(live?.peakRateBps)),
      rxRateBps: numberValue(live?.rxRateBps),
      txRateBps: numberValue(live?.txRateBps),
      activeMbps: numberValue(live?.activeMbps),
      currentKbps: numberValue(live?.currentKbps),
      activeVmCount: numberValue(activeByNode.get(row.scopeId) || live?.activeVmCount),
      throttledVmCount: numberValue(live?.throttledVmCount),
      sampledAt: live?.sampledAt || null,
    }
  })
  for (const live of liveNodes) {
    const key = live.nodeId || live.nodeName
    if (!nodes.some((node: any) => node.nodeId === key || node.nodeName === key)) {
      nodes.push({
        ...live,
        rxBytes: 0,
        txBytes: 0,
        totalBytes: 0,
        activeVmCount: numberValue(activeByNode.get(live.nodeId || "") || live.activeVmCount),
      })
    }
  }

  const monthly = monthlyTotals?._sum || {}
  const daily = dailyTotals?._sum || {}
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    monthBucket: monthBucket.toISOString(),
    dayBucket: dayBucket.toISOString(),
    vms,
    nodes,
    top: vms.slice(0, 25),
    global: {
      monthBucketAt: monthBucket.toISOString(),
      dayBucketAt: dayBucket.toISOString(),
      monthlyTransferBytes: numberValue(monthly.totalBytes),
      monthlyRxBytes: numberValue(monthly.rxBytes),
      monthlyTxBytes: numberValue(monthly.txBytes),
      dailyTransferBytes: numberValue(daily.totalBytes),
      platformTrafficBytes: numberValue(monthly.totalBytes),
      peakRateBps: Math.max(numberValue(monthlyTotals?._max?.peakRateBps), numberValue(dailyTotals?._max?.peakRateBps)),
      estimatedInr: numberValue(monthly.estimatedInr),
      overLimitUsers: vms.filter((vm) => vm.overLimit).length,
      throttledVms: vms.filter((vm) => vm.throttled).length,
      openAlerts: (alerts as any[]).length,
    },
    alerts: (alerts as any[]).map((alert) => ({
      id: alert.id,
      vpsInstanceId: alert.vpsInstanceId,
      customerId: alert.customerId,
      alertType: alert.alertType,
      currentBytes: numberValue(alert.currentBytes),
      thresholdBytes: numberValue(alert.thresholdBytes),
      message: alert.message,
      lastSeenAt: toIso(alert.lastSeenAt),
    })),
  }
}
