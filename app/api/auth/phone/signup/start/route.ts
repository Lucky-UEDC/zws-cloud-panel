import { NextRequest, NextResponse } from "next/server"
import { startSignupPhoneVerification } from "@/lib/auth/phone-verification"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const result = await startSignupPhoneVerification({
      request,
      phone: String(body?.phone || ""),
      countryCode: String(body?.countryCode || ""),
      firstName: String(body?.firstName || ""),
    })
    console.log("[OTP_SEND_SUCCESS]", { phone: result.maskedPhone, countryCode: result.countryCode, verificationId: result.verificationId })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error("[OTP_SEND_FAILED]", error)
    const { status, body } = otpErrorResponse(error, "worker_dispatch")
    return NextResponse.json(body, { status })
  }
}
