import { prisma } from "@/lib/db"
import type { DeviceContext, RiskAssessment } from "@/lib/auth/mfa/types"

export async function assessLoginRisk(input: {
  userType: string
  userId: string
  device: DeviceContext
  fingerprint: string
}): Promise<RiskAssessment> {
  const [previousSession, sameDevice, recentFailures] = await Promise.all([
    (prisma as any).userLoginSession.findFirst({
      where: { userType: input.userType, userId: input.userId },
      orderBy: { createdAt: "desc" },
    }).catch(() => null),
    (prisma as any).userTrustedDevice.findFirst({
      where: { userType: input.userType, userId: input.userId, deviceFingerprint: input.fingerprint, revokedAt: null, trustedUntil: { gt: new Date() } },
    }).catch(() => null),
    (prisma as any).userSecurityEvent.count({
      where: {
        userType: input.userType,
        userId: input.userId,
        eventType: { in: ["login_failure", "mfa_failure"] },
        createdAt: { gt: new Date(Date.now() - 30 * 60_000) },
      },
    }).catch(() => 0),
  ])

  const reasons: string[] = []
  let score = 0

  if (!sameDevice) {
    score += 25
    reasons.push("new_device")
  }
  if (input.device.proxy) {
    score += 30
    reasons.push("proxy_or_hosting_network")
  }
  if (previousSession?.country && input.device.country && previousSession.country !== input.device.country) {
    score += 35
    reasons.push("new_country")
  }
  if (previousSession?.asn && input.device.asn && previousSession.asn !== input.device.asn) {
    score += 15
    reasons.push("unusual_asn")
  }
  if (recentFailures >= 3) {
    score += 30
    reasons.push("repeated_failures")
  }

  const level = score >= 80 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low"
  return { level, score, reasons, forceMfa: level === "high" || level === "critical" }
}

