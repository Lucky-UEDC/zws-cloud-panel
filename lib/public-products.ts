import { prisma } from "@/lib/db"
import { computeFixedVpsPricing } from "@/lib/fixed-vps-pricing"
import { BillingTerm, StorageType, monthlyToHourly } from "@/lib/pricing"
import { normalizeProductFamily } from "@/lib/catalog-product"
import { getBillingPricingSettings, getCustomConfigurationSettings } from "@/lib/settings"
import { calculateFixedProductTermQuote } from "@/lib/billing-pricing"
import { dedicatedSettingsFromProduct } from "@/lib/dedicated"
import { generateProductFeatures, generateProductSpecs } from "@/lib/product-features"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"
import { VPS_FIXED_SEED } from "@/lib/data/catalog-seed"
import { getRegionalPrice, getUserCountry } from "@/lib/regional-pricing"
import { productVisibleInCountry, normalizeProductGeoVisibility } from "@/lib/product-geo"

export function getPublicProductsWhere() {
  return {
    deletedAt: null,
    isActive: true,
    visibility: "public",
  }
}

export function publicProductWhere(extra: Record<string, unknown> = {}) {
  return {
    ...getPublicProductsWhere(),
    ...extra,
  }
}

export async function getPublicProducts(options: {
  term?: BillingTerm
  category?: string | null
  categorySlug?: string | null
  subcategorySlug?: string | null
  type?: string | null
  slug?: string | null
  take?: number
  orderBy?: any
  request?: Request | null
  countryCode?: string | null
} = {}) {
  const term = options.term || 1
  const userCountry = options.countryCode || await getUserCountry(options.request || null)
  const familyFilter = options.type ? normalizeProductFamily(options.type) : null
  const [customSettings, billingPricingSettings] = await Promise.all([
    getCustomConfigurationSettings(),
    getBillingPricingSettings(),
  ])
  const where = publicProductWhere({
      ...(options.category ? { category: options.category } : {}),
      ...(familyFilter ? { type: familyFilter } : {}),
      ...(options.slug ? { OR: [{ slug: options.slug }, { id: options.slug }] } : {}),
      ...(options.categorySlug ? { categoryRef: { slug: options.categorySlug } } : {}),
      ...(options.subcategorySlug ? { subcategoryRef: { slug: options.subcategorySlug } } : {}),
    })
  const products = await prisma.product.findMany({
    where,
    orderBy: options.orderBy || [{ sortOrder: "asc" }, { price1m: "asc" }],
    take: options.take,
    include: {
      categoryRef: { select: { slug: true, title: true } },
      subcategoryRef: { select: { slug: true, title: true } },
    },
  })
  const fallbackProducts = products.length ? [] : fallbackSeedProducts(options, familyFilter)
  const uniqueProducts = Array.from(new Map([...products, ...fallbackProducts].map((product) => [product.id, product])).values())

  const visibleProducts = uniqueProducts
    .filter((product) => normalizeProductFamily(product.type) !== "configurable" || customSettings.enableCustomConfiguration || product.id === "custom")
    .filter((product) => productVisibleInCountry(product, userCountry))
  return Promise.all(visibleProducts.map((product) => serializePublicProductWithRegional(product, term, billingPricingSettings, userCountry)))
}

async function serializePublicProductWithRegional(product: any, term: BillingTerm, billingPricingSettings: any, countryCode: string) {
  const serialized = serializePublicProduct(product, term, billingPricingSettings)
  const monthlyRegional = await getRegionalPrice({
    amountInr: serialized.pricing.monthly,
    countryCode,
    term,
    product: serialized.slug || serialized.id,
    context: { productId: serialized.id, source: "public_product_monthly" },
  }).catch(() => null)
  const termRegional = await getRegionalPrice({
    amountInr: serialized.pricing.termTotal,
    countryCode,
    term,
    product: serialized.slug || serialized.id,
    context: { productId: serialized.id, source: "public_product_term" },
  }).catch(() => null)
  return {
    ...serialized,
    regional: monthlyRegional,
    pricing: {
      ...serialized.pricing,
      regionalMonthly: monthlyRegional,
      regionalTerm: termRegional,
    },
  }
}

