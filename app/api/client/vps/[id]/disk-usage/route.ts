import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { bytesToDecimalGb, gbToBytesDecimal } from "@/lib/format-units"

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
    },
  })

  if (!vps) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

  const runtimeStatus = String(vps.status || "").toLowerCase()
  const isRunning = runtimeStatus === "running"

  const primaryDisk = vps.disks?.find((d) => d.isPrimary) || vps.disks?.[0] || null
  const configuredDiskGb = primaryDisk?.sizeGb || vps.product?.storageGb || vps.diskGb || 0

  // Return cached disk usage if VM is stopped, or fresh metrics if running
  const diskUsage = {
    usedGb: vps.diskUsedGb === null || vps.diskUsedGb === undefined ? null : Number(vps.diskUsedGb),
    totalGb: vps.diskTotalGb === null || vps.diskTotalGb === undefined ? configuredDiskGb : Number(vps.diskTotalGb),
    freeGb: vps.diskTotalGb !== null && vps.diskTotalGb !== undefined && vps.diskUsedGb !== null && vps.diskUsedGb !== undefined
      ? Math.max(0, Number(vps.diskTotalGb) - Number(vps.diskUsedGb))
      : null,
    percent: vps.diskUsagePercent === null || vps.diskUsagePercent === undefined ? null : Number(vps.diskUsagePercent),
    checkedAt: vps.diskUsageCheckedAt ? vps.diskUsageCheckedAt.toISOString() : null,
    source: "cached",
    reported: Boolean(vps.diskTotalGb !== null && vps.diskTotalGb !== undefined && (Number(vps.diskUsedGb || 0) > 0 || Number(vps.diskUsagePercent || 0) > 0)),
  }

  return NextResponse.json({
    success: true,
    running: isRunning,
    diskUsage,
    disks: vps.disks?.map((disk) => ({
      id: disk.id,
      displayName: disk.displayName,
      sizeGb: disk.sizeGb,
      isPrimary: disk.isPrimary,
      status: disk.status,
      storagePoolName: (disk as any).storagePool?.displayName || (disk as any).storagePool?.storageId || null,
    })) || [],
  }, { headers: { "Cache-Control": "no-store" } })
}