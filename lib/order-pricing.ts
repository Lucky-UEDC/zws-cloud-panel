import { calculateTax } from "@/lib/pricing"

export type OrderPricingLineItem = {
  label: string
  amount: number
  recurring?: boolean
  included?: boolean
}

export type CalculateOrderPricingInput = {
  monthlyBase: number
  monthlyFinal?: number
  termMonths: number
  discountPercent?: number
  couponDiscount?: number
  gstEnabled?: boolean
  gstPercent?: number
  lineItems?: OrderPricingLineItem[]
}

export type OrderPricingResult = {
  monthlyBase: number
  originalMonthly?: number
  monthlyAfterDiscount: number
  hasDiscount: boolean
  discountPercent: number
  termSubtotal: number
  discountAmount: number
  couponDiscount: number
  gstAmount: number
  payableToday: number
  renewalAmount: number
  effectiveMonthly: number
  lineItems: OrderPricingLineItem[]
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

export function calculateOrderPricing(input: CalculateOrderPricingInput): OrderPricingResult {
  const termMonths = Math.max(1, Number(input.termMonths || 1))
  const monthlyBase = money(input.monthlyBase)
  const requestedFinal = input.monthlyFinal == null ? monthlyBase : money(input.monthlyFinal)
  const discountPercent = Math.max(0, Number(input.discountPercent || 0))
  const discountedByPercent = discountPercent > 0 ? money(monthlyBase * (1 - discountPercent / 100)) : monthlyBase
  const monthlyAfterDiscount = money(Math.min(requestedFinal, discountedByPercent || requestedFinal || monthlyBase))
  const hasDiscount = discountPercent > 0 && monthlyBase > monthlyAfterDiscount
  const originalMonthly = hasDiscount ? monthlyBase : undefined
  const baseSubtotal = money(monthlyBase * termMonths)
  const termSubtotal = money(monthlyAfterDiscount * termMonths)
  const discountAmount = money(Math.max(0, baseSubtotal - termSubtotal))
  const couponDiscount = money(Math.max(0, input.couponDiscount || 0))
  const taxable = money(Math.max(0, termSubtotal - couponDiscount))
  const gstAmount = input.gstEnabled === false ? 0 : calculateTax(taxable, input.gstPercent ?? 18)
  const payableToday = money(Math.max(0, taxable + gstAmount))
  const renewalAmount = money(termSubtotal + gstAmount)

  return {
    monthlyBase,
    originalMonthly,
    monthlyAfterDiscount,
    hasDiscount,
    discountPercent: hasDiscount ? Math.round((discountAmount / Math.max(1, baseSubtotal)) * 100) : 0,
    termSubtotal,
    discountAmount,
    couponDiscount,
    gstAmount,
    payableToday,
    renewalAmount,
    effectiveMonthly: money(payableToday / termMonths),
    lineItems: input.lineItems || [],
  }
}

