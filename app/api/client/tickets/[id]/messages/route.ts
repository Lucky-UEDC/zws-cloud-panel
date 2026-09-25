import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { sendEmail } from "@/lib/mailer"
import { getSetting, type GeneralSettings } from "@/lib/settings"
import { attachFilesToMessage, parseTicketBody, serializeTicketMessage } from "@/lib/ticket-attachments"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await parseTicketBody(request)
  const captcha = await requireTurnstile(gate.ctx, body.turnstileToken, "support")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "support_reply", 10, 60 * 60_000)
  if (!rate.ok) return rate.response
  const customer = await prisma.customer.findUnique({ where: { id: String(client.sub) }, select: { phoneVerified: true } })
  if (!customer?.phoneVerified) return NextResponse.json({ error: "Verify your mobile number before replying to support tickets.", code: "otp_required" }, { status: 403 })

  const messageResult = validateSecurityField(body.message, "message", "Message")
  if (!messageResult.ok) {
    if (messageResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, messageResult.detection, "message")
    return NextResponse.json({ error: messageResult.error }, { status: 400 })
  }
  const message = messageResult.value
  if (!message && !body.files.length) return NextResponse.json({ error: "Message or attachment is required" }, { status: 400 })

  const ticket = await prisma.supportTicket.findFirst({
    where: { id, customerId: String(client.sub) },
  })

  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 })

  const created = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      customerId: String(client.sub),
      senderType: "client",
      body: message,
    },
  })
  const attachments = await attachFilesToMessage({
    ticketId: ticket.id,
    messageId: created.id,
    files: body.files,
    owner: { customerId: String(client.sub) },
  })

  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "open" } })

  try {
    const general = await getSetting<GeneralSettings>("general_settings")
    const supportTo = general.supportEmail || general.companyEmail

    if (supportTo) {
      await sendEmail({
        to: supportTo,
        subject: `[${ticket.ticketNumber}] Client reply`,
        text: `Client ${client.email} replied:\n\n${message}`,
      })
    }

    await sendEmail({
      to: String(client.email),
      subject: `[${ticket.ticketNumber}] Reply received`,
      text: `Your reply has been recorded:\n\n${message}`,
    })
  } catch {
    // ignore SMTP failures
  }

  return NextResponse.json({ success: true, message: serializeTicketMessage({ ...created, attachments }) })
}
