import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true },
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const existing = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, email: true, emailVerifiedAt: true },
  })
  if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const verifiedAt = existing.emailVerifiedAt || new Date()
  const customer = await prisma.customer.update({
    where: { id },
    data: { emailVerifiedAt: verifiedAt },
  })

  await createAuditLog({
    adminId: adminRow.id,
    customerId: id,
    action: "CUSTOMER_EMAIL_VERIFIED_BY_ADMIN",
    oldValue: { email: existing.email, emailVerifiedAt: existing.emailVerifiedAt },
    newValue: { email: customer.email, emailVerifiedAt: verifiedAt, silent: true },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({ success: true, customer })
}
