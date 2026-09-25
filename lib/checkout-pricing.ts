import { prisma } from "@/lib/db"
import { calculateFixedProductTermQuote, normalizeBillingTerm } from "@/lib/billing-pricing"
import { calculateCustomConfigurationQuote, validateCustomConfigurationInput } from "@/lib/custom-configuration-pricing"
import { computeFixedVpsPricing } from "@/lib/fixed-vps-pricing"
import { getBillingPricingSettings, getCustomConfigurationSettings } from "@/lib/settings"
import { validateCoupon } from "@/lib/coupons"
import { calculatePricing } from "@/lib/payments/calculate-pricing"
import { normalizePremiumIpRequest } from "@/lib/premium-ip-pricing"
import { getPublicProductsWhere } from "@/lib/public-products"
import { VPS_FIXED_SEED } from "@/lib/data/catalog-seed"
import { assertProductVisibleInCountry } from "@/lib/product-geo"
import { getTaxPolicy } from "@/lib/tax-engine"
import type { BillingTerm } from "@/lib/pricing"

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function discountMap(settings: Record<string, any>) {
  return {
    1: Number(settings.monthlyDiscountPercent || 0),
    3: Number(settings.threeMonthDiscountPercent || 0),
    6: Number(settings.sixMonthDiscountPercent || 0),
    12: Number(settings.twelveMonthDiscountPercent || 0),
    24: Number(settings.twentyFourMonthDiscountPercent || 0),
    36: Number(settings.thirtySixMonthDiscountPercent || 0),
  }
}

export type CanonicalCheckoutPricingInput = {
  productId?: string | null
  productSlug?: string | null
  customerId?: string | null
  term?: unknown
  couponCode?: string | null
  customCpu?: unknown
  customRamGb?: unknown
  customStorageGb?: unknown
  customBandwidthTb?: unknown
  diskTier?: string | null
  storagePoolId?: string | null
  premiumIps?: { enabled?: unknown; quantity?: unknown; bulk?: unknown; mode?: unknown } | null
  config?: Record<string, any> | null
  countryCode?: string | null
}

