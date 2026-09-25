import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { deleteCustomerSafely } from "@/lib/customer-deletion"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const body = (await request.json()) as { ids?: string[]; action?: string }
  const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : []
  const action = String(body.action || "")
  if (!ids.length || !["activate", "suspend", "delete"].includes(action)) {
    return NextResponse.json({ error: "Valid ids and action are required" }, { status: 400 })
  }

  if (action === "activate" || action === "suspend") {
    const status = action === "activate" ? "ACTIVE" : "SUSPENDED"
    await prisma.customer.updateMany({
      where: { id: { in: ids } },
      data: {
        status: status as any,
        isActive: status === "ACTIVE",
        suspendedAt: status === "SUSPENDED" ? new Date() : null,
        suspendedReason: status === "SUSPENDED" ? "Bulk admin action" : null,
      },
    })
    await Promise.all(ids.map((id) => createAuditLog({
      adminId: adminRow.id,
      customerId: id,
      action: `CUSTOMER_BULK_${status}`,
      oldValue: null,
      newValue: { action },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    })))
    return NextResponse.json({ success: true })
  }

  const results = []
  for (const id of ids) {
    results.push(await deleteCustomerSafely({
      customerId: id,
      adminId: adminRow.id,
      actorEmail: admin.email,
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    }))
  }
  const deletedIds = results.filter((result) => result.deleted).map((result) => result.customerId)
  const blockedIds = results.filter((result) => !result.deleted && result.reason !== "not_found").map((result) => result.customerId)

  return NextResponse.json({
    success: true,
    deleted: deletedIds.length,
    deletedIds,
    blockedIds,
    result: { results },
  })
}
