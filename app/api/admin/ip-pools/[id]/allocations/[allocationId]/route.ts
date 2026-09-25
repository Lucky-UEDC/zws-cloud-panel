import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createAuditLog } from "@/lib/audit-log"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; allocationId: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id, allocationId } = await params
  const allocation = await prisma.ipAllocation.findFirst({ where: { id: allocationId, poolId: id } })
  if (!allocation) return NextResponse.json({ success: false, error: "IP allocation not found" }, { status: 404 })
  const active = !["free", "released"].includes(String(allocation.status || "").toLowerCase()) || Boolean(allocation.vpsInstanceId)
  if (active) return NextResponse.json({ success: false, code: "IP_ALLOCATION_ACTIVE", error: "Assigned or reserved IP addresses cannot be deleted" }, { status: 409 })

  await prisma.$transaction(async (tx) => {
    await tx.vmIpAssignment.updateMany({ where: { OR: [{ ipAllocationId: allocation.id }, { ipAddress: allocation.ipAddress }], status: { notIn: ["released", "deleted"] as any } }, data: { status: "released", detachedAt: new Date() } })
    await (tx as any).ipAssignment.updateMany({ where: { OR: [{ allocationId: allocation.id }, { assignedIp: allocation.ipAddress }], releasedAt: null }, data: { status: "released", releasedAt: new Date() } }).catch(() => null)
    await tx.ipAllocation.delete({ where: { id: allocation.id } })
  })
  await createAuditLog({
    action: "IP_ALLOCATION_DELETE_ADDRESS", actorEmail: String(admin.email), targetType: "ip_allocation", targetId: allocation.id,
    oldValue: { poolId: id, ipAddress: allocation.ipAddress, status: allocation.status },
    newValue: { deleted: true }, metadata: { requestId: request.headers.get("x-request-id") || null },
  }).catch(() => null)
  return NextResponse.json({ success: true, deleted: true, allocationId, ipAddress: allocation.ipAddress })
}
