import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { generateTicketNumber } from "@/lib/tickets"
import { sendEmail } from "@/lib/mailer"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { getSetting, type GeneralSettings } from "@/lib/settings"
import { attachFilesToMessage, parseTicketBody, serializeTicket } from "@/lib/ticket-attachments"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function GET() {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tickets = await prisma.supportTicket.findMany({
    where: { customerId: String(client.sub) },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { take: 1, orderBy: { createdAt: "desc" }, include: { attachments: true } },
    },
  })

  return NextResponse.json({ tickets: tickets.map(serializeTicket) })
}

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await parseTicketBody(request)
  const captcha = await requireTurnstile(gate.ctx, body.turnstileToken, "support")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "support_create", 5, 60 * 60_000)
  if (!rate.ok) return rate.response
  const customer = await prisma.customer.findUnique({ where: { id: String(client.sub) }, select: { phoneVerified: true } })
  if (!customer?.phoneVerified) return NextResponse.json({ error: "Verify your mobile number before creating support tickets.", code: "otp_required" }, { status: 403 })

  const subjectResult = validateSecurityField(body.subject, "subject", "Subject")
  if (!subjectResult.ok) {
    if (subjectResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, subjectResult.detection, "subject")
    return NextResponse.json({ error: subjectResult.error }, { status: 400 })
  }
  const messageResult = validateSecurityField(body.message, "message", "Message")
  if (!messageResult.ok) {
    if (messageResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, messageResult.detection, "message")
    return NextResponse.json({ error: messageResult.error }, { status: 400 })
  }
  const categoryResult = validateSecurityField(body.category || "general", "id", "Category")
  if (!categoryResult.ok) return NextResponse.json({ error: "Invalid category" }, { status: 400 })
  const productResult = body.productId ? validateSecurityField(body.productId, "id", "Product") : { ok: true as const, value: "" }
  if (!productResult.ok) return NextResponse.json({ error: "Invalid product" }, { status: 400 })

  const subject = subjectResult.value
  const message = messageResult.value
  if (!subject || (!message && !body.files.length)) {
    return NextResponse.json({ error: "Subject and message or attachment are required" }, { status: 400 })
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber: generateTicketNumber(),
      customerId: String(client.sub),
      subject,
      category: categoryResult.value || "general",
      priority: String(body.priority || "medium"),
      source: "client_area",
      metadata: {
        productId: productResult.value || null,
      },
    },
  })

  const firstMessage = await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      customerId: String(client.sub),
      senderType: "client",
      body: message,
    },
  })
  const attachments = await attachFilesToMessage({
    ticketId: ticket.id,
    messageId: firstMessage.id,
    files: body.files,
    owner: { customerId: String(client.sub) },
  })

  try {
    const general = await getSetting<GeneralSettings>("general_settings")
    const supportTo = general.supportEmail || general.companyEmail

    if (supportTo) {
      await sendEmail({
        to: supportTo,
        subject: `[${ticket.ticketNumber}] New support ticket`,
        text: `Ticket from ${client.email}\n\nSubject: ${ticket.subject}\n\nMessage:\n${message}`,
      })
    }

    await sendTemplateEmail({
      templateKey: "support_ticket_created",
      to: String(client.email),
      variables: {
        userName: String(client.name || "there"),
        email: String(client.email),
        ticketUrl: `/client-area/support?ticket=${ticket.id}`,
      },
      customerId: String(client.sub),
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    })
  } catch {
    // Keep ticketing robust if SMTP has issues.
  }

  return NextResponse.json({ success: true, ticket: serializeTicket({ ...ticket, messages: [{ ...firstMessage, attachments }] }) }, { status: 201 })
}
