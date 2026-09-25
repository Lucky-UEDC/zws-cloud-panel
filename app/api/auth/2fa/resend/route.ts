import { NextRequest, NextResponse } from "next/server"
import { resolveMfaSubject } from "@/lib/auth/mfa/subjects"
import { resendMfaOtp } from "@/lib/auth/mfa/orchestrator"
import { getValidMfaChallenge, pruneExpiredMfaChallenges } from "@/lib/auth/mfa/challenges"
import { withSafeApiRoute } from "@/lib/api-route-wrapper"
import { ensureMfaSettings, getMfaMethodAvailability } from "@/lib/auth/mfa/settings"

export const POST = withSafeApiRoute(async function POST(request: NextRequest) {
  try {
    await pruneExpiredMfaChallenges().catch(() => null)
    const body = await request.json().catch(() => ({}))
    const challenge = await getValidMfaChallenge(String(body?.challengeToken || ""))
    if (!challenge?.method) return NextResponse.json({ success: false, reason: "expired_or_invalid", code: "mfa_session_expired", error: "Your verification session expired. Please sign in again." }, { status: 401 })
    const subject = await resolveMfaSubject(challenge.userType, challenge.userId)
    if (!subject) return NextResponse.json({ success: false, code: "auth_unavailable", error: "Account unavailable" }, { status: 403 })
    const settings = await ensureMfaSettings(subject)
    const result = await resendMfaOtp({ request, challenge, subject })
    const availableMethods = { ...getMfaMethodAvailability(subject, settings), trusted_device: result?.method === "trusted_device" }
    return NextResponse.json({
      success: true,
      method: result?.method || challenge.method,
      maskedTarget: result?.maskedTarget || null,
      otpExpiresAt: result?.expiresAt || null,
      fallbackMessage: result?.fallbackMessage || null,
      retryAfterSeconds: null,
      cooldownUntil: null,
      availableMethods,
    })
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      code: error?.code || "mfa_resend_failed",
      error: error?.message || "Failed to resend code",
      retryAfterSeconds: error?.retryAfterSeconds || null,
      cooldownUntil: error?.cooldownUntil || null,
    }, { status: error?.status || 500 })
  }
})
