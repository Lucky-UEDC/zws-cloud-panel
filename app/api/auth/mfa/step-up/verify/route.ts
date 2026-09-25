import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { assertOtpChallenge, buildMfaContext, incrementMfaAttempt, mfaChallengeFailure } from "@/lib/auth/mfa/orchestrator"
import { consumeBackupCode, verifyTotpForSubjectDetailed } from "@/lib/auth/mfa/totp"
import { logSecurityEvent } from "@/lib/auth/mfa/events"
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { markSessionMfaVerified } from "@/lib/auth/session-store"
import { getValidMfaChallenge, verifyMfaChallenge } from "@/lib/auth/mfa/challenges"

function error(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: message, code }, { status })
}

export async function POST(request: NextRequest) {
  try {
    const subject = await getCurrentMfaSubject()
    if (!subject || subject.userType !== "admin") return error("unauthorized", "Unauthorized", 401)
    const body = await request.json().catch(() => ({}))
    const challengeToken = String(body.challengeToken || "")
    const code = String(body.code || "").trim()
    if (!challengeToken || !code) return error("invalid_mfa_code", "Verification code is required", 400)

    const challenge = await getValidMfaChallenge(challengeToken)
    if (!challenge || challenge.userType !== "admin" || challenge.userId !== subject.userId || !challenge.method) {
      return error("mfa_session_expired", "Session expired", 401)
    }

    const method = String(body.method || challenge.method)
    let verified = false
    let methodFailure: { code: string; message: string; status: number } | null = null
    if (method === "totp") {
      const result = await verifyTotpForSubjectDetailed(subject, code)
      verified = result.ok
      if (!result.ok) methodFailure = result
    }
    if (method === "recovery") verified = await consumeBackupCode(subject, code)
    if (method === "whatsapp" || method === "email") verified = await assertOtpChallenge(challenge, subject, code)

    const context = await buildMfaContext(request, subject)
    if (!verified) {
      await incrementMfaAttempt(challenge.id)
      const failure = methodFailure || mfaChallengeFailure(challenge)
      await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "step_up_mfa_failure", device: context.device, riskLevel: context.risk.level, metadata: { method, code: failure.code } })
      return error(failure.code, failure.message, failure.status)
    }

    await verifyMfaChallenge(challenge.id)
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value
    const marked = await markSessionMfaVerified(sessionToken)
    if (!marked) return error("session_unavailable", "Session expired", 401)
    await prisma.adminProfile.update({ where: { id: subject.userId }, data: { lastLogin: new Date() } }).catch(() => null)
    await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "step_up_mfa_success", device: context.device, riskLevel: context.risk.level, metadata: { method } })
    return NextResponse.json({ success: true, verifiedAt: new Date().toISOString() })
  } catch (err) {
    console.error("[MFA] step_up_verify_failed", err)
    return error("auth_unavailable", "Session expired", 401)
  }
}
