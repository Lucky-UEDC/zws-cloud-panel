import { NextRequest, NextResponse } from "next/server"
import { startSignupPhoneVerification } from "@/lib/auth/phone-verification"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response

  try {
    const body = await request.json().catch(() => ({}))
    const captcha = await requireTurnstile(gate.ctx, body?.turnstileToken, "contact")
    if (!captcha.ok) return captcha.response
    const rate = await requireRateLimit(gate.ctx, "contact_otp_start", 3, 15 * 60_000)
    if (!rate.ok) return rate.response
    const result = await startSignupPhoneVerification({
      request,
      phone: String(body?.phone || ""),
      countryCode: String(body?.countryCode || ""),
      firstName: String(body?.firstName || ""),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    const { status, body } = otpErrorResponse(error, "worker_dispatch")
    return NextResponse.json(body, { status })
  }
}
