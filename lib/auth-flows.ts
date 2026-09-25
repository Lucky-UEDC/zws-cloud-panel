import crypto from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import type { NextRequest } from 'next/server'
import { getDashboardHref, normalizeStaffRole } from '@/lib/roles'
import type { AdminProfile, Customer } from '@prisma/client'
import { issueSession, type SessionAssuranceLevel } from '@/lib/auth/session-store'
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES, SESSION_COOKIE_OPTIONS } from '@/lib/auth/session-cookies'
import { recordLoginSession } from '@/lib/auth/mfa/session-tracking'
import type { DeviceContext, RiskAssessment } from '@/lib/auth/mfa/types'

const AUTH_CHALLENGE_TTL_MINUTES = 10

type StaffUser = Pick<AdminProfile, 'id' | 'email' | 'displayName' | 'role'>
type ClientUser = Pick<Customer, 'id' | 'email' | 'name' | 'status'>
type SessionTrackingInput = {
  device?: DeviceContext
  fingerprint?: string
  risk?: RiskAssessment
  trustedDeviceId?: string | null
  assuranceLevel?: SessionAssuranceLevel
  mfaVerifiedAt?: Date | string | null
}

export async function issueStaffSession(user: StaffUser, sessionMinutes: number, request?: NextRequest | Request | null, tracking?: SessionTrackingInput) {
  const role = normalizeStaffRole(user.role) || 'admin'
  const issued = await issueSession({
    userId: user.id,
    role,
    email: user.email,
    sessionMinutes,
    request,
    assuranceLevel: tracking?.assuranceLevel || "FULLY_AUTHENTICATED",
    mfaVerifiedAt: tracking && "mfaVerifiedAt" in tracking ? tracking.mfaVerifiedAt : new Date(),
    deviceFingerprint: tracking?.fingerprint || null,
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAMES.admin, issued.sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: issued.ttlSeconds,
  })
  cookieStore.delete(SESSION_COOKIE_NAMES.client)
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAMES.admin)
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAMES.client)

  if (tracking?.device && tracking.fingerprint && tracking.risk) {
    await recordLoginSession({
      sessionId: issued.sessionId,
      subject: {
        userType: 'admin',
        userId: user.id,
        role,
        email: user.email,
        name: user.displayName,
      },
      device: tracking.device,
      fingerprint: tracking.fingerprint,
      risk: tracking.risk,
      trustedDeviceId: tracking.trustedDeviceId || null,
      expiresAt: issued.expiresAt,
    })
  }

  return { authenticated: true as const, redirectTo: getDashboardHref(role), role }
}

export async function issueClientSession(user: ClientUser, sessionMinutes: number, request?: NextRequest | Request | null, tracking?: SessionTrackingInput) {
  const issued = await issueSession({
    userId: user.id,
    role: 'client',
    email: user.email,
    sessionMinutes,
    request,
    assuranceLevel: tracking?.assuranceLevel || "FULLY_AUTHENTICATED",
    mfaVerifiedAt: tracking && "mfaVerifiedAt" in tracking ? tracking.mfaVerifiedAt : new Date(),
    deviceFingerprint: tracking?.fingerprint || null,
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAMES.client, issued.sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: issued.ttlSeconds,
  })
  cookieStore.delete(SESSION_COOKIE_NAMES.admin)
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAMES.admin)
  cookieStore.delete(LEGACY_SESSION_COOKIE_NAMES.client)

  if (tracking?.device && tracking.fingerprint && tracking.risk) {
    await recordLoginSession({
      sessionId: issued.sessionId,
      subject: {
        userType: 'customer',
        userId: user.id,
        role: 'client',
        email: user.email,
        name: user.name,
      },
      device: tracking.device,
      fingerprint: tracking.fingerprint,
      risk: tracking.risk,
      trustedDeviceId: tracking.trustedDeviceId || null,
      expiresAt: issued.expiresAt,
    })
  }

  return { authenticated: true as const, redirectTo: user.status === 'SUSPENDED' ? '/suspended' : '/client-area', role: 'client' as const }
}

export async function createAuthChallenge(input: {
  userType: 'admin' | 'customer'
  userId: string
  role: string
  email: string
  method?: string | null
  otpHash?: string | null
  otpExpiresAt?: Date | null
  metadata?: Record<string, unknown>
}) {
  const token = crypto.randomBytes(24).toString('hex')
  const tokenHash = hashChallengeToken(token)
  const expiresAt = new Date(Date.now() + AUTH_CHALLENGE_TTL_MINUTES * 60_000)

  await prisma.authChallenge.create({
    data: {
      tokenHash,
      userType: input.userType,
      userId: input.userId,
      role: input.role,
      email: input.email,
      method: input.method || null,
      otpHash: input.otpHash || null,
      otpExpiresAt: input.otpExpiresAt || null,
      metadata: (input.metadata || {}) as any,
      expiresAt,
    },
  })

  return {
    challengeToken: token,
    expiresAt: expiresAt.toISOString(),
  }
}

export async function consumeAuthChallenge(token: string) {
  const tokenHash = hashChallengeToken(token)
  const record = await prisma.authChallenge.findUnique({ where: { tokenHash } })
  if (!record) return null
  if (record.consumedAt || record.expiresAt.getTime() < Date.now()) return null

  await prisma.authChallenge.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  })

  return record
}

export async function getValidAuthChallenge(token: string) {
  const tokenHash = hashChallengeToken(token)
  const record = await prisma.authChallenge.findUnique({ where: { tokenHash } })
  if (!record) return null
  if (record.consumedAt || record.expiresAt.getTime() < Date.now()) return null
  return record
}

export async function consumeAuthChallengeById(id: string) {
  return prisma.authChallenge.update({
    where: { id },
    data: { consumedAt: new Date() },
  })
}

export async function pruneExpiredChallenges() {
  await prisma.authChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { consumedAt: { not: null } },
      ],
    },
  })
}

export function hashChallengeToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
