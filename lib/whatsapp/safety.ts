import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/diagnostics"

export type WhatsAppPacingPolicy = {
  minDelayMs: number
  maxDelayMs: number
  dailyFrequencyCap: number
  qualityScore: number
  riskScore: number
  action: "send" | "slow_down" | "suppress"
  reason: string
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function resolveWhatsAppPacingPolicy(input: {
  campaign?: { pacingPolicy?: unknown; qualityScore?: number | null; riskScore?: number | null } | null
  recipientRiskScore?: number | null
} = {}): WhatsAppPacingPolicy {
  const policy = record(input.campaign?.pacingPolicy)
  const qualityScore = number(input.campaign?.qualityScore, 100)
  const riskScore = Math.max(number(input.campaign?.riskScore, 0), number(input.recipientRiskScore, 0))
  let minDelayMs = number(policy.minDelayMs, Number(process.env.WHATSAPP_CAMPAIGN_MIN_DELAY_MS || 8_000))
  let maxDelayMs = number(policy.maxDelayMs, Number(process.env.WHATSAPP_CAMPAIGN_MAX_DELAY_MS || 25_000))
  let action: WhatsAppPacingPolicy["action"] = "send"
  let reason = "normal"

  if (qualityScore < 50 || riskScore >= 80) {
    action = "suppress"
    reason = qualityScore < 50 ? "quality_score_low" : "risk_score_high"
  } else if (qualityScore < 75 || riskScore >= 50) {
    action = "slow_down"
    reason = qualityScore < 75 ? "quality_score_medium" : "risk_score_medium"
    minDelayMs *= 3
    maxDelayMs *= 4
  }

  return {
    minDelayMs,
    maxDelayMs: Math.max(minDelayMs, maxDelayMs),
    dailyFrequencyCap: number(policy.dailyFrequencyCap, 2),
    qualityScore,
    riskScore,
    action,
    reason,
  }
}

export function randomPacedDelayMs(policy: WhatsAppPacingPolicy) {
  return Math.floor(policy.minDelayMs + Math.random() * Math.max(0, policy.maxDelayMs - policy.minDelayMs))
}

export async function checkWhatsAppSuppression(input: {
  customerId?: string | null
  phone?: string | null
  phoneHash?: string | null
  scope?: string
}) {
  const normalized = input.phone ? normalizeWhatsAppNumber(input.phone) : null
  const phoneHash = input.phoneHash || normalized?.phoneHash || null
  const clauses = []
  if (input.customerId) clauses.push({ customerId: input.customerId })
  if (phoneHash) clauses.push({ phoneHash })
  if (!clauses.length) return { suppressed: false as const, reason: null, phoneHash }

  const suppression = await (prisma as any).whatsAppSuppression.findFirst({
    where: {
      active: true,
      scope: { in: [input.scope || "marketing", "all"] },
      OR: clauses,
      AND: [
        {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)

  return { suppressed: Boolean(suppression), reason: suppression?.reason || null, phoneHash }
}

export async function countRecentWhatsAppMarketingTouches(input: { customerId?: string | null; phoneHash?: string | null; sinceMs?: number }) {
  const since = new Date(Date.now() - (input.sinceMs || 24 * 60 * 60_000))
  const where: any = { category: "marketing", createdAt: { gte: since } }
  if (input.customerId) where.customerId = input.customerId
  else if (input.phoneHash) where.phoneHash = input.phoneHash
  else return 0
  return (prisma as any).whatsAppMessageLog.count({ where }).catch(() => 0)
}

export async function recordWhatsAppSuppression(input: {
  customerId?: string | null
  phoneHash?: string | null
  reason: string
  source?: string | null
  scope?: string | null
  metadata?: Record<string, unknown>
}) {
  return (prisma as any).whatsAppSuppression.create({
    data: {
      id: `wa_sup_${crypto.randomUUID()}`,
      customerId: input.customerId || null,
      phoneHash: input.phoneHash || null,
      reason: input.reason,
      source: input.source || null,
      scope: input.scope || "marketing",
      metadata: input.metadata || {},
    },
  })
}
