import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/diagnostics"
import { assertMetaSafeInviteFlow } from "@/lib/whatsapp/provider"

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[\s-]+/g, "_").replace(/^_+|_+$/g, "") || `item_${Date.now()}`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function matchesRule(conditions: unknown, context: Record<string, unknown>) {
  const rule = record(conditions)
  return Object.entries(rule).every(([key, expected]) => {
    if (expected === null || expected === undefined || expected === "") return true
    const actual = context[key]
    if (Array.isArray(expected)) return expected.map(String).map((v) => v.toLowerCase()).includes(String(actual || "").toLowerCase())
    return String(actual || "").toLowerCase() === String(expected).toLowerCase()
  })
}

export async function resolveWhatsAppGroupAssignment(context: Record<string, unknown>) {
  const rules = await (prisma as any).whatsAppGroupRoutingRule.findMany({
    where: { enabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: 100,
  }).catch(() => [])

  const matched = rules.find((rule: any) => matchesRule(rule.conditions, context))
  if (matched?.groupId) {
    const group = await (prisma as any).whatsAppGroup.findUnique({ where: { id: matched.groupId } }).catch(() => null)
    return { rule: matched, group, communityId: matched.communityId || group?.communityId || null }
  }

  const fallback = await (prisma as any).whatsAppGroup.findFirst({
    where: {
      status: "active",
      OR: [
        { country: String(context.country || "") || undefined },
        { language: String(context.language || "") || undefined },
        { service: String(context.service || "") || undefined },
      ].filter((entry) => Object.values(entry)[0] !== undefined),
    },
    orderBy: { createdAt: "asc" },
  }).catch(() => null)

  return { rule: null, group: fallback, communityId: fallback?.communityId || null }
}

export async function createWhatsAppCommunity(input: {
  name: string
  slug?: string | null
  description?: string | null
  category?: string | null
  language?: string | null
  country?: string | null
  region?: string | null
  createdBy?: string | null
}) {
  return (prisma as any).whatsAppCommunity.create({
    data: {
      id: `wa_com_${crypto.randomUUID()}`,
      name: input.name,
      slug: slugify(input.slug || input.name),
      description: input.description || null,
      category: input.category || "customer",
      language: input.language || null,
      country: input.country || null,
      region: input.region || null,
      createdBy: input.createdBy || null,
    },
  })
}

export async function createWhatsAppGroup(input: {
  name: string
  slug?: string | null
  communityId?: string | null
  description?: string | null
  category?: string | null
  language?: string | null
  country?: string | null
  region?: string | null
  service?: string | null
  plan?: string | null
  product?: string | null
  inviteLink?: string | null
  approvalMode?: string | null
  createdBy?: string | null
}) {
  return (prisma as any).whatsAppGroup.create({
    data: {
      id: `wa_grp_${crypto.randomUUID()}`,
      name: input.name,
      slug: slugify(input.slug || input.name),
      communityId: input.communityId || null,
      description: input.description || null,
      category: input.category || "customer",
      language: input.language || null,
      country: input.country || null,
      region: input.region || null,
      service: input.service || null,
      plan: input.plan || null,
      product: input.product || null,
      inviteLink: input.inviteLink || null,
      approvalMode: input.approvalMode || "optional",
      createdBy: input.createdBy || null,
    },
  })
}

export async function createWhatsAppGroupInvite(input: {
  groupId: string
  communityId?: string | null
  campaignId?: string | null
  customerId?: string | null
  inviteLink: string
  approvalMode?: string | null
  usageLimit?: number | null
  expiresAt?: Date | null
  generatedBy?: string | null
  metadata?: Record<string, unknown>
}) {
  assertMetaSafeInviteFlow({ inviteLink: input.inviteLink, forceJoin: false })
  return (prisma as any).whatsAppGroupInvite.create({
    data: {
      id: `wa_inv_${crypto.randomUUID()}`,
      groupId: input.groupId,
      communityId: input.communityId || null,
      campaignId: input.campaignId || null,
      customerId: input.customerId || null,
      inviteLink: input.inviteLink,
      approvalMode: input.approvalMode || "optional",
      usageLimit: input.usageLimit || null,
      expiresAt: input.expiresAt || null,
      generatedBy: input.generatedBy || null,
      metadata: input.metadata || {},
    },
  })
}

export async function markWhatsAppGroupInviteSent(input: {
  groupId: string
  customerId?: string | null
  phone?: string | null
  source?: string | null
  inviteId?: string | null
}) {
  const normalized = input.phone ? normalizeWhatsAppNumber(input.phone) : null
  const existing = input.customerId
    ? await (prisma as any).whatsAppGroupMember.findUnique({
        where: { groupId_customerId: { groupId: input.groupId, customerId: input.customerId } },
      }).catch(() => null)
    : await (prisma as any).whatsAppGroupMember.findFirst({
        where: { groupId: input.groupId, phoneHash: normalized?.phoneHash || null },
      }).catch(() => null)

  if (existing) {
    return (prisma as any).whatsAppGroupMember.update({
      where: { id: existing.id },
      data: {
        status: "invited",
        invitedAt: new Date(),
        metadata: { inviteId: input.inviteId || null },
      },
    }).catch(() => null)
  }

  return (prisma as any).whatsAppGroupMember.create({
    data: {
      id: `wa_mem_${crypto.randomUUID()}`,
      groupId: input.groupId,
      customerId: input.customerId || null,
      phoneHash: normalized?.phoneHash || null,
      toMasked: normalized?.maskedPhone || null,
      status: "invited",
      source: input.source || "onboarding",
      invitedAt: new Date(),
      metadata: { inviteId: input.inviteId || null },
    },
  }).catch(() => null)
}
