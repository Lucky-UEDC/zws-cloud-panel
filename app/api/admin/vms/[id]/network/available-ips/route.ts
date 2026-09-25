import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { FREE_ALLOCATION_STATUSES, ipPoolReadiness } from "@/lib/ip-pool"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const url = new URL(request.url)
  const forceOverride = url.searchParams.get("forceOverride") === "true" || url.searchParams.get("forceAssign") === "true"
  const poolId = url.searchParams.get("poolId") || null
  const vm = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], deletedAt: null },
    select: { id: true, name: true, vmid: true, productId: true, proxmoxNodeId: true, ipAddress: true },
  })
  if (!vm) return NextResponse.json({ success: false, error: "VM not found" }, { status: 404 })

  if (!forceOverride) {
    const readiness = await ipPoolReadiness({
      proxmoxNodeId: vm.proxmoxNodeId,
      productId: vm.productId,
      poolId,
      forceOverride: false,
      availableLimit: 1000,
    })
    return NextResponse.json({ success: true, mode: "validated", vm, ...readiness })
  }

  const allocations = await prisma.ipAllocation.findMany({
    where: {
      ...(poolId ? { poolId } : {}),
      status: { in: [...FREE_ALLOCATION_STATUSES] as any },
      pool: { poolType: { not: "ADDON_ONLY" } as any },
    },
    include: { pool: { select: { id: true, name: true, gateway: true, cidr: true, bridge: true, bridgeOverride: true, dns: true, poolMode: true, poolType: true } } },
    orderBy: [{ poolId: "asc" }, { ipAddress: "asc" }],
    take: 1000,
  })
  return NextResponse.json({
    success: true,
    mode: "override",
    vm,
    selectedIp: allocations[0]?.ipAddress || null,
    availableIps: allocations.map((allocation) => allocation.ipAddress),
    pools: Object.values(allocations.reduce<Record<string, any>>((acc, allocation) => {
      acc[allocation.poolId] ||= { ...allocation.pool, availableIps: [] as string[], freeIps: 0 }
      acc[allocation.poolId].availableIps.push(allocation.ipAddress)
      acc[allocation.poolId].freeIps += 1
      return acc
    }, {})),
  })
}
