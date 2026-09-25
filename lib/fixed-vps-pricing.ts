import { DEFAULT_CUSTOM_CONFIG_PRICING } from "@/lib/pricing"

type FixedVpsInput = {
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType?: string | null
  bandwidthTb?: number | null
  specs?: Record<string, unknown> | null
  productMonthlyPrice: number
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function computeFixedVpsPricing(input: FixedVpsInput) {
  const storageType = String(input.storageType || "nvme").toLowerCase()
  const cpuPrice = Number((toNumber(input.cpuCores) * DEFAULT_CUSTOM_CONFIG_PRICING.cpuPerCore).toFixed(2))
  const ramPrice = Number((toNumber(input.ramGb) * DEFAULT_CUSTOM_CONFIG_PRICING.ramPerGb).toFixed(2))
  const storageRate =
    storageType === "ssd" ? DEFAULT_CUSTOM_CONFIG_PRICING.ssdPerGb : DEFAULT_CUSTOM_CONFIG_PRICING.nvmePerGb
  const storagePrice = Number((toNumber(input.storageGb) * storageRate).toFixed(2))
  const bandwidthOverage = Math.max(0, toNumber(input.bandwidthTb) - DEFAULT_CUSTOM_CONFIG_PRICING.includedBandwidthTb)
  const bandwidthPrice = Number((bandwidthOverage * DEFAULT_CUSTOM_CONFIG_PRICING.bandwidthPerTb).toFixed(2))

  const specs = input.specs || {}
  const osPrice = Number(
    toNumber((specs as Record<string, unknown>).osPrice ?? (specs as Record<string, unknown>).operatingSystemPrice).toFixed(2),
  )
  const regionPrice = Number(
    toNumber((specs as Record<string, unknown>).regionPrice ?? (specs as Record<string, unknown>).locationPrice).toFixed(2),
  )

  const calculatedMonthlyPrice = Number((cpuPrice + ramPrice + storagePrice + bandwidthPrice + osPrice + regionPrice).toFixed(2))
  const productMonthlyPrice = Number(toNumber(input.productMonthlyPrice).toFixed(2))
  const fixedDiscountAmount = Math.max(0, Number((calculatedMonthlyPrice - productMonthlyPrice).toFixed(2)))
  const showFixedDiscount = fixedDiscountAmount > 0
  const fixedDiscountPercent = showFixedDiscount
    ? Math.round((fixedDiscountAmount / calculatedMonthlyPrice) * 100)
    : 0

  return {
    breakdown: {
      cpuPrice,
      ramPrice,
      storagePrice,
      bandwidthPrice,
      osPrice,
      regionPrice,
    },
    calculatedMonthlyPrice,
    productMonthlyPrice,
    fixedDiscountAmount,
    fixedDiscountPercent,
    showFixedDiscount,
  }
}
