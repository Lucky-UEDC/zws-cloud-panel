import { NextRequest, NextResponse } from "next/server"
import { getValidAuthChallenge, pruneExpiredChallenges } from "@/lib/auth-flows"
import { sendCustomerPhoneOtp } from "@/lib/whatsapp/otp"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    await pruneExpiredChallenges().catch(() => null)
    const body = await request.json().catch(() => ({}))
    const challenge = await getValidAuthChallenge(String(body?.challengeToken || ""))
    if (!challenge || challenge.userType !== "customer" || challenge.role !== "phone_verification") {
      return NextResponse.json({ ok: false, error: "Your verification session expired. Please sign in again." }, { status: 401 })
    }
    const result = await sendCustomerPhoneOtp({ customerId: challenge.userId })
    return NextResponse.json({ ...result, success: true })
  } catch (err: any) {
    const { status, body } = otpErrorResponse(err, "worker_dispatch")
    return NextResponse.json({ ok: false, error: body.message, ...body }, { status })
  }
}