function fallbackSeedProducts(options: NonNullable<Parameters<typeof getPublicProducts>[0]>, familyFilter: string | null) {
  if (familyFilter === "configurable" || options.slug === "custom") {
    return [{
      id: "custom",
      slug: "custom",
      name: "Custom Cloud Instance",
      description: "Configure CPU, memory, storage, and bandwidth.",
      shortDescription: "Custom cloud instance",
      type: "configurable",
      ctaMode: "configure",
      ctaLabel: "Configure",
      badges: [],
      whatsappEnabled: false,
      cpuCores: 2,
      ramGb: 4,
      storageGb: 80,
      storageType: "nvme",
      bandwidthTb: 2,
      price1m: 499,
      price3m: null,
      price6m: null,
      price12m: null,
      price24m: null,
      price36m: null,
      features: ["Custom CPU", "Custom RAM", "NVMe storage", "DDoS Protection"],
      specs: {},
      optionGroups: [],
      regions: ["India"],
      billingTerms: [1, 3, 6, 12, 24, 36],
      isFeatured: false,
      categoryRef: { slug: "vps", title: "VPS" },
      subcategoryRef: null,
      seoTitle: null,
      seoDescription: null,
      seoKeywords: [],
    }]
  }
  const seeds = VPS_FIXED_SEED
    .filter((seed) => !options.slug || seed.slug === options.slug)
    .filter((seed) => !familyFilter || seed.family === familyFilter)
  return seeds.map((seed) => ({
    id: seed.slug,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    shortDescription: seed.shortDescription || seed.description,
    type: seed.family,
    ctaMode: seed.ctaMode,
    ctaLabel: seed.ctaLabel,
    badges: seed.badges || [],
    whatsappEnabled: Boolean(seed.whatsappEnabled),
    cpuCores: seed.cpuCores,
    ramGb: seed.ramGb,
    storageGb: seed.storageGb,
    storageType: seed.storageType,
    bandwidthTb: seed.bandwidthTb,
    price1m: seed.price1m,
    price3m: null,
    price6m: null,
    price12m: null,
    price24m: null,
    price36m: null,
    features: seed.features,
    specs: {},
    optionGroups: [],
    regions: ["India"],
    billingTerms: [1, 3, 6, 12, 24, 36],
    isFeatured: false,
    categoryRef: { slug: seed.categorySlug, title: seed.categorySlug === "vps" ? "VPS" : "Dedicated" },
    subcategoryRef: null,
    seoTitle: null,
    seoDescription: null,
    seoKeywords: [],
  }))
}

