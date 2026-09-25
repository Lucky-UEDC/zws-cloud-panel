import { prisma } from "@/lib/db"
import { generateOtp, hashMfaValue } from "@/lib/auth/mfa/crypto"
import type { MfaMethod, MfaSubject } from "@/lib/auth/mfa/types"

const OTP_TTL_MS = 5 * 60_000
const MAX_ATTEMPTS = 5
const MAX_USER_CHANNEL_SENDS_PER_HOUR = 12
const MAX_IP_SENDS_PER_HOUR = 40

export type OtpIssueResult = {
  otp: string
  otpCodeId: string
  expiresAt: string
}

export function otpHash(subject: MfaSubject, otp: string) {
  return hashMfaValue("otp_code", subject.userType, subject.userId, String(otp || "").replace(/\D/g, ""))
}

export async function assertOtpSendLimit(subject: MfaSubject, channel: MfaMethod, context?: { ip?: string | null; fingerprint?: string | null; failover?: boolean }) {
  if (channel !== "whatsapp" && channel !== "email") return
  if (context?.failover) return
  const since = new Date(Date.now() - 60 * 60_000)
  const [userChannelCount, ipCount] = await Promise.all([
    (prisma as any).otpCode.count({
      where: {
        userType: subject.userType,
        userId: subject.userId,
        channel,
        createdAt: { gte: since },
      },
    }).catch(() => 0),
    context?.ip ? (prisma as any).otpCode.count({
      where: {
        createdAt: { gte: since },
        metadata: { path: ["ip"], equals: context.ip },
      },
    }).catch(() => 0) : Promise.resolve(0),
  ])
  const blockedByUser = userChannelCount >= MAX_USER_CHANNEL_SENDS_PER_HOUR
  const blockedByIp = ipCount >= MAX_IP_SENDS_PER_HOUR
  if (blockedByUser || blockedByIp) {
    const retryAfterSeconds = blockedByIp ? 300 : 120
    const error = new Error(`Too many OTP requests. Please try again in ${retryAfterSeconds} seconds.`)
    ;(error as any).status = 429
    ;(error as any).code = "mfa_otp_rate_limited"
    ;(error as any).retryAfterSeconds = retryAfterSeconds
    ;(error as any).cooldownUntil = new Date(Date.now() + retryAfterSeconds * 1000).toISOString()
    throw error
  }
}

export async function issueOtpCode(input: {
  subject: MfaSubject
  channel: Extract<MfaMethod, "whatsapp" | "email">
  challengeId: string
  provider?: string | null
  metadata?: Record<string, unknown>
  context?: { ip?: string | null; fingerprint?: string | null; failover?: boolean }
}): Promise<OtpIssueResult> {
  await assertOtpSendLimit(input.subject, input.channel, input.context)
  const otp = generateOtp()
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)
  const row = await (prisma as any).otpCode.create({
    data: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      otpHash: otpHash(input.subject, otp),
      channel: input.channel,
      provider: input.provider || null,
      expiresAt,
      metadata: {
        ...(input.metadata || {}),
        ip: input.context?.ip || null,
        fingerprint: input.context?.fingerprint || null,
        challengeId: input.challengeId,
      } as any,
    },
  })
  return { otp, otpCodeId: row.id, expiresAt: expiresAt.toISOString() }
}

export async function updateOtpProviderResult(id: string, provider: string | null, metadata: Record<string, unknown>) {
  await (prisma as any).otpCode.update({
    where: { id },
    data: {
      provider,
      metadata: metadata as any,
    },
  }).catch(() => null)
}

export async function verifyOtpCode(input: {
  subject: MfaSubject
  challengeId: string
  channel: Extract<MfaMethod, "whatsapp" | "email">
  otp: string
}) {
  const rows = await (prisma as any).otpCode.findMany({
    where: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      channel: input.channel,
      verified: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  }).catch(() => [])
  const row = rows.find((candidate: any) => {
    const metadata = candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {}
    return metadata.challengeId === input.challengeId
  })
  if (!row) return { ok: false as const, code: "mfa_code_expired", message: "Code expired. Try next code.", status: 401 }
  if (Number(row.attempts || 0) >= MAX_ATTEMPTS) return { ok: false as const, code: "mfa_locked", message: "Too many attempts", status: 429 }
  const expected = otpHash(input.subject, input.otp)
  if (row.otpHash !== expected) {
    await (prisma as any).otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } }).catch(() => null)
    return { ok: false as const, code: "invalid_mfa_code", message: "Enter the 6-digit verification code.", status: 401 }
  }
  await (prisma as any).otpCode.update({
    where: { id: row.id },
    data: { verified: true, verifiedAt: new Date() },
  })
  return { ok: true as const }
}
