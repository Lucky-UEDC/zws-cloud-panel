import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requirePricingAdminMutation, requirePricingAdminRead } from "@/lib/pricing-admin-security"
import { assertCountryCode, getCountryCurrency, assertRoundingRule, PRICING_COUNTRIES } from "@/lib/pricing-catalog"
import { getGlobalPricingSettings, getRegionalPrice, invalidateRegionalPricingCache } from "@/lib/regional-pricing"
import { writeAuditLog } from "@/lib/audit-log"

const countryPricingSchema = z.object({
  countryCode: z.string().trim().refine((value) => value === value.toUpperCase(), "Country must be uppercase."),
  markupValue: z.coerce.number().min(0).max(1000).default(0),
  exchangeOverride: z.coerce.number().positive().max(1000).optional().nullable(),
  roundingRule: z.string().default("nearest_0_99"),
  enabled: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const guard = await requirePricingAdminRead(request)
  if ("response" in guard) return guard.response
  const countries = await (prisma as any).countryPricing.findMany({
    orderBy: [{ countryCode: "asc" }],
  }).catch(() => [])
  const configured = new Map(countries.map((row: any) => [row.countryCode, row]))
  const global = await getGlobalPricingSettings()
  return NextResponse.json({
    countries: await Promise.all(PRICING_COUNTRIES.map(async (country) => {
      const row: any = configured.get(country.code)
      const isOrigin = country.code === "IN"
      const baseInr = 1000
      const effectiveMarkup = isOrigin ? 0 : row?.enabled ? Number(row.markupValue || 0) : Number(global.defaultMarkupPercent || 40)
      const preview = await getRegionalPrice({
        amountInr: baseInr,
        countryCode: country.code,
        product: "country-pricing-preview",
        context: { source: "admin_country_pricing_preview" },
      }).catch(() => null)
      const convertedValue = (preview?.exchangeRate ?? (isOrigin ? 1 : null)) ? Number((baseInr * Number(preview?.exchangeRate ?? (isOrigin ? 1 : null))).toFixed(2)) : null
      const markedUpInr = Number((baseInr + baseInr * (effectiveMarkup / 100)).toFixed(2))
      return {
        id: row?.id || country.code,
        countryCode: country.code,
        countryName: country.name,
        flag: country.flag,
        currency: "INR",
        baseInr,
        convertedValue,
        markedUpInr,
        markupValue: row?.markupValue ?? effectiveMarkup,
        effectiveMarkup,
        roundingRule: row?.roundingRule || (isOrigin ? "custom_decimal" : "nearest_0_99"),
        enabled: row?.enabled ?? true,
        exchangeOverride: row?.exchangeOverride == null ? null : Number(row.exchangeOverride),
        currencyEnabled: global.enabledCurrencies.includes("INR"),
        customOverride: Boolean(row),
        overrideActive: Boolean(row?.enabled),
        exchangeRate: preview?.exchangeRate ?? (isOrigin ? 1 : null),
        effectivePricePreview: preview?.formatted || null,
        rateSource: preview?.rateSource || null,
        rateFetchedAt: preview?.rateFetchedAt || null,
        stale: Boolean(preview?.stale),
        updatedAt: row?.updatedAt || null,
      }
    })),
  })
}

export async function POST(request: NextRequest) {
  const guard = await requirePricingAdminMutation(request)
  if ("response" in guard) return guard.response
  const body = await request.json().catch(() => ({}))
  const parsed = countryPricingSchema.parse(body)
  const countryCode = assertCountryCode(parsed.countryCode)
  const roundingRule = assertRoundingRule(parsed.roundingRule)
  const currency = getCountryCurrency(countryCode)
  const row = await (prisma as any).countryPricing.upsert({
    where: { countryCode },
    update: {
      currency,
      markupType: "percent",
      markupValue: parsed.markupValue,
      exchangeOverride: parsed.exchangeOverride ?? null,
      roundingRule,
      enabled: parsed.enabled,
    },
    create: {
      countryCode,
      currency,
      markupType: "percent",
      markupValue: parsed.markupValue,
      exchangeOverride: parsed.exchangeOverride ?? null,
      roundingRule,
      enabled: parsed.enabled,
    },
  })
  await invalidateRegionalPricingCache(countryCode)
  await writeAuditLog({
    action: "PRICING_COUNTRY_UPSERT",
    adminId: guard.admin.sub || null,
    actorEmail: guard.admin.email || null,
    targetType: "country_pricing",
    targetId: row.id,
    newValue: row,
    ipAddress: guard.ipAddress,
    userAgent: guard.userAgent,
  })
  return NextResponse.json({ success: true, country: row })
}
