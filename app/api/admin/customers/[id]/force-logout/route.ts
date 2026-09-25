import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { revokeSessionsForUser } from "@/lib/auth/session-store"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  await prisma.authChallenge.deleteMany({ where: { userType: "customer", userId: id } })
  await revokeSessionsForUser(id, "client")

  await createAuditLog({
    adminId: adminRow.id,
    customerId: id,
    action: "CUSTOMER_FORCE_LOGOUT_REQUESTED",
    oldValue: null,
    newValue: { note: "Active customer sessions and pending auth challenges revoked." },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({
    success: true,
    message: "Active customer sessions revoked.",
  })
}
