import { NextRequest, NextResponse } from "next/server"
import { sendCustomerPhoneOtp } from "@/lib/whatsapp/otp"
import { resolveOtpCustomer } from "../_shared"
import { otpErrorResponse, WhatsAppOtpError } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const customer = await resolveOtpCustomer(body)
    if (!customer) throw new WhatsAppOtpError({ code: "customer_not_found", stage: "customer_lookup", status: 404, retryable: false })
    const result = await sendCustomerPhoneOtp({ customerId: customer.id })
    console.log("[OTP_SEND_SUCCESS]", { customerId: customer.id })
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error("[OTP_SEND_FAILED]", error)
    const { status, body } = otpErrorResponse(error, "worker_dispatch")
    return NextResponse.json(body, { status })
  }
}
