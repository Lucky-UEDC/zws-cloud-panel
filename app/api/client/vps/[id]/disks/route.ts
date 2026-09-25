import { NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { diskUpgradeContext } from "@/lib/vps-disk-upgrades"
import { storageTypeLabel } from "@/lib/storage-pools"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    const { vps, disks, pools } = await diskUpgradeContext(id, customerId)
    return NextResponse.json({
      success: true,
      vps: { id: vps.id, name: vps.name, status: vps.status, ipAddress: vps.ipAddress, billingCycle: vps.billingCycle },
      disks: disks.map((disk) => ({
        id: disk.id,
        displayName: disk.displayName,
        sizeGb: disk.sizeGb,
        isPrimary: disk.isPrimary,
        status: disk.status,
        storagePoolId: disk.storagePoolId,
        storagePool: disk.storagePool ? { id: disk.storagePool.id, displayName: disk.storagePool.displayName || disk.storagePool.storageId, storageType: storageTypeLabel(disk.storagePool), pricePerGbMonthInr: Number(disk.storagePool.pricePerGbMonthly || 0) } : null,
      })),
      pools: pools.map((pool) => ({
        id: pool.id,
        displayName: pool.displayName || pool.storageId,
        diskClass: pool.storageType,
        storageType: storageTypeLabel(pool),
        pricePerGbMonthInr: Number(pool.pricePerGbMonthly || 0),
        isPremium: Boolean(pool.isPremium || pool.premium),
        isUpgradeOnly: Boolean(pool.isUpgradeOnly),
      })),
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to load disks" }, { status: 400 })
  }
}
