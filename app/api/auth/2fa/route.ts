import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSetting, type SecuritySettings } from "@/lib/settings"
import { issueClientSession, issueStaffSession } from "@/lib/auth-flows"
import { buildMfaContext, incrementMfaAttempt, mfaChallengeFailure, sendLoginSuccessAlert, verifyOtpChallengeDetailed } from "@/lib/auth/mfa/orchestrator"
import { consumeBackupCode, verifyTotpForSubjectDetailed } from "@/lib/auth/mfa/totp"
import { ensureMfaSettings } from "@/lib/auth/mfa/settings"
import { logSecurityEvent } from "@/lib/auth/mfa/events"
import { clearEmergencyTrustedDeviceConsumption, findEmergencyTrustedDevice, markEmergencyTrustedDeviceConsumed, trustDevice } from "@/lib/auth/mfa/trusted-devices"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { normalizeStaffRole } from "@/lib/roles"
import { getValidMfaChallenge, pruneExpiredMfaChallenges, verifyMfaChallenge } from "@/lib/auth/mfa/challenges"
import { safeApiError, withSafeApiRoute } from "@/lib/api-route-wrapper"

function authError(code: string, message: string, status: number) {
  const reason = code === "mfa_session_expired" || code === "mfa_code_expired" ? "expired_or_invalid" : "verification_failed"
  return NextResponse.json({ success: false, reason, error: message, message, code }, { status })
}

async function resolveSubject(challenge: any): Promise<MfaSubject | null> {
  if (challenge.userType === "admin") {
    const admin = await prisma.adminProfile.findUnique({ where: { id: challenge.userId } })
    if (!admin?.isActive) return null
    return {
      userType: "admin",
      userId: admin.id,
      role: normalizeStaffRole(admin.role) || "admin",
      email: admin.email,
      name: admin.displayName,
      phone: (admin as any).whatsappMfaEnabled && (admin as any).phoneVerified ? (admin as any).phone : null,
      phoneVerified: (admin as any).phoneVerified,
      hashedPassword: admin.hashedPassword,
      legacyTotpEnabled: admin.twoFactorEnabled,
      legacyTotpSecret: admin.twoFactorSecret,
      legacyBackupCodes: admin.twoFactorBackupCodes,
    }
  }
  const customer = await prisma.customer.findUnique({ where: { id: challenge.userId } })
  if (!customer?.isActive || customer.status === "BANNED" || customer.status === "CLOSED") return null
  return {
    userType: "customer",
    userId: customer.id,
    role: "client",
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    phoneVerified: customer.phoneVerified,
    hashedPassword: customer.hashedPassword,
    legacyTotpEnabled: customer.twoFactorEnabled,
    legacyTotpSecret: customer.twoFactorSecret,
    legacyBackupCodes: customer.twoFactorBackupCodes,
  }
}

