import { NextRequest, NextResponse } from "next/server"
import { beginMfaOrBypass } from "@/lib/auth/mfa/orchestrator"
import { resolveMfaSubject } from "@/lib/auth/mfa/subjects"
import { ensureMfaSettings, getMfaMethodAvailability } from "@/lib/auth/mfa/settings"
import type { MfaMethod } from "@/lib/auth/mfa/types"
import { getValidMfaChallenge, pruneExpiredMfaChallenges, verifyMfaChallenge } from "@/lib/auth/mfa/challenges"
import { withSafeApiRoute } from "@/lib/api-route-wrapper"

const allowedMethods = new Set<MfaMethod>(["totp", "whatsapp", "email", "recovery"])

function jsonError(code: string, message: string, status = 400) {
  return NextResponse.json({ success: false, error: message, code }, { status })
}

export const POST = withSafeApiRoute(async function POST(request: NextRequest) {
  try {
    await pruneExpiredMfaChallenges().catch(() => null)
    const body = await request.json().catch(() => ({}))
    const challenge = await getValidMfaChallenge(String(body?.challengeToken || ""))
    if (!challenge?.method) return jsonError("mfa_session_expired", "Verification expired. Try next code.", 401)

    const method = String(body?.method || "") as MfaMethod
    if (!allowedMethods.has(method)) return jsonError("unsupported_mfa_method", "Unsupported verification method.", 400)

    const subject = await resolveMfaSubject(challenge.userType, challenge.userId)
    if (!subject) return jsonError("auth_unavailable", "Authentication is unavailable for this account.", 403)

    const settings = await ensureMfaSettings(subject)
    const availability = getMfaMethodAvailability(subject, settings)
    if (!availability[method]) return jsonError("mfa_method_unavailable", "This verification method is not available for your account.", 400)

    const next = await beginMfaOrBypass({ request, subject, preferredMethod: method })
    await verifyMfaChallenge(challenge.id).catch(() => null)
    return NextResponse.json({
      success: true,
      method,
      challengeToken: next.challengeToken,
      maskedTarget: next.maskedTarget,
      expiresAt: next.expiresAt,
      otpExpiresAt: next.otpExpiresAt,
      fallbackMessage: next.fallbackMessage,
      methods: availability,
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error?.message || "Unable to switch verification method.",
      code: error?.code || "mfa_method_switch_failed",
      provider: error?.code?.includes?.("whatsapp") ? "whatsapp" : error?.code?.includes?.("email") ? "email" : null,
      metadata: error?.metadata || null,
    }, { status: error?.status || 500 })
  }
})
