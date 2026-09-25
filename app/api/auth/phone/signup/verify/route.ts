import { NextRequest, NextResponse } from "next/server"
import { verifySignupPhoneOtp } from "@/lib/auth/phone-verification"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function safeVerifyMessage(status: unknown, error: any) {
  const value = Number(status || 400)
  if (value === 429) return "Too many attempts. Try again later."
  if (/expired/i.test(String(error?.message || ""))) return "Code expired. Please request a new code."
  if (/invalid/i.test(String(error?.message || ""))) return "Invalid code."
  if (value >= 500) return error?.message || "Unable to verify verification code."
  return "Unable to verify verification code."
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await verifySignupPhoneOtp({
      request,
      verificationId: String(body?.verificationId || ""),
      phone: String(body?.phone || ""),
      countryCode: String(body?.countryCode || ""),
      otp: String(body?.otp || ""),
    })
    console.log("[OTP_VERIFY_SUCCESS]", { phone: result.phone.replace(/\d(?=\d{2})/g, "*"), verificationId: String(body?.verificationId || "") })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error("[OTP_VERIFY_FAILED]", error)
    const status = Number(error?.status || 400)
    if (status >= 500) {
      const normalized = otpErrorResponse(error, "verification")
      return NextResponse.json(normalized.body, { status: normalized.status })
    }
    return NextResponse.json({
      success: false,
      code: /expired/i.test(String(error?.message || "")) ? "otp_expired" : /invalid/i.test(String(error?.message || "")) ? "otp_invalid" : "otp_verify_failed",
      stage: "verification",
      message: safeVerifyMessage(status, error),
      retryable: status === 429,
    }, { status: status >= 400 && status < 500 ? status : 503 })
  }
}
