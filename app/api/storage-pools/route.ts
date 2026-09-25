import { NextResponse } from "next/server"
import { customerSelectableStoragePools, storageTypeLabel } from "@/lib/storage-pools"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: Request) {
  const url = new URL(request.url)
  const nodeId = url.searchParams.get("nodeId")
  const pools = await customerSelectableStoragePools(nodeId)
  return NextResponse.json({
    success: true,
    pools: pools
      .filter((pool) => pool.proxmoxNode?.isActive !== false)
      .map((pool: any) => ({
        id: pool.id,
        nodeId: pool.proxmoxNodeId,
        nodeName: pool.proxmoxNode?.name || pool.proxmoxNode?.nodeName || null,
        displayName: pool.displayName || pool.storageId,
        storageType: pool.storageType,
        storageTypeLabel: storageTypeLabel(pool),
        pricePerGbMonthly: Number(pool.pricePerGbMonthly || 0),
        minGb: Number(pool.minGb || 1),
        maxGb: pool.maxGb == null ? null : Number(pool.maxGb),
        availableGb: pool.availableBytes || pool.freeBytes ? Math.floor(Number(pool.availableBytes || pool.freeBytes) / 1024 / 1024 / 1024) : null,
        isPremium: Boolean(pool.isPremium || pool.premium),
      })),
  })
}
