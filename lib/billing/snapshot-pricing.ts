export function moneyCents(value: number | string): number {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return 0
  return Math.round((parsed + Number.EPSILON) * 100) / 100
}

export type SnapshotQuote = {
  subtotal: number
  discount: number
  taxableAmount: number
  taxPercent: number
  gst: number
  total: number
}

export function calculateSnapshotQuote(input: { baseAmount: number; taxPercent: number }): SnapshotQuote {
  const subtotal = moneyCents(input.baseAmount)
  const taxPercent = moneyCents(input.taxPercent)
  const taxableAmount = moneyCents(subtotal)
  const gst = moneyCents(moneyCents(taxableAmount) * (taxPercent / 100))
  const total = moneyCents(subtotal + gst)
  return { subtotal, discount: 0, taxableAmount, gst, taxPercent, total }
}

export function creditCoversTotal(credit: number | string, total: number): boolean {
  const creditAmount = moneyCents(credit)
  const payable = moneyCents(total)
  return creditAmount >= payable
}

export const SNAPSHOT_LIFECYCLE_STATES = [
  "REQUESTED",
  "PAYMENT_PENDING",
  "PAID",
  "CREATING",
  "COMPLETED",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
  "CANCELLED",
] as const

export type SnapshotLifecycleState = (typeof SNAPSHOT_LIFECYCLE_STATES)[number]

export const SNAPSHOT_CHARGE_STATUSES = ["unpaid", "paid", "failed", "refund_pending", "refunded", "completed", "cancelled"] as const
export type SnapshotChargeStatus = (typeof SNAPSHOT_CHARGE_STATUSES)[number]

export function nextSnapshotChargeStatus(lifecycle: SnapshotLifecycleState, wasPaid = false): SnapshotChargeStatus {
  switch (lifecycle) {
    case "REQUESTED":
    case "PAYMENT_PENDING":
      return "unpaid"
    case "PAID":
    case "CREATING":
      return "paid"
    case "COMPLETED":
      return wasPaid ? "paid" : "completed"
    case "FAILED":
      return wasPaid ? "refund_pending" : "failed"
    case "REFUND_PENDING":
      return "refund_pending"
    case "REFUNDED":
      return "refunded"
    case "CANCELLED":
      return "cancelled"
  }
}