export const POST = withSafeApiRoute(async function POST(request: NextRequest) {
  try {
    await pruneExpiredMfaChallenges().catch(() => null)
    const body = (await request.json().catch(() => ({}))) as { challengeToken?: string; code?: string; trustDevice?: boolean; method?: string }
    const challengeToken = String(body.challengeToken || "")
    const code = String(body.code || "").trim()

    if (!challengeToken) return authError("mfa_session_expired", "Session expired", 401)

    const challenge = await getValidMfaChallenge(challengeToken)
    console.info("[MFA] challenge found", {
      found: Boolean(challenge),
      serverTimestamp: new Date().toISOString(),
      tokenAgeSeconds: challenge?.createdAt ? Math.floor((Date.now() - new Date(challenge.createdAt).getTime()) / 1000) : null,
    })
    if (!challenge || !challenge.method) {
      return authError("mfa_session_expired", "Session expired", 401)
    }

    const subject = await resolveSubject(challenge)
    console.info("[MFA] user found", { found: Boolean(subject), userType: challenge.userType, userId: challenge.userId })
    if (!subject) return authError("auth_unavailable", "Authentication is unavailable for this account", 503)
    const context = await buildMfaContext(request, subject)

    let verified = false
    let methodFailure: { code: string; message: string; status: number } | null = null
    const method = String(body.method || challenge.method)
    if (method !== "trusted_device" && !code) return authError("invalid_mfa_code", "Verification code is required", 400)
    if (method === "totp") {
      const result = await verifyTotpForSubjectDetailed(subject, code)
      verified = result.ok
      if (!result.ok) methodFailure = result
    } else if (method === "recovery") {
      verified = await consumeBackupCode(subject, code)
    } else if (method === "whatsapp" || method === "email") {
      const result = await verifyOtpChallengeDetailed(challenge, subject, code)
      verified = result.ok
      if (!result.ok) methodFailure = result
    } else if (method === "trusted_device") {
      const metadata = challenge.metadata && typeof challenge.metadata === "object" ? challenge.metadata as Record<string, any> : {}
      const eligible = await findEmergencyTrustedDevice({ request, subject, fingerprint: context.fingerprint, device: context.device, risk: context.risk })
      verified = Boolean(
        subject.userType === "admin" &&
        challenge.userType === "admin" &&
        metadata.emergencyTrustedDevice === true &&
        metadata.trustedDeviceId &&
        eligible?.trusted?.id === metadata.trustedDeviceId
      )
      if (verified) {
        verified = await markEmergencyTrustedDeviceConsumed({
          trustedDeviceId: String(metadata.trustedDeviceId),
          challengeId: challenge.id,
          reason: typeof metadata.emergencyReason === "string" ? metadata.emergencyReason : "otp_delivery_unavailable",
        })
      }
    }

    if (!verified) {
      await incrementMfaAttempt(challenge.id)
      const failure = methodFailure || mfaChallengeFailure(challenge)
      await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "mfa_failure", device: context.device, riskLevel: context.risk.level, metadata: { method, code: failure.code } })
      return authError(failure.code, failure.message, failure.status)
    }

    const settings = await ensureMfaSettings(subject)
    await verifyMfaChallenge(challenge.id)
    await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "mfa_success", device: context.device, riskLevel: context.risk.level, metadata: { method } })

    const security = await getSetting<SecuritySettings>("security_settings")
    let session: { authenticated: true; redirectTo: string; role: string }
    if (subject.userType === "admin") {
      const admin = await prisma.adminProfile.findUnique({ where: { id: subject.userId } })
      if (!admin) return authError("auth_unavailable", "Authentication is unavailable for this account", 503)
      const emergency = method === "trusted_device"
      session = await issueStaffSession(admin, emergency ? 30 : security.sessionTimeoutMinutes, request, {
        device: context.device,
        fingerprint: context.fingerprint,
        risk: context.risk,
        trustedDeviceId: emergency ? String((challenge.metadata as any)?.trustedDeviceId || "") : null,
        mfaVerifiedAt: emergency ? null : new Date(),
      })
      await prisma.adminProfile.update({ where: { id: admin.id }, data: { lastLogin: new Date() } }).catch(() => null)
    } else {
      const customer = await prisma.customer.findUnique({ where: { id: subject.userId } })
      if (!customer) return authError("auth_unavailable", "Authentication is unavailable for this account", 503)
      session = await issueClientSession(customer, security.sessionTimeoutMinutes, request, {
        device: context.device,
        fingerprint: context.fingerprint,
        risk: context.risk,
      })
    }

    const response = NextResponse.json({ success: true, ...session })
    if (body.trustDevice && !context.risk.forceMfa) {
      const trusted = await trustDevice({
        response,
        subject,
        fingerprint: context.fingerprint,
        device: context.device,
        risk: context.risk,
        days: Number(settings?.trustedDeviceDays || 30),
      })
      await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "trusted_device_added", device: context.device, riskLevel: context.risk.level, metadata: { trustedDeviceId: trusted.id } })
    }
    if (method !== "trusted_device") {
      await clearEmergencyTrustedDeviceConsumption({ subject, fingerprint: context.fingerprint }).catch(() => null)
    }
    if (method === "trusted_device") {
      await logSecurityEvent({
        userType: subject.userType,
        userId: subject.userId,
        eventType: "admin_emergency_mfa_bypass_used",
        device: context.device,
        riskLevel: context.risk.level,
        metadata: { challengeId: challenge.id, trustedDeviceId: String((challenge.metadata as any)?.trustedDeviceId || "") },
      })
    }
    await logSecurityEvent({ userType: subject.userType, userId: subject.userId, eventType: "login_success", device: context.device, riskLevel: context.risk.level, metadata: { method } })
    await sendLoginSuccessAlert(subject, context)
    return response
  } catch (error) {
    console.error("[MFA] verify_failed", error)
    return safeApiError("auth_unavailable", "Session expired", 401, "expired_or_invalid")
  }
})
