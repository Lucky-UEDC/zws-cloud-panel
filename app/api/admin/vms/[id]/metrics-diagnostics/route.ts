import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { logApiError } from "@/lib/structured-logger"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_CACHE_HEADERS })
  }

  const { id } = await params
  try {
    const vps = await prisma.vpsInstance.findFirst({
      where: { OR: [{ id }, { orderId: id }], deletedAt: null },
      include: {
        proxmoxNode: { select: { id: true, nodeName: true, host: true, location: true } },
        operatingSystem: { select: { id: true, name: true, osFamily: true, osType: true, category: true } },
        order: { select: { id: true, osName: true, status: true } },
        product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true } },
      },
    })
    if (!vps) {
      return NextResponse.json({ error: "VM not found" }, { status: 404 })
    }

    // Latest metric for freshness and disk details
    const latestMetric = await (prisma as any).vpsMetric.findFirst({
      where: { vpsInstanceId: vps.id },
      orderBy: { recordedAt: "desc" },
    }).catch(() => null)

    // Last 5 metric rows for recent history
    const recentMetrics = await (prisma as any).vpsMetric.findMany({
      where: { vpsInstanceId: vps.id },
      orderBy: { recordedAt: "desc" },
      take: 5,
      select: {
        id: true,
        recordedAt: true,
        runtimeStatus: true,
        cpuPercent: true,
        ramUsedBytes: true,
        ramTotalBytes: true,
        diskUsedBytes: true,
        diskTotalBytes: true,
        diskFreeBytes: true,
        metadata: true,
      },
    }).catch(() => [])

    // Disk usage history from VpsInstance
    const diskHistory = await prisma.vpsInstance.findUnique({
      where: { id: vps.id },
      select: {
        diskUsedGb: true,
        diskTotalGb: true,
        diskUsagePercent: true,
        diskUsageCheckedAt: true,
        diskUsageSource: true,
        status: true,
        vmid: true,
      },
    })

    // Guest agent status from latest metric metadata
    const agentMeta = latestMetric?.metadata?.diskUsage || {}
    const agentPingOk = latestMetric?.metadata?.agentPingOk === true
    const agentPingAt = latestMetric?.metadata?.agentPingAt || null

    // Determine OS from authoritative sources
    const osSources = [
      { label: "operatingSystem.name", value: vps.operatingSystem?.name },
      { label: "operatingSystem.osFamily", value: vps.operatingSystem?.osFamily },
      { label: "operatingSystem.osType", value: vps.operatingSystem?.osType },
      { label: "operatingSystem.category", value: vps.operatingSystem?.category },
      { label: "vmOsFamily", value: vps.vmOsFamily },
      { label: "order.osName", value: vps.order?.osName },
    ].filter((s) => s.value)

    // Latest disk collection attempt metadata
    const lastDiskAttempt = agentMeta
    const collectionDurationMs = lastDiskAttempt?.collectionDurationMs || null
    const checkedAt = lastDiskAttempt?.checkedAt || diskHistory?.diskUsageCheckedAt?.toISOString() || null
    const volumes = lastDiskAttempt?.volumes || []
    const selectedVolume = lastDiskAttempt?.selectedVolume || null
    const errorCode = lastDiskAttempt?.errorCode || null
    const error = lastDiskAttempt?.error || null

    // Determine guest agent reachable
    const guestAgentEnabled = vps.vmid && vps.proxmoxNode ? true : false
    const guestAgentReachable = agentPingOk || errorCode !== "GUEST_AGENT_DISABLED"

    // Command type used
    let commandType: string | null = null
    if (lastDiskAttempt?.os === "linux") commandType = "df -B1 -P"
    else if (lastDiskAttempt?.os === "windows") commandType = lastDiskAttempt?.source === "guest-agent-windows" ? "Get-CimInstance (wmic fallback)" : "Get-CimInstance"
    else if (errorCode === "OS_UNKNOWN") commandType = "none (OS unknown)"

    // Build diagnostics response
    const diagnostics = {
      vps: {
        id: vps.id,
        vmid: vps.vmid,
        name: vps.name,
        hostname: vps.hostname,
        status: vps.status,
        node: vps.proxmoxNode
          ? {
              id: vps.proxmoxNode.id,
              nodeName: vps.proxmoxNode.nodeName,
              host: vps.proxmoxNode.host,
              location: vps.proxmoxNode.location,
            }
          : null,
        os: osSources.map((s) => `${s.label}=${s.value}`).join("; "),
        osDetected: agentMeta?.os || "unknown",
      },
      guestAgent: {
        enabled: guestAgentEnabled,
        reachable: guestAgentReachable,
        lastPingAt: agentPingAt,
        lastPingOk: agentPingOk,
      },
      diskCollection: {
        lastAttemptAt: latestMetric?.recordedAt ? new Date(latestMetric.recordedAt).toISOString() : null,
        commandType,
        collectionDurationMs,
        checkedAt,
        source: lastDiskAttempt?.source || diskHistory?.diskUsageSource || "unavailable",
        os: lastDiskAttempt?.os || "unknown",
        errorCode,
        error,
        volumes: volumes.map((v: any) => ({
          name: v.name,
          mountpoint: v.mountpoint || v.drive || null,
          filesystem: v.filesystem || null,
          totalBytes: v.totalBytes,
          usedBytes: v.usedBytes,
          freeBytes: v.freeBytes,
          system: v.system,
        })),
        selectedVolume: selectedVolume
          ? {
              name: selectedVolume.name,
              mountpoint: selectedVolume.mountpoint || selectedVolume.drive || null,
              filesystem: selectedVolume.filesystem || null,
              totalBytes: selectedVolume.totalBytes,
              usedBytes: selectedVolume.usedBytes,
              freeBytes: selectedVolume.freeBytes,
              system: selectedVolume.system,
            }
          : null,
      },
      latestMetric: latestMetric
        ? {
            id: latestMetric.id,
            recordedAt: new Date(latestMetric.recordedAt).toISOString(),
            runtimeStatus: latestMetric.runtimeStatus,
            cpuPercent: latestMetric.cpuPercent,
            ramUsedGb: Number((Number(latestMetric.ramUsedBytes) / 1_000_000_000).toFixed(2)),
            ramTotalGb: Number((Number(latestMetric.ramTotalBytes) / 1_000_000_000).toFixed(2)),
            diskUsedGb: Number((Number(latestMetric.diskUsedBytes) / 1_000_000_000).toFixed(2)),
            diskTotalGb: Number((Number(latestMetric.diskTotalBytes) / 1_000_000_000).toFixed(2)),
            diskFreeGb: Number((Number(latestMetric.diskFreeBytes) / 1_000_000_000).toFixed(2)),
            source: latestMetric.metadata?.source || "unknown",
          }
        : null,
      recentMetrics: recentMetrics.map((m: any) => ({
        id: m.id,
        recordedAt: new Date(m.recordedAt).toISOString(),
        runtimeStatus: m.runtimeStatus,
        cpuPercent: m.cpuPercent,
        ramUsedGb: Number((Number(m.ramUsedBytes) / 1_000_000_000).toFixed(2)),
        ramTotalGb: Number((Number(m.ramTotalBytes) / 1_000_000_000).toFixed(2)),
        diskUsedGb: Number((Number(m.diskUsedBytes) / 1_000_000_000).toFixed(2)),
        diskTotalGb: Number((Number(m.diskTotalBytes) / 1_000_000_000).toFixed(2)),
        source: m.metadata?.source || "unknown",
        diskSource: m.metadata?.diskUsage?.source || "unknown",
        diskErrorCode: m.metadata?.diskUsage?.errorCode || null,
      })),
      vpsInstanceDiskCache: diskHistory
        ? {
            diskUsedGb: diskHistory.diskUsedGb,
            diskTotalGb: diskHistory.diskTotalGb,
            diskUsagePercent: diskHistory.diskUsagePercent,
            diskUsageCheckedAt: diskHistory.diskUsageCheckedAt?.toISOString() || null,
            diskUsageSource: diskHistory.diskUsageSource,
          }
        : null,
    }

    return NextResponse.json({ success: true, diagnostics }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    logApiError({
      route: "admin/vms/[id]/metrics-diagnostics",
      error: error instanceof Error ? error.message : String(error),
      vpsId: id,
      adminId: admin?.sub,
    })
    return NextResponse.json({ error: "Failed to load diagnostics" }, { status: 500 })
  }
}