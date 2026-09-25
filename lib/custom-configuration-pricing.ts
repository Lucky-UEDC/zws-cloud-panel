import type { BillingTerm, StorageType } from "@/lib/pricing"

export type CustomConfigurationSettings = {
  version: number
  enableCustomConfiguration: boolean
  currency: string
  vcpuPricePerCoreInr: number
  ramPricePerGbInr: number
  nvmeStoragePricePerGbInr: number
  ssdStoragePricePerGbInr: number
  bandwidthPricePerTbInr: number
  minimumVcpu: number
  maximumVcpu: number
  defaultVcpu: number
  minimumRamGb: number
  maximumRamGb: number
  defaultRamGb: number
  minimumStorageGb: number
  maximumStorageGb: number
  defaultStorageGb: number
  minimumBandwidthTb: number
  maximumBandwidthTb: number
  defaultBandwidthTb: number
  maximumDisks: number
  defaultRegion: string
  defaultOs: string
  taxPercent: number
  monthlyDiscountPercent: number
  threeMonthDiscountPercent: number
  sixMonthDiscountPercent: number
  twelveMonthDiscountPercent: number
  twentyFourMonthDiscountPercent: number
  thirtySixMonthDiscountPercent: number
  updatedAt?: string
  updatedBy?: string
}

export type CustomConfigurationInput = {
  cpuCores: number
  ramGb: number
  storageGb?: number
  storageType?: StorageType
  disks?: Array<{ type?: StorageType | string; sizeGb?: number }>
  bandwidthTb: number
  term: BillingTerm
}

export type CustomConfigurationQuote = {
  currency: string
  baseMonthly: number
  discountedMonthly: number
  discountPercent: number
  discountAmountMonthly: number
  subtotal: number
  taxRate: number
  taxAmount: number
  grandTotal: number
  breakdown: {
    cpu: number
    ram: number
    storage: number
    bandwidth: number
  }
}

export const DEFAULT_CUSTOM_CONFIGURATION_SETTINGS: CustomConfigurationSettings = {
  version: 1,
  enableCustomConfiguration: false,
  currency: "INR",
  vcpuPricePerCoreInr: 150,
  ramPricePerGbInr: 50,
  nvmeStoragePricePerGbInr: 0.5,
  ssdStoragePricePerGbInr: 0.25,
  bandwidthPricePerTbInr: 100,
  minimumVcpu: 1,
  maximumVcpu: 64,
  defaultVcpu: 4,
  minimumRamGb: 2,
  maximumRamGb: 256,
  defaultRamGb: 8,
  minimumStorageGb: 40,
  maximumStorageGb: 4000,
  defaultStorageGb: 160,
  minimumBandwidthTb: 1,
  maximumBandwidthTb: 100,
  defaultBandwidthTb: 2,
  maximumDisks: 5,
  defaultRegion: "Mumbai (BOM)",
  defaultOs: "",
  taxPercent: 18,
  monthlyDiscountPercent: 0,
  threeMonthDiscountPercent: 5,
  sixMonthDiscountPercent: 10,
  twelveMonthDiscountPercent: 15,
  twentyFourMonthDiscountPercent: 20,
  thirtySixMonthDiscountPercent: 25,
}

const TERM_DISCOUNT_FIELD: Record<BillingTerm, keyof CustomConfigurationSettings> = {
  1: "monthlyDiscountPercent",
  3: "threeMonthDiscountPercent",
  6: "sixMonthDiscountPercent",
  12: "twelveMonthDiscountPercent",
  24: "twentyFourMonthDiscountPercent",
  36: "thirtySixMonthDiscountPercent",
}

function toPaise(value: number) {
  return Math.round(Number(value || 0) * 100)
}

function fromPaise(value: number) {
  return Number((value / 100).toFixed(2))
}

function percentToBasisPoints(value: number) {
  return Math.round(Number(value || 0) * 100)
}

function applyPercent(amountPaise: number, percent: number) {
  return Math.round((amountPaise * percentToBasisPoints(percent)) / 10_000)
}