export async function calculateCanonicalCheckoutPricing(input: CanonicalCheckoutPricingInput) {
  const productId = input.productId ? String(input.productId) : ""
  const productSlug = input.productSlug ? String(input.productSlug) : ""
  const term = normalizeBillingTerm(input.term) as BillingTerm
  const couponCode = input.couponCode ? String(input.couponCode).trim().toUpperCase() : null
  const taxPolicy = getTaxPolicy(input.countryCode || "IN")

  if (!productId && !productSlug) {
    throw Object.assign(new Error("Product is required"), { code: "PRODUCT_REQUIRED", status: 400 })
  }

  const product = await prisma.product.findFirst({
    where: {
      ...getPublicProductsWhere(),
      ...(productId ? { id: productId } : { slug: productSlug }),
    },
  }) || fallbackCheckoutProduct(productId || productSlug)
  if (!product) {
    throw Object.assign(new Error("Selected cloud instance is unavailable"), { code: "PRODUCT_UNAVAILABLE", status: 404 })
  }
  if (input.countryCode) assertProductVisibleInCountry(product, input.countryCode)

  const productType = String(product.type || "").toLowerCase()
  let monthly = { cpu: 0, ram: 0, storage: 0, bandwidth: 0, os: 0, region: 0, premiumIps: 0, base: 0, total: 0 }
  let subtotal = 0
  let taxAmount = 0
  let gstRate = taxPolicy.percent
  let gstEnabled: boolean = taxPolicy.enabled
  let termDiscount = 0
  let termDiscountPercent = 0
  let renewalDate = new Date(Date.now() + term * 30 * 24 * 60 * 60 * 1000).toISOString()
  let billingDiscounts: Record<number, number> = {}
  let debugBreakdown: Record<string, unknown> = {}
  let fixedPricingMeta: ReturnType<typeof computeFixedVpsPricing> | null = null
  let customPricingMeta: ReturnType<typeof calculateCustomConfigurationQuote> | null = null
  const premiumIps = normalizePremiumIpRequest(input.premiumIps || (input.config as any)?.premiumIps || {})
  if (premiumIps.enabled) {
    const allowedPremiumPools = await prisma.productIpPool.count({
      where: { productId: product.id, allowPremium: true, pool: { isActive: true, type: "premium" } },
    })
    if (!product.premiumIpEnabled || allowedPremiumPools <= 0) {
      throw Object.assign(new Error("Premium IPs are not enabled for this product"), { code: "PREMIUM_IP_UNAVAILABLE", status: 400 })
    }
  }

  if (productType === "configurable") {
    const settings = await getCustomConfigurationSettings()
    if (!settings.enableCustomConfiguration && product.id !== "custom") {
      throw Object.assign(new Error("Custom configuration is disabled"), { code: "CUSTOM_CONFIG_DISABLED", status: 403 })
    }
    const config = input.config || {}
    const disks = Array.isArray(config.disks) && config.disks.length
      ? config.disks.map((disk: any, index: number) => ({
          type: String(disk?.type || input.diskTier || product.storageType || "nvme").toLowerCase() === "ssd" ? "ssd" : "nvme",
          sizeGb: Number(disk?.sizeGb || disk?.size || 0),
          label: String(disk?.label || `Disk ${index + 1}`),
        }))
      : [{
          type: String(input.diskTier || config.diskTier || product.storageType || "nvme").toLowerCase() === "ssd" ? "ssd" : "nvme",
          sizeGb: money(input.customStorageGb ?? config.storage ?? product.storageGb ?? settings.defaultStorageGb),
          label: "Disk 1",
        }]
    const quoteInput = {
      cpuCores: money(input.customCpu ?? config.cpu ?? product.cpuCores ?? settings.defaultVcpu),
      ramGb: money(input.customRamGb ?? config.ram ?? product.ramGb ?? settings.defaultRamGb),
      disks,
      storageGb: disks.reduce((sum, disk) => sum + Number(disk.sizeGb || 0), 0),
      storageType: disks[0]?.type === "ssd" ? "ssd" as const : "nvme" as const,
      bandwidthTb: money(input.customBandwidthTb ?? config.bandwidth ?? product.bandwidthTb ?? settings.defaultBandwidthTb),
      term,
    }
    const validation = validateCustomConfigurationInput(quoteInput, settings)
    if (!validation.valid) {
      throw Object.assign(new Error(validation.errors.join(" ")), { code: "INVALID_CUSTOM_CONFIGURATION", status: 400 })
    }
    customPricingMeta = calculateCustomConfigurationQuote(quoteInput, settings)
    monthly = {
      cpu: customPricingMeta.breakdown.cpu,
      ram: customPricingMeta.breakdown.ram,
      storage: customPricingMeta.breakdown.storage,
      bandwidth: customPricingMeta.breakdown.bandwidth,
      os: 0,
      region: 0,
      premiumIps: 0,
      base: customPricingMeta.baseMonthly,
      total: customPricingMeta.discountedMonthly,
    }
    subtotal = customPricingMeta.subtotal
    taxAmount = customPricingMeta.taxAmount
    gstRate = taxPolicy.percent
    gstEnabled = taxPolicy.enabled
    termDiscount = money(customPricingMeta.discountAmountMonthly * term)
    termDiscountPercent = customPricingMeta.discountPercent
    billingDiscounts = discountMap(settings)
    debugBreakdown = { customPricingMeta }
  } else {
    const settings = await getBillingPricingSettings()
    const termQuote = calculateFixedProductTermQuote({ product, term, settings })
    fixedPricingMeta = computeFixedVpsPricing({
      cpuCores: Number(product.cpuCores || 0),
      ramGb: Number(product.ramGb || 0),
      storageGb: Number(product.storageGb || 0),
      storageType: product.storageType,
      bandwidthTb: Number(product.bandwidthTb || 0),
      specs: product.specs as Record<string, unknown> | null,
      productMonthlyPrice: Number(product.price1m || 0),
    })
    monthly = {
      cpu: fixedPricingMeta.breakdown.cpuPrice,
      ram: fixedPricingMeta.breakdown.ramPrice,
      storage: fixedPricingMeta.breakdown.storagePrice,
      bandwidth: fixedPricingMeta.breakdown.bandwidthPrice,
      os: fixedPricingMeta.breakdown.osPrice,
      region: fixedPricingMeta.breakdown.regionPrice,
      premiumIps: 0,
      base: termQuote.baseMonthlyPrice,
      total: termQuote.selectedMonthlyPrice,
    }
    subtotal = termQuote.termSubtotal
    taxAmount = termQuote.taxAmount
    gstRate = taxPolicy.percent
    gstEnabled = taxPolicy.enabled
    termDiscount = termQuote.termDiscount
    termDiscountPercent = termQuote.discountPercent
    renewalDate = termQuote.renewalDate
    billingDiscounts = discountMap(settings)
    debugBreakdown = { fixedPricingMeta, termQuote }
  }

  let couponDiscount = 0
  let couponId: string | null = null
  let normalizedCouponCode: string | null = null
  const premiumIpMonthlyTotal = premiumIps.enabled ? premiumIps.pricing.monthlyTotal : 0
  const premiumIpTermTotal = money(premiumIpMonthlyTotal * term)
  if (premiumIpMonthlyTotal > 0) {
    monthly = {
      ...monthly,
      premiumIps: premiumIpMonthlyTotal,
      total: money(monthly.total + premiumIpMonthlyTotal),
    }
  }
  const pricedSubtotal = money(subtotal + premiumIpTermTotal)
  const preDiscountGst = calculatePricing({ subtotal: pricedSubtotal, discount: 0, gstRate, gstEnabled }).gst
  if (couponCode) {
    const coupon = await validateCoupon({
      code: couponCode,
      customerId: input.customerId || null,
      productId: product.id,
      termMonths: term,
      subtotal: pricedSubtotal,
      taxAmount: preDiscountGst,
    })
    if (!coupon.valid) {
      throw Object.assign(new Error(coupon.reason || "Invalid coupon"), { code: "INVALID_COUPON", status: 400 })
    }
    couponDiscount = money(coupon.discountAmount)
    couponId = coupon.couponId || null
    normalizedCouponCode = coupon.code || couponCode
  }
  const pricing = calculatePricing({ subtotal: pricedSubtotal, discount: couponDiscount, gstRate, gstEnabled })
  taxAmount = pricing.gst

  const quote = {
    monthly,
    term: {
      months: term,
      subtotal: pricedSubtotal,
      discountPercent: termDiscountPercent,
      discountAmount: termDiscount,
      premiumIpAmount: premiumIpTermTotal,
    },
    coupon: {
      code: normalizedCouponCode,
      discountAmount: pricing.discount,
      discountPercent: pricing.discountPercent,
    },
    tax: {
      percent: gstRate,
      amount: pricing.gst,
      label: taxPolicy.label,
    },
    taxableAmount: pricing.taxableAmount,
    payableToday: pricing.total,
    effectiveMonthly: money(pricing.total / term),
    currency: "INR" as const,
    renewalDate,
    premiumIps: premiumIps.enabled ? premiumIps.pricing : null,
  }

  return {
    product,
    productType,
    term,
    subtotal: pricing.subtotal,
    taxableAmount: pricing.taxableAmount,
    taxAmount: pricing.gst,
    originalAmount: money(pricedSubtotal + calculatePricing({ subtotal: pricedSubtotal, discount: 0, gstRate, gstEnabled }).gst),
    discountAmount: pricing.discount,
    discountPercent: pricing.discountPercent,
    payableToday: pricing.total,
    couponCode: normalizedCouponCode,
    couponId,
    pricing,
    quote,
    billingDiscounts,
    fixedPricingMeta,
    customPricingMeta,
    premiumIps: premiumIps.enabled ? premiumIps.pricing : null,
    debugBreakdown: { ...debugBreakdown, premiumIps: premiumIps.enabled ? premiumIps.pricing : null },
    taxPolicy,
  }
}

function fallbackCheckoutProduct(identifier: string) {
  const key = String(identifier || "").trim()
  if (!key) return null
  if (key === "custom") {
    return {
      id: "custom",
      slug: "custom",
      name: "Custom Cloud Instance",
      type: "configurable",
      storageType: "nvme",
      cpuCores: 2,
      ramGb: 4,
      storageGb: 80,
      bandwidthTb: 2,
      price1m: 499,
      price3m: null,
      price6m: null,
      price12m: null,
      price24m: null,
      price36m: null,
      premiumIpEnabled: false,
      specs: {},
    } as any
  }
  const seed = VPS_FIXED_SEED.find((entry) => entry.slug === key)
  if (!seed) return null
  return {
    id: seed.slug,
    slug: seed.slug,
    name: seed.name,
    type: seed.family,
    storageType: seed.storageType === "ssd" ? "ssd" : "nvme",
    cpuCores: seed.cpuCores,
    ramGb: seed.ramGb,
    storageGb: seed.storageGb,
    bandwidthTb: seed.bandwidthTb,
    price1m: seed.price1m,
    price3m: null,
    price6m: null,
    price12m: null,
    price24m: null,
    price36m: null,
    premiumIpEnabled: false,
    specs: {},
  } as any
}
