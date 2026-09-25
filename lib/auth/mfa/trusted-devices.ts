import type { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { hashMfaValue, randomToken } from "@/lib/auth/mfa/crypto"
import type { DeviceContext, MfaSubject, RiskAssessment } from "@/lib/auth/mfa/types"

export const TRUSTED_DEVICE_COOKIE = "__Host-zws_trusted_device"
const EMERGENCY_RECENT_MFA_DAYS = Number(process.env.ADMIN_EMERGENCY_MFA_RECENT_DAYS || 30)

export function trustedCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  }
}

export async function findTrustedDevice(input: {
  request: NextRequest
  subject: MfaSubject
  fingerprint: string
  risk: RiskAssessment
}) {
  if (input.risk.forceMfa) return null
  const token = input.request.cookies.get(TRUSTED_DEVICE_COOKIE)?.value
  if (!token) return null
  const trustedTokenHash = hashMfaValue("trusted", token)
  const device = await (prisma as any).userTrustedDevice.findFirst({
    where: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      trustedTokenHash,
      deviceFingerprint: input.fingerprint,
      revokedAt: null,
      trustedUntil: { gt: new Date() },
    },
  }).catch(() => null)
  if (!device) return null
  await (prisma as any).userTrustedDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } }).catch(() => null)
  return device
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function sameNullableRegion(expected?: string | null, actual?: string | null) {
  const left = String(expected || "").trim().toLowerCase()
  const right = String(actual || "").trim().toLowerCase()
  if (!left || !right) return true
  return left === right
}

export async function findEmergencyTrustedDevice(input: {
  request: NextRequest
  subject: MfaSubject
  fingerprint: string
  device: DeviceContext
  risk: RiskAssessment
}) {
  if (input.subject.userType !== "admin") return null
  if (input.risk.forceMfa || input.risk.level === "high" || input.risk.level === "critical") return null
  const token = input.request.cookies.get(TRUSTED_DEVICE_COOKIE)?.value
  if (!token) return null

  const trustedTokenHash = hashMfaValue("trusted", token)
  const trusted = await (prisma as any).userTrustedDevice.findFirst({
    where: {
      userType: "admin",
      userId: input.subject.userId,
      trustedTokenHash,
      deviceFingerprint: input.fingerprint,
      revokedAt: null,
      trustedUntil: { gt: new Date() },
    },
  }).catch(() => null)
  if (!trusted) return null

  const metadata = metadataRecord(trusted.metadata)
  if (metadata.emergencyConsumedAt) return null
  if (!sameNullableRegion(trusted.country, input.device.country)) return null
  if (!sameNullableRegion(trusted.region, input.device.region)) return null

  const recentSince = new Date(Date.now() - Math.max(1, EMERGENCY_RECENT_MFA_DAYS) * 24 * 60 * 60_000)
  const recentMfaSession = await (prisma as any).session.findFirst({
    where: {
      userId: input.subject.userId,
      role: { not: "client" },
      assuranceLevel: "FULLY_AUTHENTICATED",
      deviceFingerprint: input.fingerprint,
      mfaVerifiedAt: { gte: recentSince },
    },
    orderBy: { mfaVerifiedAt: "desc" },
  }).catch(() => null)
  if (!recentMfaSession) return null

  return {
    trusted,
    recentMfaAt: recentMfaSession.mfaVerifiedAt,
    tokenHash: trustedTokenHash,
  }
}

export async function markEmergencyTrustedDeviceConsumed(input: {
  trustedDeviceId: string
  challengeId: string
  reason?: string | null
}) {
  const current = await (prisma as any).userTrustedDevice.findUnique({ where: { id: input.trustedDeviceId } }).catch(() => null)
  if (!current) return false
  const metadata = metadataRecord(current.metadata)
  if (metadata.emergencyConsumedAt) return false
  await (prisma as any).userTrustedDevice.update({
    where: { id: input.trustedDeviceId },
    data: {
      lastUsedAt: new Date(),
      metadata: {
        ...metadata,
        emergencyConsumedAt: new Date().toISOString(),
        emergencyChallengeId: input.challengeId,
        emergencyReason: input.reason || null,
      } as any,
    },
  })
  return true
}

export async function clearEmergencyTrustedDeviceConsumption(input: {
  subject: MfaSubject
  fingerprint?: string | null
}) {
  const rows = await (prisma as any).userTrustedDevice.findMany({
    where: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      ...(input.fingerprint ? { deviceFingerprint: input.fingerprint } : {}),
      revokedAt: null,
    },
  }).catch(() => [])
  await Promise.all(rows.map((row: any) => {
    const metadata = metadataRecord(row.metadata)
    if (!metadata.emergencyConsumedAt) return null
    const { emergencyConsumedAt, emergencyChallengeId, emergencyReason, ...rest } = metadata
    return (prisma as any).userTrustedDevice.update({ where: { id: row.id }, data: { metadata: rest as any } }).catch(() => null)
  }))
}

export async function trustDevice(input: {
  response: NextResponse
  subject: MfaSubject
  fingerprint: string
  device: DeviceContext
  risk: RiskAssessment
  days: number
}) {
  const token = randomToken()
  const maxAge = Math.max(1, input.days) * 24 * 60 * 60
  const trustedUntil = new Date(Date.now() + maxAge * 1000)
  const row = await (prisma as any).userTrustedDevice.create({
    data: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      deviceFingerprint: input.fingerprint,
      trustedTokenHash: hashMfaValue("trusted", token),
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
      metadata: {
        proxy: input.device.proxy,
        vpn: input.device.vpn || false,
        tor: input.device.tor || false,
        relay: input.device.relay || false,
        riskScore: input.risk.score,
        riskReasons: input.risk.reasons,
      },
      trustedUntil,
    },
  })
  input.response.cookies.set(TRUSTED_DEVICE_COOKIE, token, trustedCookieOptions(maxAge))
  return row
}

export function clearTrustedDeviceCookie(response: NextResponse) {
  response.cookies.set(TRUSTED_DEVICE_COOKIE, "", { ...trustedCookieOptions(0), expires: new Date(0) })
}
