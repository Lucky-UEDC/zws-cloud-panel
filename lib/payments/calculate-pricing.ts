export type CalculatePricingInput = {
  subtotal: number
  discount?: number
  gstRate?: number
  gstEnabled?: boolean
}

export type PricingCalculation = {
  subtotal: number
  discount: number
  discountPercent: number
  taxableAmount: number
  gst: number
  total: number
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

export function calculatePricing(input: CalculatePricingInput): PricingCalculation {
  const subtotal = Math.max(0, money(input.subtotal))
  const requestedDiscount = Math.max(0, money(input.discount || 0))
  const discount = Math.min(requestedDiscount, subtotal)
  const taxableAmount = Math.max(0, money(subtotal - discount))
  const gstRate = Math.max(0, Number(input.gstRate ?? 18))
  const gst = input.gstEnabled === false || taxableAmount <= 0 ? 0 : money(taxableAmount * (gstRate / 100))
  const total = money(taxableAmount + gst)
  const discountPercent = subtotal > 0 ? Number(((discount / subtotal) * 100).toFixed(1)) : 0

  return {
    subtotal,
    discount,
    discountPercent,
    taxableAmount,
    gst,
    total,
  }
}
