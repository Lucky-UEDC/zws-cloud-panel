/**
 * Revenue Analytics — authoritative financial computations.
 *
 * All values derived ONLY from authoritative financial records:
 *   - Invoice (paid service invoices, type="service", status="paid")
 *   - Payment (completed service payments, purpose != wallet_topup)
 *   - WalletTransaction (type="topup" for top-ups, type="refund" for refunds)
 *   - Payment.gateway="wallet" for wallet-funded service purchases
 *
 * NO phantom types, NO double-counting, NO made-up formulas.
 */

import { prisma } from "@/lib/db"

export const SERVICE_INVOICE_TYPE = "service"
export const WALLET_TOPUP_INVOICE_TYPE = "wallet_topup"
export const PAID_INVOICE_STATUS = "paid"
export const ACTIVE_BILLABLE_ORDER_STATUSES = ["paid", "active", "completed", "payment_verified"] as const
export const EXCLUDED_BILLING_STATUSES = ["deleted", "cancelled", "canceled", "archived", "failed", "expired", "payment_failed"] as const
export const EXCLUDED_PROVISIONING_STATUSES = ["deleted", "cancelled", "canceled", "archived", "failed", "provisioning_failed", "failed_deleted", "payment_failed"] as const
export const COMPLETED_PAYMENT_STATUSES = ["completed", "paid", "success", "successful", "captured"] as const
export const FAILED_PAYMENT_STATUSES = ["failed", "payment_failed"] as const
export const REFUNDED_PAYMENT_STATUSES = ["refunded", "refund"] as const
export const WALLET_PAYMENT_PURPOSES = ["wallet_topup", "topup"] as const
export const PENDING_INVOICE_STATUSES = ["draft", "sent", "pending", "unpaid", "overdue"] as const
export const CANCELLED_INVOICE_STATUSES = ["cancelled", "failed", "expired"] as const

export type DateRange = {
  start?: Date | null
  end?: Date | null
  field?: "createdAt" | "paidAt" | "completedAt"
}

export function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

export function dateRangeWhere(input: DateRange = {}) {
  const field = input.field || "createdAt"
  if (!input.start && !input.end) return {}
  return {
    [field]: {
      ...(input.start ? { gte: input.start } : {}),
      ...(input.end ? { lte: input.end } : {}),
    },
  }
}

export function paidServiceInvoiceWhere(input: DateRange = {}) {
  const field = input.field || "paidAt"
  const range = input.start || input.end
    ? field === "paidAt"
      ? {
          OR: [
            dateRangeWhere({ ...input, field: "paidAt" }),
            { paidAt: null, ...dateRangeWhere({ ...input, field: "createdAt" }) },
          ],
        }
      : dateRangeWhere({ ...input, field })
    : {}
  return {
    status: PAID_INVOICE_STATUS,
    type: { in: [SERVICE_INVOICE_TYPE] },
    deletedAt: null,
    order: { is: activeBillableOrderWhere() },
    ...range,
  }
}

export function activeBillableOrderWhere(extra: Record<string, unknown> = {}) {
  const activeStatuses = [...ACTIVE_BILLABLE_ORDER_STATUSES]
  const excludedStatuses = [...EXCLUDED_BILLING_STATUSES]
  const excludedProvisioningStatuses = [...EXCLUDED_PROVISIONING_STATUSES]
  return {
    deletedAt: null,
    isActive: true,
    status: { in: activeStatuses },
    NOT: {
      OR: [
        { status: { in: excludedStatuses } },
        { provisioningStatus: { in: excludedProvisioningStatuses } },
      ],
    },
    ...extra,
  }
}

export function activeServiceWhere(extra: Record<string, unknown> = {}) {
  return {
    deletedAt: null,
    status: { in: ["ACTIVE", "active", "RUNNING", "running"] },
    order: { is: activeBillableOrderWhere() },
    ...extra,
  }
}

export function visibleInvoiceWhere(extra: Record<string, unknown> = {}) {
  return { deletedAt: null, ...extra }
}

export function servicePaymentWhere(input: DateRange = {}) {
  return {
    status: { in: [...COMPLETED_PAYMENT_STATUSES] },
    purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] },
    invoice: { is: paidServiceInvoiceWhere({ start: input.start, end: input.end, field: "paidAt" }) },
    ...dateRangeWhere({ ...input, field: input.field || "completedAt" }),
  }
}

export async function getCustomerServiceSpendMap(customerIds: string[]) {
  const ids = [...new Set(customerIds.filter(Boolean))]
  if (!ids.length) return new Map<string, number>()

  const rows = await prisma.invoice.groupBy({
    by: ["customerId"],
    where: { customerId: { in: ids }, ...paidServiceInvoiceWhere() },
    _sum: { totalAmount: true },
  })
  return new Map(rows.map((row) => [row.customerId, money(row._sum.totalAmount)]))
}