function positiveInt(value: number, fallback: number) {
  const parsed = Math.round(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function normalizeCustomConfigurationSettings(
  input: Partial<CustomConfigurationSettings> | null | undefined,
): CustomConfigurationSettings {
  const merged = { ...DEFAULT_CUSTOM_CONFIGURATION_SETTINGS, ...(input || {}) }
  const minimumVcpu = positiveInt(merged.minimumVcpu, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.minimumVcpu)
  const maximumVcpu = Math.max(minimumVcpu, positiveInt(merged.maximumVcpu, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.maximumVcpu))
  const minimumRamGb = positiveInt(merged.minimumRamGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.minimumRamGb)
  const maximumRamGb = Math.max(minimumRamGb, positiveInt(merged.maximumRamGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.maximumRamGb))
  const minimumStorageGb = positiveInt(merged.minimumStorageGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.minimumStorageGb)
  const maximumStorageGb = Math.max(minimumStorageGb, positiveInt(merged.maximumStorageGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.maximumStorageGb))
  const minimumBandwidthTb = positiveInt(merged.minimumBandwidthTb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.minimumBandwidthTb)
  const maximumBandwidthTb = Math.max(minimumBandwidthTb, positiveInt(merged.maximumBandwidthTb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.maximumBandwidthTb))

  return {
    ...merged,
    currency: merged.currency || "INR",
    vcpuPricePerCoreInr: Math.max(0, Number(merged.vcpuPricePerCoreInr || 0)),
    ramPricePerGbInr: Math.max(0, Number(merged.ramPricePerGbInr || 0)),
    nvmeStoragePricePerGbInr: Math.max(0, Number(merged.nvmeStoragePricePerGbInr || 0)),
    ssdStoragePricePerGbInr: Math.max(0, Number(merged.ssdStoragePricePerGbInr || 0)),
    bandwidthPricePerTbInr: Math.max(0, Number(merged.bandwidthPricePerTbInr || 0)),
    minimumVcpu,
    maximumVcpu,
    defaultVcpu: clamp(positiveInt(merged.defaultVcpu, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.defaultVcpu), minimumVcpu, maximumVcpu),
    minimumRamGb,
    maximumRamGb,
    defaultRamGb: clamp(positiveInt(merged.defaultRamGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.defaultRamGb), minimumRamGb, maximumRamGb),
    minimumStorageGb,
    maximumStorageGb,
    defaultStorageGb: clamp(positiveInt(merged.defaultStorageGb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.defaultStorageGb), minimumStorageGb, maximumStorageGb),
    minimumBandwidthTb,
    maximumBandwidthTb,
    defaultBandwidthTb: clamp(positiveInt(merged.defaultBandwidthTb, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.defaultBandwidthTb), minimumBandwidthTb, maximumBandwidthTb),
    maximumDisks: clamp(positiveInt(merged.maximumDisks, DEFAULT_CUSTOM_CONFIGURATION_SETTINGS.maximumDisks), 1, 20),
    taxPercent: clamp(Number(merged.taxPercent || 0), 0, 100),
    monthlyDiscountPercent: clamp(Number(merged.monthlyDiscountPercent || 0), 0, 100),
    threeMonthDiscountPercent: clamp(Number(merged.threeMonthDiscountPercent || 0), 0, 100),
    sixMonthDiscountPercent: clamp(Number(merged.sixMonthDiscountPercent || 0), 0, 100),
    twelveMonthDiscountPercent: clamp(Number(merged.twelveMonthDiscountPercent || 0), 0, 100),
    twentyFourMonthDiscountPercent: clamp(Number(merged.twentyFourMonthDiscountPercent || 0), 0, 100),
  }
}

export function getCustomConfigurationDiscountPercent(settings: CustomConfigurationSettings, term: BillingTerm) {
  return Number(settings[TERM_DISCOUNT_FIELD[term]] || 0)
}

export function validateCustomConfigurationInput(
  input: CustomConfigurationInput,
  settings: CustomConfigurationSettings,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const totalStorageGb = Array.isArray(input.disks) && input.disks.length
    ? input.disks.reduce((sum, disk) => sum + Number(disk.sizeGb || 0), 0)
    : Number(input.storageGb || 0)

  if (input.cpuCores < settings.minimumVcpu || input.cpuCores > settings.maximumVcpu) {
    errors.push(`vCPU must be between ${settings.minimumVcpu} and ${settings.maximumVcpu}.`)
  }
  if (input.ramGb < settings.minimumRamGb || input.ramGb > settings.maximumRamGb) {
    errors.push(`RAM must be between ${settings.minimumRamGb} GB and ${settings.maximumRamGb} GB.`)
  }
  if (totalStorageGb < settings.minimumStorageGb || totalStorageGb > settings.maximumStorageGb) {
    errors.push(`Storage must be between ${settings.minimumStorageGb} GB and ${settings.maximumStorageGb} GB.`)
  }
  if (input.bandwidthTb < settings.minimumBandwidthTb || input.bandwidthTb > settings.maximumBandwidthTb) {
    errors.push(`Bandwidth must be between ${settings.minimumBandwidthTb} TB and ${settings.maximumBandwidthTb} TB.`)
  }
  if (Array.isArray(input.disks) && input.disks.length > settings.maximumDisks) {
    errors.push(`Storage disks cannot exceed ${settings.maximumDisks}.`)
  }

  return { valid: errors.length === 0, errors }
}

export function calculateCustomConfigurationQuote(
  input: CustomConfigurationInput,
  sourceSettings: CustomConfigurationSettings,
): CustomConfigurationQuote {
  const settings = normalizeCustomConfigurationSettings(sourceSettings)
  const disks = Array.isArray(input.disks) && input.disks.length
    ? input.disks
    : [{ type: input.storageType || "nvme", sizeGb: input.storageGb || settings.defaultStorageGb }]
  const cpuPaise = toPaise(settings.vcpuPricePerCoreInr) * Math.round(Number(input.cpuCores || 0))
  const ramPaise = toPaise(settings.ramPricePerGbInr) * Math.round(Number(input.ramGb || 0))
  const storagePaise = disks.reduce((sum, disk) => {
    const type = String(disk.type || "nvme").toLowerCase() === "ssd" ? "ssd" : "nvme"
    const rate = type === "ssd" ? settings.ssdStoragePricePerGbInr : settings.nvmeStoragePricePerGbInr
    return sum + toPaise(rate) * Math.round(Number(disk.sizeGb || 0))
  }, 0)
  const bandwidthPaise = toPaise(settings.bandwidthPricePerTbInr) * Math.round(Number(input.bandwidthTb || 0))
  const baseMonthlyPaise = cpuPaise + ramPaise + storagePaise + bandwidthPaise
  const discountPercent = getCustomConfigurationDiscountPercent(settings, input.term)
  const discountPaise = applyPercent(baseMonthlyPaise, discountPercent)
  const discountedMonthlyPaise = Math.max(0, baseMonthlyPaise - discountPaise)
  const subtotalPaise = discountedMonthlyPaise * input.term
  const taxPaise = applyPercent(subtotalPaise, settings.taxPercent)

  return {
    currency: settings.currency,
    baseMonthly: fromPaise(baseMonthlyPaise),
    discountedMonthly: fromPaise(discountedMonthlyPaise),
    discountPercent,
    discountAmountMonthly: fromPaise(discountPaise),
    subtotal: fromPaise(subtotalPaise),
    taxRate: settings.taxPercent,
    taxAmount: fromPaise(taxPaise),
    grandTotal: fromPaise(subtotalPaise + taxPaise),
    breakdown: {
      cpu: fromPaise(cpuPaise),
      ram: fromPaise(ramPaise),
      storage: fromPaise(storagePaise),
      bandwidth: fromPaise(bandwidthPaise),
    },
  }
}
