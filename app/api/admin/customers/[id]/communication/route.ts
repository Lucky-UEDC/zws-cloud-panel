import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { sendEmail } from "@/lib/mailer"
import { isAdminLikeRole } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = (await request.json()) as { type?: string; subject?: string; message?: string }

  const subject = String(body.subject || "").trim()
  const message = String(body.message || "").trim()
  const type = (String(body.type || "support") || "support") as "support" | "billing" | "noreply" | "accounts" | "admin"

  if (!subject || !message) {
    return NextResponse.json({ error: "Subject and message are required" }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id }, select: { email: true } })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const result = await sendEmail({
    type,
    to: customer.email,
    subject,
    text: message,
    html: `<p>${message.replace(/\n/g, "<br/>")}</p>`,
  })

  await createAuditLog({
    adminId: adminRow.id,
    customerId: id,
    action: "CUSTOMER_EMAIL_SENT",
    oldValue: null,
    newValue: { subject, type },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  return NextResponse.json({ success: true, result })
}
