export type InvoiceTotalsInput = {
  subtotal: number
  gstPercent?: number | null
  discountAmount?: number | null
  gstEnabled?: boolean | null
  taxLabel?: string | null
}

export type InvoiceTotals = {
  subtotal: number
  discountAmount: number
  taxableAmount: number
  gstPercent: number
  gstAmount: number
  totalAmount: number
  taxLabel: string
}

export function money(value: unknown): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const subtotal = money(input.subtotal)
  const discountAmount = Math.min(subtotal, money(input.discountAmount))
  const taxableAmount = money(Math.max(0, subtotal - discountAmount))
  const gstPercent = input.gstEnabled === false ? 0 : money(input.gstPercent ?? 18)
  const gstAmount = money(taxableAmount * (gstPercent / 100))
  return {
    subtotal,
    discountAmount,
    taxableAmount,
    gstPercent,
    gstAmount,
    totalAmount: money(taxableAmount + gstAmount),
    taxLabel: String(input.taxLabel || "GST"),
  }
}

export function invoiceTaxWriteFields(input: {
  taxRate?: unknown
  taxAmount?: unknown
  gstPercent?: unknown
  gstAmount?: unknown
  taxLabel?: unknown
}) {
  const taxRate = money(input.gstPercent ?? input.taxRate ?? 18)
  const taxAmount = money(input.gstAmount ?? input.taxAmount ?? 0)
  return {
    taxRate,
    taxAmount,
    gstPercent: taxRate,
    gstAmount: taxAmount,
    taxLabel: String(input.taxLabel || "GST"),
  }
}
