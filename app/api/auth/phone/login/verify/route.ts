import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { consumeAuthChallengeById, getValidAuthChallenge, pruneExpiredChallenges, issueClientSession } from "@/lib/auth-flows"
import { getSetting, type SecuritySettings } from "@/lib/settings"
import { verifyCustomerPhoneOtp } from "@/lib/whatsapp/otp"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { sendNotification } from "@/lib/notifications/service"
import { extractClientIp } from "@/lib/request-context"
import { otpErrorResponse } from "@/lib/whatsapp/otp-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function error(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, code, error: message }, { status })
}

export async function POST(request: NextRequest) {
  try {
    await pruneExpiredChallenges().catch(() => null)
    const body = await request.json().catch(() => ({}))
    const challengeToken = String(body?.challengeToken || "").trim()
    const otp = String(body?.otp || "").trim()
    if (!challengeToken || !otp) return error("invalid_phone_verification", "Verification code is required.")

    const challenge = await getValidAuthChallenge(challengeToken)
    if (!challenge || challenge.userType !== "customer" || challenge.role !== "phone_verification") {
      return error("phone_challenge_expired", "Your verification session expired. Please sign in again.", 401)
    }

    await verifyCustomerPhoneOtp({ customerId: challenge.userId, otp })
    const customer = await prisma.customer.findUnique({ where: { id: challenge.userId } })
    if (!customer || !customer.isActive || customer.status === "BANNED" || customer.status === "CLOSED") {
      return error("auth_unavailable", "Unable to complete sign in for this account.", 403)
    }

    await consumeAuthChallengeById(challenge.id)
    const security = await getSetting<SecuritySettings>("security_settings")
    const session = await issueClientSession(customer, security.sessionTimeoutMinutes, request)
    await sendNotification({
      type: "login",
      channels: ["email", "whatsapp"],
      user: { id: customer.id, email: customer.email, phone: customer.phone, name: customer.name },
      data: {
        templateKey: WHATSAPP_TEMPLATE_KEYS.LOGIN_ALERT,
        userName: customer.name || "there",
        email: customer.email,
        loginIp: extractClientIp(request),
        loginTime: new Date().toLocaleString("en-IN"),
        metadata: { source: "phone_verified_login" },
      },
    }).catch(() => null)
    return NextResponse.json({ ok: true, success: true, ...session })
  } catch (err: any) {
    const status = Number(err?.status || 400)
    if (status >= 500) {
      const normalized = otpErrorResponse(err, "verification")
      return NextResponse.json({ ok: false, error: normalized.body.message, ...normalized.body }, { status: normalized.status })
    }
    return error("invalid_phone_verification", err?.message || "Failed to verify phone.", status)
  }
}
