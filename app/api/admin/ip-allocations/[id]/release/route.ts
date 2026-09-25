import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    const existing = await prisma.ipAllocation.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ success: false, error: "Allocation not found" }, { status: 404 })
    if (existing.vpsInstanceId || existing.vmid) {
      return NextResponse.json({ success: false, error: "Use Change IP or pool migration before releasing an active VPS allocation" }, { status: 409 })
    }
    const allocation = await prisma.ipAllocation.update({
      where: { id },
      data: { status: "free", allocationLockKey: null, vpsInstanceId: null, vmid: null, hostname: null, releasedAt: new Date() },
    })
    await createPanelLog({
      category: "IP Pool",
      message: "IP allocation released",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: { allocationId: id, ipAddress: allocation.ipAddress, poolId: allocation.poolId },
    })
    return NextResponse.json({ success: true, allocation })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Release failed" }, { status: 400 })
  }
}
