import { NextRequest, NextResponse } from "next/server"
import { verifyCustomerPhoneOtp } from "@/lib/whatsapp/otp"
import { resolveOtpCustomer } from "../_shared"
import { otpErrorResponse, WhatsAppOtpError } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const customer = await resolveOtpCustomer(body)
    if (!customer) throw new WhatsAppOtpError({ code: "customer_not_found", stage: "customer_lookup", status: 404, retryable: false })
    const result = await verifyCustomerPhoneOtp({ customerId: customer.id, otp: String(body?.otp || "") })
    console.log("[OTP_VERIFY_SUCCESS]", { customerId: customer.id })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error("[OTP_VERIFY_FAILED]", error)
    const status = Number(error?.status || 400)
    if (status >= 500) {
      const normalized = otpErrorResponse(error, "verification")
      return NextResponse.json(normalized.body, { status: normalized.status })
    }
    const message = status === 429
      ? "Too many attempts. Please request a new code."
      : /expired/i.test(String(error?.message || ""))
        ? "Code expired. Please request a new code."
        : /invalid/i.test(String(error?.message || ""))
          ? "Invalid code."
          : "Unable to verify verification code."
    return NextResponse.json({
      success: false,
      code: /expired/i.test(String(error?.message || "")) ? "otp_expired" : /invalid/i.test(String(error?.message || "")) ? "otp_invalid" : "otp_verify_failed",
      stage: "verification",
      message,
      retryable: status === 429,
    }, { status: status >= 400 && status < 500 ? status : 503 })
  }
}
