/**
 * Cloud pricing engine
 * 
 * Handles all pricing calculations including:
 * - Term-based pricing (1m, 3m, 6m, 12m, 24m, 36m)
 * - Monthly to hourly conversions
 * - Custom configuration pricing
 * - Discount calculations
 */

export type BillingTerm = 1 | 3 | 6 | 12 | 24 | 36

export const BILLING_TERMS: BillingTerm[] = [1, 3, 6, 12, 24, 36]

export type StorageType = "nvme" | "ssd"

export interface PricingConfig {
  currency: string
  currencySymbol: string
  taxRate: number // percentage
  discounts: {
    "1m": number
    "3m": number
    "6m": number
    "12m": number
    "24m": number
    "36m": number
  }
}

export interface CustomConfigPricing {
  cpuPerCore: number
  ramPerGb: number
  nvmePerGb: number
  ssdPerGb: number
  bandwidthPerTb: number
  includedBandwidthTb: number // Free bandwidth included
  hourlyMultiplier: number // Markup for hourly billing (1.25 = 25% more)
}

export interface CustomConfigLimits {
  maxCpu: number
  maxRamGb: number
  maxStorageNvmeGb: number
  maxStorageSsdGb: number
  maxBandwidthTb: number
}

export interface Product {
  id: string
  slug: string
  name: string
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType: StorageType
  bandwidthTb: number
  price1m: number
  price3m: number | null
  price6m: number | null
  price12m: number | null
  price24m: number | null
  price36m: number | null
  priceHourly: number | null
  features: string[]
}

// Default pricing configuration
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: "INR",
  currencySymbol: "INR",
  taxRate: 18,
  discounts: {
    "1m": 0,
    "3m": 5,
    "6m": 10,
    "12m": 15,
    "24m": 20,
    "36m": 25,
  },
}

export const DEFAULT_CUSTOM_CONFIG_PRICING: CustomConfigPricing = {
  cpuPerCore: 150,
  ramPerGb: 50,
  nvmePerGb: 0.5,
  ssdPerGb: 0.25,
  bandwidthPerTb: 100,
  includedBandwidthTb: 10, // 10 TB free bandwidth included
  hourlyMultiplier: 1.25, // Hourly is 25% more expensive
}

export const DEFAULT_CUSTOM_CONFIG_LIMITS: CustomConfigLimits = {
  maxCpu: 64,
  maxRamGb: 256,
  maxStorageNvmeGb: 4000,
  maxStorageSsdGb: 8000,
  maxBandwidthTb: 100,
}

// Hours in each billing period (approximate)
const HOURS_PER_MONTH = 730 // 365.25 * 24 / 12

/**
 * Get the price for a product at a specific billing term
 */
export function getProductPrice(product: Product, term: BillingTerm): number {
  switch (term) {
    case 1:
      return product.price1m
    case 3:
      return product.price3m ?? product.price1m * 0.9
    case 6:
      return product.price6m ?? product.price1m * 0.85
    case 12:
      return product.price12m ?? product.price1m * 0.8
    case 24:
      return product.price24m ?? product.price1m * 0.75
    case 36:
      return product.price36m ?? product.price1m * 0.75
    default:
      return product.price1m
  }
}

/**
 * Calculate the total price for a term
 */
export function calculateTermTotal(monthlyPrice: number, term: BillingTerm): number {
  return monthlyPrice * term
}

/**
 * Convert monthly price to hourly price
 */
export function monthlyToHourly(monthlyPrice: number): number {
  return Math.round((monthlyPrice / HOURS_PER_MONTH) * 10000) / 10000
}

/**
 * Convert hourly price to monthly price
 */
export function hourlyToMonthly(hourlyPrice: number): number {
  return Math.round(hourlyPrice * HOURS_PER_MONTH * 100) / 100
}

/**
 * Calculate savings percentage compared to monthly pricing
 */
export function calculateSavingsPercentage(
  monthlyPrice: number,
  termPrice: number,
  term: BillingTerm
): number {
  if (term === 1) return 0
  const fullPrice = monthlyPrice * term
  const savings = ((fullPrice - termPrice * term) / fullPrice) * 100
  return Math.round(savings)
}

/**
 * Calculate custom configuration price
 * 
 * Pricing rules:
 * 1. Bandwidth: First 10 TB free, then pay for overages
 * 2. Hourly: 25% premium on top of monthly equivalent
 * 3. Term discounts: Applied on top of configuration cost
 */
