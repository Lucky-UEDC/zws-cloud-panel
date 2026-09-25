import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import type { MfaMethod, MfaSubject } from "@/lib/auth/mfa/types"

const MFA_CHALLENGE_TTL_MS = 5 * 60_000

export function hashMfaChallengeToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

export async function createMfaChallenge(input: {
  subject: MfaSubject
  method: MfaMethod
  metadata?: Record<string, unknown>
}) {
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS)
  const row = await (prisma as any).mfaChallenge.create({
    data: {
      userType: input.subject.userType,
      userId: input.subject.userId,
      challengeTokenHash: hashMfaChallengeToken(token),
      method: input.method,
      expiresAt,
      metadata: (input.metadata || {}) as any,
    },
  })
  return {
    id: row.id as string,
    challengeToken: token,
    expiresAt: expiresAt.toISOString(),
    row,
  }
}

export async function getValidMfaChallenge(token: string) {
  const challengeTokenHash = hashMfaChallengeToken(String(token || ""))
  const row = await (prisma as any).mfaChallenge.findUnique({
    where: { challengeTokenHash },
  }).catch(() => null)
  if (!row) return null
  if (row.verified || new Date(row.expiresAt).getTime() < Date.now()) return null
  return row
}

export async function verifyMfaChallenge(id: string) {
  return (prisma as any).mfaChallenge.update({
    where: { id },
    data: { verified: true, verifiedAt: new Date() },
  })
}

export async function pruneExpiredMfaChallenges() {
  await (prisma as any).mfaChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } },
        { verified: true, verifiedAt: { lt: new Date(Date.now() - 60 * 60_000) } },
      ],
    },
  }).catch(() => null)
}
