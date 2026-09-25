import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getPricingAdminMfaState, requirePricingAdminMutation } from "@/lib/pricing-admin-security"
import { getGlobalPricingSettings, invalidateRegionalPricingCache, updateGlobalPricingSettings } from "@/lib/regional-pricing"
import { writeAuditLog } from "@/lib/audit-log"

const schema = z.object({
  enabled: z.boolean(),
  defaultMarkupPercent: z.coerce.number().min(0).max(1000),
  baseCurrency: z.literal("INR").optional().default("INR"),
  enabledCurrencies: z.array(z.literal("INR")).optional().default(["INR"]),
  defaultRoundingRule: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const guard: any = await getPricingAdminMfaState(request)
  if ("response" in guard) return guard.response
  return NextResponse.json({ settings: await getGlobalPricingSettings(), security: { mfaConfigured: guard.mfaConfigured, mfa: guard.mfa } })
}

export async function PATCH(request: NextRequest) {
  const guard = await requirePricingAdminMutation(request)
  if ("response" in guard) return guard.response
  const previous = await getGlobalPricingSettings()
  const parsed = schema.parse(await request.json().catch(() => ({})))
  const settings = await updateGlobalPricingSettings(parsed, guard.admin.email || null)
  await invalidateRegionalPricingCache()
  await writeAuditLog({
    action: "PRICING_GLOBAL_UPDATE",
    adminId: guard.admin.sub || null,
    actorEmail: guard.admin.email || null,
    targetType: "global_pricing",
    targetId: "global",
    oldValue: previous,
    newValue: settings,
    ipAddress: guard.ipAddress,
    userAgent: guard.userAgent,
  })
  return NextResponse.json({ success: true, settings })
}
