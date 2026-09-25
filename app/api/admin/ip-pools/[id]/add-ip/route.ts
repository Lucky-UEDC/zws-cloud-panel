import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { isValidIpv4, isIpInSubnet } from "@/lib/ip-address"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createPanelLog } from "@/lib/panel-log"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const ipAddress = String(body.ipAddress || "").trim()

    if (!ipAddress) return NextResponse.json({ success: false, error: "ipAddress is required" }, { status: 400 })
    if (!isValidIpv4(ipAddress)) return NextResponse.json({ success: false, error: `${ipAddress} is not a valid IPv4 address` }, { status: 400 })

    const pool = await prisma.ipPool.findUnique({ where: { id } })
    if (!pool) return NextResponse.json({ success: false, error: "IP pool not found" }, { status: 404 })

    // Verify IP falls within pool range
    try {
      if (pool.startIp && pool.cidr && !isIpInSubnet(ipAddress, pool.startIp, Number(pool.cidr))) {
        return NextResponse.json({ success: false, error: `${ipAddress} is outside the pool range ${pool.startIp}/${pool.cidr}` }, { status: 400 })
      }
    } catch {
      // Skip range check if subnet check fails
    }

    // Check for duplicate in any pool
    const existingInOtherPool = await prisma.ipAllocation.findFirst({
      where: { ipAddress, poolId: { not: id } },
      select: { id: true, poolId: true },
    })
    if (existingInOtherPool) {
      return NextResponse.json({ success: false, error: `${ipAddress} already exists in another pool` }, { status: 409 })
    }

    // Check if already in this pool
    const existingInPool = await (prisma as any).ipAllocation.findUnique({
      where: { poolId_ipAddress: { poolId: id, ipAddress } },
    }).catch(() => null)
    if (existingInPool) {
      if (!["free", "FREE", "released", "RELEASED"].includes(String(existingInPool.status))) {
        return NextResponse.json({ success: false, error: `${ipAddress} already exists in this pool with status ${existingInPool.status}` }, { status: 409 })
      }
      return NextResponse.json({ success: true, allocation: existingInPool, reused: true })
    }

    // Check not assigned to an active VM
    const activeAssignment = await prisma.vmIpAssignment.findFirst({
      where: { ipAddress, status: { in: ["active", "ACTIVE"] as any }, detachedAt: null },
      select: { id: true, vpsInstanceId: true },
    })
    if (activeAssignment) {
      return NextResponse.json({ success: false, error: `${ipAddress} is already assigned to an active VM` }, { status: 409 })
    }

    const allocation = await prisma.ipAllocation.create({
      data: {
        poolId: id,
        ipAddress,
        status: "free",
        allocationType: "default",
      },
    })

    await createPanelLog({
      category: "IP Pool",
      message: "single_ip_added",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { poolId: id, poolName: pool.name, ipAddress, allocationId: allocation.id },
    }).catch(() => null)

    return NextResponse.json({ success: true, allocation }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to add IP" }, { status: 500 })
  }
}
