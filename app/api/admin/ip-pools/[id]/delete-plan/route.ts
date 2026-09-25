import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { expandIpRange } from "@/lib/ip-address"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const [pool, targetPools] = await Promise.all([
    prisma.ipPool.findUnique({
      where: { id },
      include: {
        allocations: {
          where: { status: { in: ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"] } },
          include: { vpsInstance: { include: { customer: { select: { id: true, email: true, name: true } } } } },
          orderBy: { ipAddress: "asc" },
        },
      },
    }),
    prisma.ipPool.findMany({
      where: { id: { not: id }, isActive: true },
      include: { allocations: true },
      orderBy: { createdAt: "asc" },
    }),
  ])
  if (!pool) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })
  const affectedVps = pool.allocations.map((allocation) => ({
    allocationId: allocation.id,
    hostname: allocation.vpsInstance?.name || allocation.hostname || "-",
    vmid: allocation.vmid || allocation.vpsInstance?.vmid || null,
    customer: allocation.vpsInstance?.customer || null,
    currentIp: allocation.ipAddress,
    status: allocation.vpsInstance?.status || allocation.status,
    vpsInstanceId: allocation.vpsInstanceId,
  }))
  const targets = targetPools.map((target) => {
    const active = target.allocations.filter((allocation) => ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"].includes(String(allocation.status))).length
    const total = expandIpRange(target.startIp, target.endIp).length
    return {
      id: target.id,
      name: target.name,
      range: `${target.startIp} - ${target.endIp}/${target.cidr}`,
      freeIps: Math.max(0, total - active),
      totalIps: total,
    }
  })
  return NextResponse.json({
    success: true,
    pool: { id: pool.id, name: pool.name, range: `${pool.startIp} - ${pool.endIp}/${pool.cidr}` },
    activeCount: affectedVps.length,
    affectedVps,
    targetPools: targets,
    options: ["migrate_all", "manual_replacements", "release_reserved_only", "cancel"],
  })
}
