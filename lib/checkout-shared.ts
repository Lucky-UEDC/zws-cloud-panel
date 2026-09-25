import { calculateCanonicalCheckoutPricing } from "@/lib/checkout-pricing"
import { getRegionalPrice } from "@/lib/regional-pricing"
import { assertProductVisibleInCountry } from "@/lib/product-geo"
import { prisma } from "@/lib/db"
import { resolveCheckoutCountry } from "@/lib/payment-country"

export type CheckoutApiSuccess<T> = {
  ok: true
  data: T
}

export type CheckoutApiError = {
  ok: false
  error: string
  code?: string
}

export type CheckoutQuote = {
  monthly: {
    cpu: number
    ram: number
    storage: number
    bandwidth: number
    os: number
    region: number
    premiumIps?: number
    base: number
    total: number
  }
  term: {
    months: number
    subtotal: number
    discountPercent: number
    discountAmount: number
    premiumIpAmount?: number
  }
  coupon: {
    code: string | null
    discountAmount: number
    discountPercent: number
  }
  tax: {
    percent: number
    amount: number
    label?: string
  }
  taxableAmount: number
  payableToday: number
  effectiveMonthly: number
  currency: string
  renewalDate?: string
  premiumIps?: { quantity: number; mode: "standard" | "bulk"; pricePerIp: number; monthlyTotal: number } | null
  regional?: {
    displayAmount: number
    displayCurrency: string
    baseAmountInr: number
    approxInrLabel: string | null
    countryCode: string
    formatted: string
    fallback: boolean
    exchangeRate?: number
    markupPercent?: number
    roundingRule?: string
    rateSource?: string | null
    rateFetchedAt?: string | null
    stale?: boolean
    token?: string
  }
  localized?: {
    countryCode: string
    locale: string
    currency: string
    exchangeRate: number
    markupPercent: number
    roundingRule: string
    stale: boolean
    rateSource?: string | null
    monthly: CheckoutQuote["monthly"]
    term: CheckoutQuote["term"]
    coupon: CheckoutQuote["coupon"]
    tax: CheckoutQuote["tax"]
    taxableAmount: number
    payableToday: number
    effectiveMonthly: number
    renewalAmount: number
    premiumIps?: CheckoutQuote["premiumIps"]
  }
}

export type CheckoutQuoteResult = {
  quote: CheckoutQuote
  billingDiscounts: Record<number, number>
}

export type CheckoutQuoteInput = {
  request?: Request | null
  countryCode?: string | null
  productId?: string | null
  productSlug?: string | null
  customerId?: string | null
  term?: unknown
  region?: string | null
  osTemplateId?: string | null
  customCpu?: unknown
  customRamGb?: unknown
  customStorageGb?: unknown
  customBandwidthTb?: unknown
  diskTier?: string | null
  storagePoolId?: string | null
  premiumIps?: { enabled?: unknown; quantity?: unknown; bulk?: unknown; mode?: unknown } | null
  cpuTier?: string | null
  nodeId?: string | null
  couponCode?: string | null
  couponDiscount?: unknown
}

export async function calculateCheckoutQuote(input: CheckoutQuoteInput): Promise<CheckoutQuoteResult> {
  const customer = input.customerId
    ? await prisma.customer.findUnique({
      where: { id: String(input.customerId) },
      select: { country: true, address: true },
    }).catch(() => null)
    : null
  const countryCode = await resolveCheckoutCountry({ request: input.request || null, customer })
  const result = await calculateCanonicalCheckoutPricing({ ...input, countryCode } as any)
  assertProductVisibleInCountry(result.product, countryCode)
  const requestLocale = input.request?.headers?.get("x-zws-locale") || input.request?.headers?.get("cookie")?.match(/(?:^|;\s*)locale=([^;]+)/)?.[1] || null
  const regional = await getRegionalPrice({
    amountInr: result.quote.payableToday,
    countryCode,
    term: result.term,
    product: input.productId || input.productSlug || null,
    customerId: input.customerId || null,
    context: {
      productId: input.productId || input.productSlug || null,
      source: "checkout_quote",
    },
  })
  const ratio = result.quote.payableToday > 0 ? Number(regional.displayAmount || 0) / Number(result.quote.payableToday || 1) : Number(regional.exchangeRate || 1)
  const convert = (value: unknown) => Number((Number(value || 0) * ratio).toFixed(2))
  const localized = {
    countryCode,
    locale: requestLocale ? decodeURIComponent(String(requestLocale)) : "en-IN",
    currency: regional.displayCurrency,
    exchangeRate: Number(regional.exchangeRate || 1),
    markupPercent: Number(regional.markupPercent || 0),
    roundingRule: String(regional.roundingRule || "custom_decimal"),
    stale: Boolean(regional.stale),
    rateSource: regional.rateSource || null,
    monthly: Object.fromEntries(Object.entries(result.quote.monthly).map(([key, value]) => [key, convert(value)])) as CheckoutQuote["monthly"],
    term: {
      ...result.quote.term,
      subtotal: convert(result.quote.term.subtotal),
      discountAmount: convert(result.quote.term.discountAmount),
      premiumIpAmount: convert(result.quote.term.premiumIpAmount),
    },
    coupon: {
      ...result.quote.coupon,
      discountAmount: convert(result.quote.coupon.discountAmount),
    },
    tax: {
      ...result.quote.tax,
      amount: convert(result.quote.tax.amount),
    },
    taxableAmount: convert(result.quote.taxableAmount),
    payableToday: Number(regional.displayAmount || convert(result.quote.payableToday)),
    effectiveMonthly: convert(result.quote.effectiveMonthly),
    renewalAmount: convert(result.quote.term.subtotal + result.quote.tax.amount - result.quote.coupon.discountAmount),
    premiumIps: result.quote.premiumIps ? {
      ...result.quote.premiumIps,
      pricePerIp: convert(result.quote.premiumIps.pricePerIp),
      monthlyTotal: convert(result.quote.premiumIps.monthlyTotal),
    } : null,
  }
  return { quote: { ...result.quote, currency: regional.displayCurrency, regional, localized }, billingDiscounts: result.billingDiscounts }
}
