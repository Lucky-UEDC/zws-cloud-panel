import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { ensureMfaSettings, getMfaMethodAvailability, hasUsableMfaMethod } from "@/lib/auth/mfa/settings"
import { prisma } from "@/lib/db"
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { resolveSession } from "@/lib/auth/session-store"
import { getRuntimeSecurityPolicy } from "@/lib/security-policy"

export async function GET() {
  const subject = await getCurrentMfaSubject()
  if (!subject) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const settings = await ensureMfaSettings(subject)
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(subject.userType === "admin" ? SESSION_COOKIE_NAMES.admin : SESSION_COOKIE_NAMES.client)?.value
  const session = await resolveSession(sessionToken, subject.userType === "admin" ? "admin" : "client").catch(() => null)
  const whatsappStatusPromise = async () => {
    const { getSafeWhatsAppStatus } = await import("@/lib/whatsapp/client")
    return getSafeWhatsAppStatus().catch(() => null)
  }
  const [trustedDevices, activeSessions, backupCodes, events, adminRow, securityPolicy, whatsappStatus] = await Promise.all([
    (prisma as any).userTrustedDevice.findMany({
      where: { userType: subject.userType, userId: subject.userId, revokedAt: null, trustedUntil: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      take: 20,
    }).catch(() => []),
    (prisma as any).userLoginSession.findMany({
      where: { userType: subject.userType, userId: subject.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      take: 20,
    }).catch(() => []),
    (prisma as any).userBackupCode.count({
      where: { userType: subject.userType, userId: subject.userId, usedAt: null },
    }).catch(() => 0),
    (prisma as any).userSecurityEvent.findMany({
      where: { userType: subject.userType, userId: subject.userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }).catch(() => []),
    subject.userType === "admin"
      ? prisma.adminProfile.findUnique({ where: { id: subject.userId }, select: { lastLogin: true, phone: true, phoneVerified: true } }).catch(() => null)
      : null,
    subject.userType === "admin" ? getRuntimeSecurityPolicy().catch(() => null) : Promise.resolve(null),
    subject.userType === "admin" ? whatsappStatusPromise() : Promise.resolve(null),
  ])
  const methods = getMfaMethodAvailability(subject, settings)
  return NextResponse.json({
    email: subject.email,
    role: subject.role,
    displayName: subject.name,
    defaultMethod: settings.defaultMethod,
    methods,
    mfaConfigured: hasUsableMfaMethod(subject, settings),
    whatsappEnabled: settings.whatsappEnabled,
    totpEnabled: settings.totpEnabled,
    twoFactorEnabled: settings.totpEnabled,
    emailFallbackEnabled: settings.emailFallbackEnabled,
    emailEnabled: settings.emailFallbackEnabled,
    recoveryCodesEnabled: settings.recoveryCodesEnabled,
    backupCodesRemaining: backupCodes,
    trustedDeviceDays: settings.trustedDeviceDays,
    lastMfaVerification: session?.mfaVerifiedAt || null,
    lastLogin: adminRow?.lastLogin || null,
    phone: adminRow?.phone || subject.phone || null,
    phoneVerified: adminRow?.phoneVerified || subject.phoneVerified || false,
    securityPolicy,
    whatsappStatus,
    trustedDevices,
    activeSessions,
    securityEvents: events,
  })
}
