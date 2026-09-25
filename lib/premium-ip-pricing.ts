export type PremiumIpPricingMode = "standard" | "bulk"

export type PremiumIpPricingResult = {
  quantity: number
  mode: PremiumIpPricingMode
  pricePerIp: number
  monthlyTotal: number
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

export function premiumIpUnitPrice(quantity: unknown, mode?: PremiumIpPricingMode | string | null) {
  const qty = Math.max(0, Math.floor(Number(quantity || 0)))
  if (qty <= 0) return 0
  if (mode === "bulk") return 80
  if (qty === 5) return 100
  if (qty > 5) return 80
  return Math.max(80, 150 - qty * 10)
}

export function calculatePremiumIpPricing(input: { quantity?: unknown; mode?: PremiumIpPricingMode | string | null }): PremiumIpPricingResult {
  const quantity = Math.max(0, Math.floor(Number(input.quantity || 0)))
  const mode = input.mode === "bulk" ? "bulk" : "standard"
  if (quantity <= 0) return { quantity: 0, mode, pricePerIp: 0, monthlyTotal: 0 }
  if (mode === "bulk") {
    if (quantity < 5) throw new Error("Bulk premium IP pricing requires at least 5 IPs")
    return { quantity, mode, pricePerIp: 80, monthlyTotal: money(quantity * 80) }
  }
  const pricePerIp = premiumIpUnitPrice(quantity, mode)
  return { quantity, mode, pricePerIp, monthlyTotal: money(quantity * pricePerIp) }
}

export function normalizePremiumIpRequest(input: {
  quantity?: unknown
  enabled?: unknown
  bulk?: unknown
  mode?: unknown
}) {
  const quantity = Math.max(0, Math.floor(Number(input.quantity || 0)))
  const enabled = Boolean(input.enabled || quantity > 0)
  const mode = input.mode === "bulk" || input.bulk === true ? "bulk" : "standard"
  if (!enabled || quantity <= 0) {
    return { enabled: false, quantity: 0, mode: "standard" as PremiumIpPricingMode, pricing: calculatePremiumIpPricing({ quantity: 0 }) }
  }
  return { enabled: true, quantity, mode: mode as PremiumIpPricingMode, pricing: calculatePremiumIpPricing({ quantity, mode }) }
}
