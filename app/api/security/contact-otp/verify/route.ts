import { NextRequest, NextResponse } from "next/server"
import { verifySignupPhoneOtp } from "@/lib/auth/phone-verification"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"
import { requireRateLimit, securityGate } from "@/lib/security/forms"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const rate = await requireRateLimit(gate.ctx, "contact_otp_verify", 5, 15 * 60_000)
  if (!rate.ok) return rate.response

  try {
    const body = await request.json().catch(() => ({}))
    const result = await verifySignupPhoneOtp({
      request,
      verificationId: String(body?.verificationId || ""),
      phone: String(body?.phone || ""),
      countryCode: String(body?.countryCode || ""),
      otp: String(body?.otp || ""),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    const status = Number(error?.status || 400)
    if (status >= 500) {
      const normalized = otpErrorResponse(error, "verification")
      return NextResponse.json(normalized.body, { status: normalized.status })
    }
    return NextResponse.json({
      success: false,
      code: /expired/i.test(String(error?.message || "")) ? "otp_expired" : /invalid/i.test(String(error?.message || "")) ? "otp_invalid" : "otp_invalid",
      message: status === 429 ? "Too many attempts. Try again later." : "Invalid or expired OTP.",
    }, { status: status >= 400 && status < 500 ? status : 400 })
  }
}
