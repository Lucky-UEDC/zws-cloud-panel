import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { deliverPasswordResetLink, PASSWORD_RESET_EXPIRES_MINUTES } from "@/lib/auth/password-reset-delivery"
import { markAttempt, requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { validateSecurityField } from "@/lib/security/input"
import { rejectDetectedPayload } from "@/lib/security/abuse"

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response

  const body = (await request.json()) as { email?: string; turnstileToken?: string }
  const captcha = await requireTurnstile(gate.ctx, body.turnstileToken, "forgotPassword")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "forgot_password", 5, 60 * 60_000)
  if (!rate.ok) return rate.response
  const email = String(body.email || "").trim().toLowerCase()
  const emailResult = validateSecurityField(email, "email", "Email")
  if (!emailResult.ok) {
    await markAttempt(gate.ctx, "forgot_password", gate.ctx.ip, "validation_failed")
    if (emailResult.detection.dangerous) return rejectDetectedPayload(gate.ctx, emailResult.detection, "email")
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
  }

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    await markAttempt(gate.ctx, "forgot_password", gate.ctx.ip, "validation_failed")
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 })
  }

  const customer = await prisma.customer.findUnique({ where: { email }, select: { id: true, email: true, name: true, phone: true, whatsappOptIn: true } })
  if (!customer) {
    await markAttempt(gate.ctx, "forgot_password", gate.ctx.ip, "unknown_email")
    return NextResponse.json({ success: true })
  }

  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 1000 * 60 * PASSWORD_RESET_EXPIRES_MINUTES)

  await prisma.passwordResetToken.create({
    data: {
      customerId: customer.id,
      token,
      expiresAt,
    },
  })

  try {
    await deliverPasswordResetLink({ customer, token, source: "forgot_password", expiresAt })
  } catch {
    // Keep response generic.
  }

  await markAttempt(gate.ctx, "forgot_password", gate.ctx.ip, "requested")
  return NextResponse.json({ success: true })
}
