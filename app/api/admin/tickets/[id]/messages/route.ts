import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { attachFilesToMessage, parseTicketBody, serializeTicketMessage } from "@/lib/ticket-attachments"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({ where: { email: String(admin.email).toLowerCase() } })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = await parseTicketBody(request)
  const messageResult = validateSecurityField(body.message, "message", "Message")
  if (!messageResult.ok) {
    if (messageResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, messageResult.detection, "message")
    return NextResponse.json({ error: messageResult.error }, { status: 400 })
  }
  const message = messageResult.value
  if (!message && !body.files.length) return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 })

  const ticket = await prisma.supportTicket.findUnique({
    where: { id },
    include: { customer: true },
  })
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const created = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      adminId: adminRow.id,
      senderType: "admin",
      internalOnly: Boolean(body.internalOnly),
      body: message,
    },
  })
  const attachments = await attachFilesToMessage({
    ticketId: ticket.id,
    messageId: created.id,
    files: body.files,
    owner: { adminId: adminRow.id },
  })

  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "open" } })

  if (!body.internalOnly) {
    try {
      await sendTemplateEmail({
        templateKey: "support_reply",
        to: ticket.customer.email,
        variables: {
          userName: ticket.customer.name || "there",
          email: ticket.customer.email,
          ticketUrl: `/client-area/support?ticket=${ticket.id}`,
        },
        customerId: ticket.customerId,
        metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
      })
    } catch {
      // Do not break on SMTP errors.
    }
  }

  return NextResponse.json({ success: true, message: serializeTicketMessage({ ...created, attachments }) })
}
