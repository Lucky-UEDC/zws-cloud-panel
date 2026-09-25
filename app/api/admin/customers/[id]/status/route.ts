import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { sendEmail } from "@/lib/mailer"
import { isAdminLikeRole } from "@/lib/admin-rbac"

const allowedStatuses = ["ACTIVE", "SUSPENDED", "PENDING", "BANNED", "CLOSED"] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() }, select: { id: true } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = (await request.json()) as {
    status?: string
    reason?: string
    message?: string
    suspendUntil?: string
    notifyUser?: boolean
  }

  const status = String(body.status || "").toUpperCase()
  if (!allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { id } })
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 })

  const suspendUntil = body.suspendUntil ? new Date(body.suspendUntil) : null
  const reason = String(body.reason || "").trim() || null
  const message = String(body.message || "").trim() || null

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      status: status as any,
      suspendedAt: status === "SUSPENDED" ? new Date() : null,
      suspendedReason: status === "SUSPENDED" ? reason : null,
      suspendUntil: status === "SUSPENDED" ? suspendUntil : null,
      suspendMessage: status === "SUSPENDED" ? message : null,
      bannedAt: status === "BANNED" ? new Date() : null,
      bannedReason: status === "BANNED" ? reason : null,
      isActive: status !== "BANNED" && status !== "CLOSED",
    },
  })

  await createAuditLog({
    adminId: adminRow.id,
    customerId: id,
    action: `CUSTOMER_STATUS_${status}`,
    oldValue: { status: customer.status, suspendedReason: customer.suspendedReason, suspendUntil: customer.suspendUntil },
    newValue: { status: updated.status, reason, message, suspendUntil },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  if (body.notifyUser !== false) {
    const subject =
      status === "SUSPENDED"
        ? "Your account has been suspended"
        : status === "ACTIVE"
          ? "Your account has been reactivated"
          : `Your account status changed to ${status}`

    await sendEmail({
      type: "accounts",
      to: updated.email,
      subject,
      text: message || `Your account status is now ${status}. ${reason ? `Reason: ${reason}` : ""}`,
    }).catch(() => null)
  }

  return NextResponse.json({ success: true, customer: updated })
}