export function serializePublicProduct(product: any, term: BillingTerm = 1, billingPricingSettings?: any) {
  const storageType: StorageType = product.storageType === "ssd" ? "ssd" : "nvme"
  const quote = calculateFixedProductTermQuote({ product, term, settings: billingPricingSettings })
  const monthlyPrice = quote.selectedMonthlyPrice
  const fixedPricing =
    normalizeProductFamily(product.type) === "fixed_vps"
      ? computeFixedVpsPricing({
          cpuCores: product.cpuCores,
          ramGb: product.ramGb,
          storageGb: product.storageGb,
          storageType,
          bandwidthTb: Number(product.bandwidthTb),
          specs: (product.specs as Record<string, unknown>) || null,
          productMonthlyPrice: Number(product.price1m),
      })
      : null
  const productLike = {
    ...product,
    storageType,
    bandwidthTb: Number(product.bandwidthTb),
    bandwidthLabel: formatBandwidthQuota(product.bandwidthTb),
    features: stringArray(product.features),
    specs: (product.specs as Record<string, unknown>) || null,
  }

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription,
    type: normalizeProductFamily(product.type),
    ctaMode: product.ctaMode,
    ctaLabel: product.ctaLabel,
    badges: stringArray(product.badges),
    whatsappEnabled: Boolean(product.whatsappEnabled),
    dedicatedSettings: normalizeProductFamily(product.type) === "dedicated" ? dedicatedSettingsFromProduct(product) : null,
    cpuCores: product.cpuCores,
    ramGb: product.ramGb,
    storageGb: product.storageGb,
    storageType,
    bandwidthTb: Number(product.bandwidthTb),
    bandwidthLabel: formatBandwidthQuota(product.bandwidthTb),
    backupEnabled: Boolean(product.backupEnabled),
    backupPrice: Number(product.backupPrice || 0),
    backupStorageGb: Number(product.backupStorageGb || 0),
    snapshotEnabled: Boolean(product.snapshotEnabled),
    snapshotPrice: Number(product.snapshotPrice || 0),
    snapshotIncludedCount: Number(product.snapshotIncludedCount || 0),
    bandwidthEnabled: product.bandwidthEnabled !== false,
    bandwidthPrice: Number(product.bandwidthPrice || 0),
    bandwidthLimitTb: product.bandwidthLimitTb == null ? null : Number(product.bandwidthLimitTb),
    bandwidthOveragePrice: Number(product.bandwidthOveragePrice || 0),
    extraIpv4Price: Number(product.extraIpv4Price || 0),
    addOnPricing: {
      backup: {
        enabled: Boolean(product.backupEnabled),
        price: Number(product.backupPrice || 0),
        storageGb: Number(product.backupStorageGb || 0),
      },
      snapshot: {
        enabled: Boolean(product.snapshotEnabled),
        price: Number(product.snapshotPrice || 0),
        includedCount: Number(product.snapshotIncludedCount || 0),
      },
      bandwidth: {
        enabled: product.bandwidthEnabled !== false,
        includedTb: Number(product.bandwidthTb || 0),
        limitTb: product.bandwidthLimitTb == null ? null : Number(product.bandwidthLimitTb),
        price: Number(product.bandwidthPrice || 0),
        overagePrice: Number(product.bandwidthOveragePrice || 0),
      },
      ipv4: {
        extraPrice: Number(product.extraIpv4Price || 0),
      },
    },
    price1m: Number(product.price1m),
    price3m: product.price3m == null ? null : Number(product.price3m),
    price6m: product.price6m == null ? null : Number(product.price6m),
    price12m: product.price12m == null ? null : Number(product.price12m),
    price24m: product.price24m == null ? null : Number(product.price24m),
    price36m: product.price36m == null ? null : Number(product.price36m),
    pricing: {
      monthly: Number(product.price1m),
      termPrice: monthlyPrice,
      hourly: monthlyToHourly(monthlyPrice),
      term,
      termTotal: monthlyPrice * term,
      quote,
    },
    calculatedMonthlyPrice: fixedPricing?.calculatedMonthlyPrice ?? null,
    productMonthlyPrice: fixedPricing?.productMonthlyPrice ?? Number(product.price1m),
    fixedDiscountAmount: fixedPricing?.fixedDiscountAmount ?? 0,
    fixedDiscountPercent: fixedPricing?.fixedDiscountPercent ?? 0,
    showFixedDiscount: fixedPricing?.showFixedDiscount ?? false,
    pricingBreakdown: fixedPricing?.breakdown ?? null,
    features: generateProductFeatures(productLike),
    isFeatured: product.isFeatured,
    category: product.categoryRef,
    subcategory: product.subcategoryRef,
    specs: product.specs,
    generatedSpecs: generateProductSpecs(productLike),
    optionGroups: product.optionGroups,
    regions: product.regions,
    geoVisibility: normalizeProductGeoVisibility(product.metadata),
    billingTerms: normalizeProductFamily(product.type) === "fixed_vps" ? mergeBillingTerms(product.billingTerms) : product.billingTerms,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    seoKeywords: product.seoKeywords,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : []
}

function mergeBillingTerms(value: unknown) {
  const terms = Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []
  return Array.from(new Set([1, 3, 6, 12, 24, 36, ...terms])).sort((a, b) => a - b)
}
