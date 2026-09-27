import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { metricFreshness, type MetricFreshnessState } from "@/lib/vm-db-truth"

export const dynamic = "force-dynamic"
export const revalidate = 0

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id }, { orderId: id }],
      customerId,
      deletedAt: null,
      status: { not: "DELETED" },
      order: { deletedAt: null, status: { not: "DELETED" } },
    },
    include: {
      disks: { where: { status: { not: "DELETED" } }, include: { storagePool: true }, orderBy: [{ isPrimary: "desc" }, { displayName: "asc" }] },
      product: { select: { storageGb: true } },
      storagePool: { select: { displayName: true, storageId: true } },
      proxmoxNode: { select: { nodeName: true } },
    },
  })

  if (!vps) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

  const runtimeStatus = String(vps.status || "").toLowerCase()
  const running = runtimeStatus === "running"

  // Fetch latest metric for disk details
  const metric = await (prisma as any).vpsMetric.findFirst({
    where: { vpsInstanceId: vps.id },
    orderBy: { recordedAt: "desc" },
  }).catch(() => null)

  const diskMeta = metric?.metadata?.diskUsage || {}
  const diskUsedBytes = numberValue(metric?.diskUsedBytes || diskMeta.usedBytes || vps.diskUsedGb ? Number(vps.diskUsedGb) * 1_000_000_000 : 0)
  const diskTotalBytes = numberValue(metric?.diskTotalBytes || diskMeta.totalBytes || vps.diskTotalGb ? Number(vps.diskTotalGb) * 1_000_000_000 : 0)
  const diskFreeBytes = numberValue(metric?.diskFreeBytes || diskMeta.freeBytes || Math.max(0, diskTotalBytes - diskUsedBytes))
  const diskPercent = percent(diskUsedBytes, diskTotalBytes)
  const diskSource = diskMeta.source || vps.diskUsageSource || "unavailable"
  const diskOs = diskMeta.os || null
  const diskFilesystem = diskMeta.filesystem || diskMeta.mountPoint || null
  const diskErrorCode = diskMeta.errorCode || null
  const diskError = diskMeta.error || null
  const collectionDurationMs = diskMeta.collectionDurationMs || null
  const checkedAt = diskMeta.checkedAt || vps.diskUsageCheckedAt?.toISOString() || null
  const volumes = diskMeta.volumes || []

  // Freshness
  let diskFresh: { state: MetricFreshnessState; source: string; lastUpdatedAt: string | null; errorCode?: string | null; error?: string | null }
  if (!running) {
    diskFresh = {
      state: "UNAVAILABLE",
      source: "server_stopped",
      lastUpdatedAt: checkedAt,
      errorCode: "VM_STOPPED",
      error: "Server stopped",
    }
  } else if (diskErrorCode) {
    diskFresh = {
      state: "UNAVAILABLE",
      source: "guest_agent_unavailable",
      lastUpdatedAt: checkedAt,
      errorCode: diskErrorCode,
      error: diskError,
    }
  } else if (diskTotalBytes > 0) {
    diskFresh = metricFreshness(metric)
  } else {
    diskFresh = { state: "UNAVAILABLE", source: "no_data", lastUpdatedAt: null, errorCode: "DISK_DATA_INVALID", error: "Usage unavailable" }
  }

  const usedGb = diskTotalBytes > 0 ? Number((diskUsedBytes / 1_000_000_000).toFixed(2)) : null
  const totalGb = diskTotalBytes > 0 ? Number((diskTotalBytes / 1_000_000_000).toFixed(2)) : null
  const freeGb = diskTotalBytes > 0 ? Number((diskFreeBytes / 1_000_000_000).toFixed(2)) : null

  return NextResponse.json(
    {
      success: true,
      running,
      vps: {
        id: vps.id,
        vmid: vps.vmid,
        nodeName: vps.proxmoxNode?.nodeName || null,
        os: diskOs || null,
        runtimeStatus,
      },
      diskUsage: {
        usedGb,
        totalGb,
        freeGb,
        percent: diskTotalBytes > 0 ? diskPercent : null,
        checkedAt,
        source: diskSource,
        filesystem: diskFilesystem,
        errorCode: diskErrorCode,
        error: diskError,
        collectionDurationMs,
        volumes,
        freshness: diskFresh,
      },
      disks: vps.disks?.map((disk) => ({
        id: disk.id,
        displayName: disk.displayName,
        sizeGb: disk.sizeGb,
        isPrimary: disk.isPrimary,
        status: disk.status,
        storagePoolName: disk.storagePool?.displayName || disk.storagePool?.storageId || null,
      })) || [],
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}