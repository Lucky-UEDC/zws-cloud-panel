import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requirePricingAdminMutation } from "@/lib/pricing-admin-security"
import { assertRoundingRule } from "@/lib/pricing-catalog"
import { invalidateRegionalPricingCache } from "@/lib/regional-pricing"
import { writeAuditLog } from "@/lib/audit-log"

const updateSchema = z.object({
  markupValue: z.coerce.number().min(0).max(1000).optional(),
  exchangeOverride: z.coerce.number().positive().max(1000).optional().nullable(),
  roundingRule: z.string().optional(),
  enabled: z.boolean().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePricingAdminMutation(request)
  if ("response" in guard) return guard.response
  const { id } = await params
  const parsed = updateSchema.parse(await request.json().catch(() => ({})))
  const previous = await (prisma as any).countryPricing.findUnique({ where: { id } }).catch(() => null)
  const data = {
    ...(parsed.markupValue !== undefined ? { markupValue: parsed.markupValue, markupType: "percent" } : {}),
    ...(parsed.roundingRule !== undefined ? { roundingRule: assertRoundingRule(parsed.roundingRule) } : {}),
    ...(parsed.enabled !== undefined ? { enabled: parsed.enabled } : {}),
    ...(parsed.exchangeOverride !== undefined ? { exchangeOverride: parsed.exchangeOverride } : {}),
  }
  const row = await (prisma as any).countryPricing.update({ where: { id }, data })
  await invalidateRegionalPricingCache(row.countryCode)
  await writeAuditLog({
    action: "PRICING_COUNTRY_UPDATE",
    adminId: guard.admin.sub || null,
    actorEmail: guard.admin.email || null,
    targetType: "country_pricing",
    targetId: id,
    oldValue: previous,
    newValue: row,
    ipAddress: guard.ipAddress,
    userAgent: guard.userAgent,
  })
  return NextResponse.json({ success: true, country: row })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePricingAdminMutation(request)
  if ("response" in guard) return guard.response
  const { id } = await params
  const previous = await (prisma as any).countryPricing.findUnique({ where: { id } }).catch(() => null)
  await (prisma as any).countryPricing.delete({ where: { id } })
  await invalidateRegionalPricingCache(previous?.countryCode || null)
  await writeAuditLog({
    action: "PRICING_COUNTRY_DELETE",
    adminId: guard.admin.sub || null,
    actorEmail: guard.admin.email || null,
    targetType: "country_pricing",
    targetId: id,
    oldValue: previous,
    ipAddress: guard.ipAddress,
    userAgent: guard.userAgent,
  })
  return NextResponse.json({ success: true })
}
