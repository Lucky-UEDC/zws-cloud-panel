import type { NextRequest } from "next/server"
import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import type { DeviceContext, MfaSubject, RiskAssessment } from "@/lib/auth/mfa/types"

function hashSessionId(sessionId: string) {
  return crypto.createHash("sha256").update(sessionId).digest("hex")
}

export async function recordLoginSession(input: {
  sessionId?: string | null
  sessionIdHash?: string | null
  subject: MfaSubject
  device: DeviceContext
  fingerprint: string
  risk: RiskAssessment
  trustedDeviceId?: string | null
  expiresAt: Date
}) {
  const sessionIdHash = input.sessionIdHash || (input.sessionId ? hashSessionId(input.sessionId) : null)
  if (!sessionIdHash) return null
  return (prisma as any).userLoginSession.upsert({
    where: { sessionIdHash },
    create: {
      sessionIdHash,
      userType: input.subject.userType,
      userId: input.subject.userId,
      role: input.subject.role,
      email: input.subject.email,
      deviceFingerprint: input.fingerprint,
      trustedDeviceId: input.trustedDeviceId || null,
      browser: input.device.browser,
      os: input.device.os,
      deviceType: input.device.deviceType,
      ip: input.device.ip,
      city: input.device.city,
      region: input.device.region,
      country: input.device.country,
      timezone: input.device.timezone,
      platform: input.device.platform,
      asn: input.device.asn,
      provider: input.device.provider,
      riskLevel: input.risk.level,
      expiresAt: input.expiresAt,
    },
    update: {
      lastSeenAt: new Date(),
      trustedDeviceId: input.trustedDeviceId || undefined,
      riskLevel: input.risk.level,
    },
  }).then(async (row: any) => {
    await (prisma as any).userSecurityEvent.create({
      data: {
        userType: input.subject.userType,
        userId: input.subject.userId,
        eventType: "login_success",
        ip: input.device.ip,
        country: input.device.country,
        city: input.device.city,
        region: input.device.region,
        browser: input.device.browser,
        os: input.device.os,
        deviceType: input.device.deviceType,
        riskLevel: input.risk.level,
        metadata: {
          sessionIdHash,
          trustedDeviceId: input.trustedDeviceId || null,
          fingerprint: input.fingerprint,
          timezone: input.device.timezone,
          platform: input.device.platform,
          asn: input.device.asn,
          provider: input.device.provider,
          proxy: input.device.proxy,
          vpn: input.device.vpn || false,
          tor: input.device.tor || false,
          relay: input.device.relay || false,
          riskScore: input.risk.score,
          riskReasons: input.risk.reasons,
        },
      },
    }).catch(() => null)
    return row
  }).catch(() => null)
}

export async function updateLoginSessionSeen(request: NextRequest, sessionId?: string | null) {
  if (!sessionId) return
  await (prisma as any).userLoginSession.updateMany({
    where: { sessionIdHash: hashSessionId(sessionId), revokedAt: null },
    data: { lastSeenAt: new Date() },
  }).catch(() => null)
}

export async function revokeTrackedSessionByHash(sessionIdHash: string) {
  await (prisma as any).userLoginSession.updateMany({
    where: { sessionIdHash, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => null)
}
