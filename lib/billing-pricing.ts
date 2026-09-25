import { z } from "zod"
import { BILLING_TERMS, calculateTax, type BillingTerm } from "@/lib/pricing"
import { DELETABLE_INVOICE_STATUSES } from "@/lib/invoice-deletion"

export const INVOICE_CLEANUP_DAY_OPTIONS = [3, 7, 15, 30] as const

const invoiceCleanupSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  deleteAfterDays: z.coerce.number().pipe(z.union([
    z.literal(3),
    z.literal(7),
    z.literal(15),
    z.literal(30),
  ])).default(7),
  statuses: z.array(z.enum(DELETABLE_INVOICE_STATUSES)).default(["pending", "failed", "cancelled", "expired", "unpaid"]),
})

export const billingPricingSettingsSchema = z.object({
  version: z.number().default(1),
  monthlyDiscountPercent: z.coerce.number().min(0).max(100).default(0),
  threeMonthDiscountPercent: z.coerce.number().min(0).max(100).default(5),
  sixMonthDiscountPercent: z.coerce.number().min(0).max(100).default(10),
  twelveMonthDiscountPercent: z.coerce.number().min(0).max(100).default(15),
  twentyFourMonthDiscountPercent: z.coerce.number().min(0).max(100).default(20),
  thirtySixMonthDiscountPercent: z.coerce.number().min(0).max(100).default(25),
  minimumWalletTopupAmount: z.coerce.number().min(1).default(100),
  bandwidthPricePer10GbInr: z.coerce.number().min(0).default(1),
  bandwidthHighUsageThresholdGb: z.coerce.number().min(1).default(2048),
  bandwidthHighUsageDiscountPercent: z.coerce.number().min(0).max(100).default(20),
  bandwidthSoftLimitPercent: z.coerce.number().min(1).max(1000).default(80),
  bandwidthPolicy: z.enum(["alert_then_overage", "track_only", "suspend_at_hard_limit"]).default("alert_then_overage"),
  invoiceCleanup: invoiceCleanupSettingsSchema.default({}),
  invoiceDueDays: z.coerce.number().min(0).max(90).default(7),
  defaultTaxPercent: z.coerce.number().min(0).max(100).default(18),
  defaultTaxLabel: z.string().default("GST"),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
})

export type BillingPricingSettings = z.infer<typeof billingPricingSettingsSchema>

export const DEFAULT_BILLING_PRICING_SETTINGS = billingPricingSettingsSchema.parse({})

export function normalizeBillingTerm(value: unknown): BillingTerm {
  const parsed = Number(value)
  return BILLING_TERMS.includes(parsed as BillingTerm) ? parsed as BillingTerm : 1
}

export function billingDiscountForTerm(settings: BillingPricingSettings, term: BillingTerm) {
  switch (term) {
    case 3:
      return Number(settings.threeMonthDiscountPercent || 0)
    case 6:
      return Number(settings.sixMonthDiscountPercent || 0)
    case 12:
      return Number(settings.twelveMonthDiscountPercent || 0)
    case 24:
      return Number(settings.twentyFourMonthDiscountPercent || 0)
    case 36:
      return Number(settings.thirtySixMonthDiscountPercent || 0)
    default:
      return Number(settings.monthlyDiscountPercent || 0)
  }
}

export function explicitProductTermPrice(product: any, term: BillingTerm): number | null {
  const value = product?.[`price${term}m`]
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function calculateFixedProductTermQuote(input: {
  product: any
  term: BillingTerm
  settings?: BillingPricingSettings
  couponDiscount?: number
  taxPercent?: number
}) {
  const baseMonthlyPrice = Number(input.product?.price1m || 0)
  const discountPercent = billingDiscountForTerm(input.settings || DEFAULT_BILLING_PRICING_SETTINGS, input.term)
  const explicitPrice = explicitProductTermPrice(input.product, input.term)
  const selectedMonthlyPrice = explicitPrice ?? Number((baseMonthlyPrice * (1 - discountPercent / 100)).toFixed(2))
  const baseSubtotal = Number((baseMonthlyPrice * input.term).toFixed(2))
  const termSubtotal = Number((selectedMonthlyPrice * input.term).toFixed(2))
  const termDiscount = Number(Math.max(0, baseSubtotal - termSubtotal).toFixed(2))
  const couponDiscount = Number(Math.max(0, input.couponDiscount || 0).toFixed(2))
  const taxable = Number(Math.max(0, termSubtotal - couponDiscount).toFixed(2))
  const taxAmount = calculateTax(taxable, input.taxPercent ?? 18)
  const payableToday = Number(Math.max(1, taxable + taxAmount).toFixed(2))

  return {
    term: input.term,
    months: input.term,
    discountPercent: explicitPrice ? Math.round((termDiscount / Math.max(1, baseSubtotal)) * 100) : discountPercent,
    explicitTermPrice: explicitPrice !== null,
    baseMonthlyPrice,
    selectedMonthlyPrice,
    effectiveMonthlyPrice: Number((termSubtotal / input.term).toFixed(2)),
    baseSubtotal,
    termSubtotal,
    termDiscount,
    couponDiscount,
    taxable,
    taxAmount,
    payableToday,
    renewalDate: addMonths(new Date(), input.term).toISOString(),
  }
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  next.setMonth(next.getMonth() + months)
  return next
}