export async function getDashboardRevenueTotal() {
  const aggregate = await prisma.invoice.aggregate({
    where: paidServiceInvoiceWhere(),
    _sum: { totalAmount: true },
  })
  return money(aggregate._sum.totalAmount)
}

export async function getActiveBillableOrderCount() {
  return prisma.order.count({ where: activeBillableOrderWhere() })
}

function termMonthsFromCycle(value: unknown) {
  const raw = String(value || "").trim().toLowerCase()
  if (raw === "yearly" || raw === "annual" || raw === "annually") return 12
  if (raw === "quarterly") return 3
  if (raw === "semiannual" || raw === "semi-annually" || raw === "semi_annually") return 6
  return 1
}

export function monthlyRecurringValue(input: {
  renewalAmount?: unknown
  billingTermMonths?: unknown
  billingCycle?: unknown
  order?: { totalAmount?: unknown; subtotal?: unknown; termMonths?: unknown } | null
}) {
  const renewalAmount = money(input.renewalAmount)
  const orderSubtotal = money(input.order?.subtotal)
  const orderTotal = money(input.order?.totalAmount)
  // Use subtotal (tax-exclusive) for MRR, not totalAmount (GST-inclusive)
  const amount = renewalAmount > 0 ? renewalAmount : orderSubtotal > 0 ? orderSubtotal : orderTotal
  const termMonths = Math.max(1, Number(input.billingTermMonths || input.order?.termMonths || termMonthsFromCycle(input.billingCycle) || 1))
  return money(amount / termMonths)
}

export async function getActiveRecurringRevenueMetrics() {
  const [vpsServices, dedicatedServices] = await Promise.all([
    prisma.vpsInstance.findMany({
      where: activeServiceWhere(),
      select: {
        renewalAmount: true,
        billingTermMonths: true,
        billingCycle: true,
        order: { select: { totalAmount: true, subtotal: true, termMonths: true } },
      },
    }),
    prisma.dedicatedService.findMany({
      where: {
        status: { in: ["ACTIVE", "active", "DELIVERED", "delivered"] },
        order: { is: activeBillableOrderWhere() },
      },
      select: {
        renewalAmount: true,
        order: { select: { totalAmount: true, subtotal: true, termMonths: true } },
      },
    }).catch(() => []),
  ])
  const vpsMrr = vpsServices.reduce((sum, service) => sum + monthlyRecurringValue(service), 0)
  const dedicatedMrr = dedicatedServices.reduce((sum, service) => sum + monthlyRecurringValue({ ...service, billingTermMonths: service.order?.termMonths }), 0)
  const mrr = money(vpsMrr + dedicatedMrr)
  return {
    mrr,
    arr: money(mrr * 12),
    activeServices: vpsServices.length + dedicatedServices.length,
    vpsServices: vpsServices.length,
    dedicatedServices: dedicatedServices.length,
  }
}

/** Revenue card definitions with distinct semantic meanings */
export const REVENUE_CARD_DEFINITIONS = [
  { key: "grossRevenue", label: "Gross Revenue", description: "Sum of paid service invoices (tax-inclusive)", format: "currency" },
  { key: "netRevenue", label: "Net Revenue", description: "Gross Revenue − GST/Tax collected", format: "currency" },
  { key: "collectedRevenue", label: "Collected", description: "Actual money collected via completed service payments", format: "currency" },
  { key: "gatewayFees", label: "Gateway Fees", description: "Sum of WalletTransaction.gatewayFee (top-ups) + GatewaySettlement.feeAmount", format: "currency" },
  { key: "gstCollected", label: "GST/Tax", description: "Sum of invoice.taxAmount (or gstAmount)", format: "currency" },
  { key: "refunds", label: "Refunds", description: "Completed wallet refunds + refunded payments (deduped)", format: "currency" },
  { key: "walletTopups", label: "Wallet Top-ups", description: "WalletTransaction type=topup (liability, NOT revenue)", format: "currency" },
  { key: "walletServicePayments", label: "Wallet Service Payments", description: "Service payments made via wallet (gateway=wallet)", format: "currency" },
  { key: "aov", label: "AOV", description: "Paid service revenue / paid service orders (excl. top-ups)", format: "currency" },
  { key: "mrr", label: "MRR", description: "Monthly Recurring Revenue (recurring services, tax-exclusive)", format: "currency" },
  { key: "arr", label: "ARR", description: "Annual Recurring Revenue (MRR × 12)", format: "currency" },
] as const

export type RevenueCardKey = (typeof REVENUE_CARD_DEFINITIONS)[number]["key"]