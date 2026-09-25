import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { deliverPasswordResetLink, PASSWORD_RESET_EXPIRES_MINUTES } from "@/lib/auth/password-reset-delivery"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, email: true, name: true, phone: true, whatsappOptIn: true } })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 1000 * 60 * PASSWORD_RESET_EXPIRES_MINUTES)
  await prisma.passwordResetToken.create({ data: { customerId: customer.id, token, expiresAt } })

  const delivery = await deliverPasswordResetLink({
    customer,
    token,
    source: "admin_customer_reset",
    requestedBy: String(admin.email),
    expiresAt,
  }).catch((error: any) => ({ channel: "none" as const, status: "failed" as const, warning: error?.message || "Password reset delivery failed" }))

  await createAuditLog({
    adminId: adminRow.id,
    customerId: id,
    action: "CUSTOMER_PASSWORD_RESET_LINK_SENT",
    oldValue: null,
    newValue: { email: customer.email, channel: delivery.channel, status: delivery.status, warning: delivery.warning || null },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({ success: true, channel: delivery.channel, status: delivery.status, warning: delivery.warning || null })
}