export function calculateCustomConfigPrice(
  config: {
    cpuCores: number
    ramGb: number
    storageGb: number
    storageType: StorageType
    bandwidthTb: number
  },
  pricing: CustomConfigPricing = DEFAULT_CUSTOM_CONFIG_PRICING,
  term: BillingTerm = 1,
  billingType: "monthly" | "hourly" = "monthly"
): {
  baseMonthly: number
  discountedMonthly: number
  hourly: number
  termTotal: number
  savingsPercentage: number
  breakdown: {
    cpu: number
    ram: number
    storage: number
    bandwidth: number
    bandwidthIncluded: number
  }
} {
  // Calculate component costs
  const cpuCost = config.cpuCores * pricing.cpuPerCore
  const ramCost = config.ramGb * pricing.ramPerGb
  const storageCost =
    config.storageType === "nvme"
      ? config.storageGb * pricing.nvmePerGb
      : config.storageGb * pricing.ssdPerGb
  
  // Bandwidth: Free for first 10 TB, then charge for overage
  const bandwidthOverage = Math.max(0, config.bandwidthTb - pricing.includedBandwidthTb)
  const bandwidthCost = bandwidthOverage * pricing.bandwidthPerTb
  const bandwidthIncluded = Math.min(config.bandwidthTb, pricing.includedBandwidthTb)

  const baseMonthly = cpuCost + ramCost + storageCost + bandwidthCost

  // Apply hourly markup if billing hourly
  let monthlyBeforeDiscount = baseMonthly
  if (billingType === "hourly") {
    monthlyBeforeDiscount = Math.round(baseMonthly * pricing.hourlyMultiplier * 100) / 100
  }

  // Apply term discount
  const discountRate = getTermDiscountRate(term)
  const discountedMonthly = Math.round(monthlyBeforeDiscount * (1 - discountRate) * 100) / 100

  const hourly = monthlyToHourly(discountedMonthly)
  const termTotal = calculateTermTotal(discountedMonthly, term)
  const savingsPercentage = calculateSavingsPercentage(monthlyBeforeDiscount, discountedMonthly, term)

  return {
    baseMonthly: monthlyBeforeDiscount, // Include hourly markup in base if applicable
    discountedMonthly,
    hourly,
    termTotal,
    savingsPercentage,
    breakdown: {
      cpu: cpuCost,
      ram: ramCost,
      storage: storageCost,
      bandwidth: bandwidthCost,
      bandwidthIncluded,
    },
  }
}

/**
 * Get the discount rate for a billing term
 */
export function getTermDiscountRate(term: BillingTerm): number {
  switch (term) {
    case 1:
      return 0
    case 3:
      return 0.05
    case 6:
      return 0.1
    case 12:
      return 0.15
    case 24:
      return 0.2
    case 36:
      return 0.25
    default:
      return 0
  }
}

/**
 * Validate custom configuration against limits
 */
export function validateCustomConfig(
  config: {
    cpuCores: number
    ramGb: number
    storageGb: number
    storageType: StorageType
    bandwidthTb: number
  },
  limits: CustomConfigLimits = DEFAULT_CUSTOM_CONFIG_LIMITS
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (config.cpuCores < 1 || config.cpuCores > limits.maxCpu) {
    errors.push(`CPU cores must be between 1 and ${limits.maxCpu}`)
  }

  if (config.ramGb < 1 || config.ramGb > limits.maxRamGb) {
    errors.push(`RAM must be between 1 GB and ${limits.maxRamGb} GB`)
  }

  const maxStorage =
    config.storageType === "nvme" ? limits.maxStorageNvmeGb : limits.maxStorageSsdGb

  if (config.storageGb < 10 || config.storageGb > maxStorage) {
    errors.push(`${config.storageType.toUpperCase()} storage must be between 10 GB and ${maxStorage} GB`)
  }

  if (config.bandwidthTb < 1 || config.bandwidthTb > limits.maxBandwidthTb) {
    errors.push(`Bandwidth must be between 1 TB and ${limits.maxBandwidthTb} TB`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Calculate tax amount
 */
export function calculateTax(
  amount: number,
  taxRate: number = DEFAULT_PRICING_CONFIG.taxRate
): number {
  return Math.round(amount * (taxRate / 100) * 100) / 100
}

/**
 * Format price with currency symbol
 */
export function formatPrice(
  amount: number,
  currency: string = DEFAULT_PRICING_CONFIG.currencySymbol
): string {
  const code = /^[A-Z]{3}$/.test(String(currency || "")) ? String(currency).toUpperCase() : DEFAULT_PRICING_CONFIG.currency
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0))
}

/**
 * Format hourly price
 */
export function formatHourlyPrice(
  hourly: number,
  currency: string = DEFAULT_PRICING_CONFIG.currencySymbol
): string {
  return `${formatPrice(hourly, currency)}/hr`
}

/**
 * Get term label
 */
export function getTermLabel(term: BillingTerm): string {
  switch (term) {
    case 1:
      return "Monthly"
    case 3:
      return "3 Months"
    case 6:
      return "6 Months"
    case 12:
      return "1 Year"
    case 24:
      return "2 Years"
    case 36:
      return "3 Years"
    default:
      return `${term} Months`
  }
}

/**
 * Get all available billing terms
 */
export function getBillingTerms(): BillingTerm[] {
  return BILLING_TERMS
}
