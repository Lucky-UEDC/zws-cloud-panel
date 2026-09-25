import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/mailer"
import { generateTicketNumber } from "@/lib/tickets"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { consumeSignupPhoneVerification } from "@/lib/auth/phone-verification"
import { normalizeStrictPhoneNumber } from "@/lib/phone-number"
import { securityGate, requireRateLimit, requireTurnstile, markAttempt } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

type ContactPayload = {
  name?: string
  email?: string
  company?: string
  phone?: string
  countryCode?: string
  verificationToken?: string
  verificationId?: string
  turnstileToken?: string
  message?: string
}

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response

  let body: ContactPayload
  try {
    body = (await request.json()) as ContactPayload
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    )
  }

  const captcha = await requireTurnstile(gate.ctx, body.turnstileToken, "contact")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "contact", 3, 60 * 60_000)
  if (!rate.ok) return rate.response

  const nameResult = validateSecurityField(body.name, "name", "Name")
  const emailResult = validateSecurityField(String(body.email || "").toLowerCase(), "email", "Email")
  const messageResult = validateSecurityField(body.message, "message", "Message")
  const companyResult = body.company ? validateSecurityField(body.company, "company", "Company") : { ok: true as const, value: "" }

  const errors: Record<string, string> = {}
  for (const [field, result] of Object.entries({ name: nameResult, email: emailResult, message: messageResult, company: companyResult })) {
    if (!result.ok) {
      if ("detection" in result && result.detection?.dangerous) {
        return rejectDetectedPayload(gate.ctx, result.detection, field)
      }
      errors[field] = result.error || `${field} is invalid.`
    }
  }

  const name = nameResult.value
  const email = emailResult.value
  const message = messageResult.value
  const company = companyResult.value
  let phone = ""
  const countryCode = String(body.countryCode || "").trim().toUpperCase()
  try {
    phone = normalizeStrictPhoneNumber(body.phone || "", countryCode).e164
  } catch {
    errors.phone = "A verified mobile phone is required."
  }

  if (!name) errors.name = "Name is required."
  if (!email) errors.email = "A valid email is required."
  if (message.length < 10) errors.message = "Message is too short."
  if (!body.verificationToken || !body.verificationId) errors.phone = "Verify your mobile number before submitting."

  if (Object.keys(errors).length > 0) {
    await markAttempt(gate.ctx, "contact", gate.ctx.ip, "validation_failed")
    return NextResponse.json({ ok: false, errors }, { status: 422 })
  }

  try {
    await consumeSignupPhoneVerification({
      phone,
      countryCode,
      verificationToken: String(body.verificationToken || ""),
      verificationId: String(body.verificationId || ""),
    })
  } catch {
    await markAttempt(gate.ctx, "contact", gate.ctx.ip, "otp_required")
    return NextResponse.json({ ok: false, code: "otp_required", errors: { phone: "Verify your mobile number before submitting." } }, { status: 403 })
  }

  const customer = await prisma.customer.upsert({
    where: { email },
    update: {
      name,
      phone: phone || undefined,
      company: company || undefined,
      metadata: {
        contactSource: "contact_form",
      } as any,
    },
    create: {
      email,
      name,
      phone: phone || undefined,
      company: company || undefined,
      metadata: {
        contactSource: "contact_form",
      } as any,
    },
  })

  const ticketNumber = generateTicketNumber()
  const ticket = await prisma.supportTicket.create({
    data: {
      ticketNumber,
      customerId: customer.id,
      subject: `Contact request from ${name}`,
      category: "pre_sales",
      priority: "medium",
      source: "contact_form",
      metadata: {
        company,
        phone,
      } as any,
    },
  })

  await prisma.supportTicketMessage.create({
    data: {
      ticketId: ticket.id,
      customerId: customer.id,
      senderType: "client",
      body: message,
    },
  })

  try {
    const site = await getPublicSiteSettings()
    const supportEmail = site.supportEmail || site.companyEmail

    await sendEmail({
      to: supportEmail,
      subject: `[${ticket.ticketNumber}] New contact submission`,
      text: `Ticket ${ticket.ticketNumber}\nFrom: ${name} <${email}>\nPhone: ${phone || "-"}\nCompany: ${company || "-"}\n\n${message}`,
    })

    await sendEmail({
      to: email,
      subject: `We received your request (${ticket.ticketNumber})`,
      text: `Hi ${name},\n\nThanks for contacting ${site.brandName}. We created ticket ${ticket.ticketNumber} and our team will get back to you soon.\n\nMessage:\n${message}`,
    })
  } catch {
    // Keep contact flow resilient even if SMTP fails.
  }

  await markAttempt(gate.ctx, "contact", gate.ctx.ip, "submitted")
  return NextResponse.json({ ok: true, ticketNumber }, { status: 200 })
}
