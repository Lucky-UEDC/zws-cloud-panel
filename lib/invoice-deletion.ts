import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export const DELETABLE_INVOICE_STATUSES = ["pending", "failed", "cancelled", "expired", "unpaid"] as const
export const SUCCESSFUL_PAYMENT_STATUSES = ["completed", "paid", "success", "successful", "captured", "verification_pending"] as const

export type InvoiceDeletionBlockReason =
  | "not_found"
  | "paid_invoice"
  | "unsafe_status"
  | "successful_payment"
  | "active_order"
  | "active_service"

export type InvoiceDeletionSafety = {
  deletable: boolean
  reason: InvoiceDeletionBlockReason | null
  paidInvoice: boolean
}

type InvoiceForDeletion = {
  id: string
  type?: string | null
  status?: string | null
  paidAt?: Date | string | null
  deletedAt?: Date | string | null
  payments?: Array<{ status?: string | null }>
  paymentAttempts?: Array<{ status?: string | null }>
  order?: {
    id?: string | null
    status?: string | null
    isActive?: boolean | null
    deletedAt?: Date | string | null
    vpsInstance?: { id?: string | null; status?: string | null; deletedAt?: Date | string | null } | null
    dedicatedService?: { id?: string | null; status?: string | null } | null
  } | null
}

type InvoiceDeleteTx = Prisma.TransactionClient

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

export function isDeletableInvoiceStatus(_status: unknown) {
  return new Set<string>(DELETABLE_INVOICE_STATUSES).has(normalized(_status))
}

export function isSuccessfulPaymentStatus(status: unknown) {
  return new Set<string>(SUCCESSFUL_PAYMENT_STATUSES).has(normalized(status))
}

export function classifyInvoiceDeletionSafety(invoice: InvoiceForDeletion | null | undefined): InvoiceDeletionSafety {
  if (!invoice) return { deletable: false, reason: "not_found", paidInvoice: false }
  if (invoice.deletedAt) return { deletable: false, reason: "not_found", paidInvoice: false }
  const paidInvoice = normalized(invoice.status) === "paid" || Boolean(invoice.paidAt)
  const successfulPayment = [...(invoice.payments || []), ...(invoice.paymentAttempts || [])].some((row) => isSuccessfulPaymentStatus(row.status))
  const order = invoice.order || null
  const orderActive = Boolean(order && !order.deletedAt && order.isActive !== false && !["deleted", "cancelled", "canceled", "archived", "failed", "payment_failed"].includes(normalized(order.status)))
  const activeService = Boolean(
    orderActive && (
      (order?.vpsInstance && !order.vpsInstance.deletedAt && !["deleted", "terminated"].includes(normalized(order.vpsInstance.status))) ||
      (order?.dedicatedService && !["deleted", "cancelled", "canceled", "refunded"].includes(normalized(order.dedicatedService.status)))
    ),
  )
  if (successfulPayment) return { deletable: false, reason: "successful_payment", paidInvoice }
  if (paidInvoice && orderActive) return { deletable: false, reason: activeService ? "active_service" : "active_order", paidInvoice }
  if (!isDeletableInvoiceStatus(invoice.status) && normalized(invoice.type || "service") === "service") {
    return { deletable: false, reason: "unsafe_status", paidInvoice }
  }
  return {
    deletable: true,
    reason: null,
    paidInvoice,
  }
}

export function invoiceDeletionInclude() {
  return {
    payments: { select: { id: true, status: true } },
    paymentAttempts: { select: { id: true, status: true } },
    order: {
      select: {
        id: true,
        status: true,
        isActive: true,
        deletedAt: true,
        vpsInstance: { select: { id: true, status: true, deletedAt: true } },
        dedicatedService: { select: { id: true, status: true } },
      },
    },
  } as const
}

async function cleanupInvoiceDependencies(tx: InvoiceDeleteTx, invoiceIds: string[]) {
  if (!invoiceIds.length) return

  const payments = await tx.payment.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { id: true },
  })
  const paymentIds = payments.map((payment) => payment.id)

  const attempts = await tx.paymentAttempt.findMany({
    where: {
      OR: [
        { invoiceId: { in: invoiceIds } },
        ...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : []),
      ],
    },
    select: { id: true },
  })
  const attemptIds = attempts.map((attempt) => attempt.id)

  await tx.checkoutIntent.updateMany({ where: { invoiceId: { in: invoiceIds } }, data: { invoiceId: null } })
  await tx.serviceReminder.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await tx.whatsAppMessageLog.updateMany({ where: { invoiceId: { in: invoiceIds } }, data: { invoiceId: null } })

  if (attemptIds.length) {
    await tx.paymentBridgeToken.deleteMany({ where: { paymentAttemptId: { in: attemptIds } } })
    await tx.walletTransaction.deleteMany({ where: { paymentAttemptId: { in: attemptIds } } })
  }

  if (paymentIds.length) {
    await tx.couponRedemption.deleteMany({ where: { paymentId: { in: paymentIds } } })
    await tx.paymentGatewayAttempt.deleteMany({ where: { paymentId: { in: paymentIds } } })
    await tx.paymentWebhookEvent.deleteMany({ where: { paymentId: { in: paymentIds } } })
    await tx.walletTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } })
    await tx.gatewayLog.deleteMany({ where: { paymentId: { in: paymentIds } } })
  }

  await tx.paymentAttempt.deleteMany({
    where: {
      OR: [
        { invoiceId: { in: invoiceIds } },
        ...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : []),
      ],
    },
  })
  await tx.paymentTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
}

export async function deleteInvoicesPermanently(ids: string[]) {
  const invoiceIds = Array.from(new Set(ids.map(String).filter(Boolean)))
  if (!invoiceIds.length) return { deleted: 0, deletedIds: [] as string[], invoices: [] as any[] }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
  })
  const existingIds = invoices.map((invoice) => invoice.id)
  if (!existingIds.length) return { deleted: 0, deletedIds: [] as string[], invoices }

  await prisma.$transaction(async (tx) => {
    await cleanupInvoiceDependencies(tx, existingIds)
    await tx.invoice.deleteMany({ where: { id: { in: existingIds } } })
  })

  return { deleted: existingIds.length, deletedIds: existingIds, invoices }
}

export async function deleteInvoicesSafely(
  ids: string[],
  input: { actorEmail?: string | null; reason?: string | null } = {},
) {
  const invoiceIds = Array.from(new Set(ids.map(String).filter(Boolean)))
  const deletedIds: string[] = []
  const skipped: Array<{ id: string; reason: InvoiceDeletionBlockReason | null }> = []
  const invoices: any[] = []

  for (const id of invoiceIds) {
    const result = await deleteInvoiceSafely(id, input)
    if (result.invoice) invoices.push(result.invoice)
    if (result.deleted) deletedIds.push(id)
    else skipped.push({ id, reason: result.safety.reason })
  }

  return { deleted: deletedIds.length, deletedIds, skipped, invoices }
}

export async function deleteInvoiceSafely(
  id: string,
  _input: { actorEmail?: string | null; reason?: string | null; force?: boolean } = {},
) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceDeletionInclude() })
  if (!invoice) {
    return {
      deleted: false,
      forced: false,
      invoice: null,
      safety: classifyInvoiceDeletionSafety(null),
    }
  }
  const safety = classifyInvoiceDeletionSafety(invoice)
  // Force delete is an explicit admin override: it bypasses the paid/successful-payment/active-service
  // gate and hard-deletes the invoice + its own payment/bridge dependencies. It NEVER touches the linked
  // VPS/Order/service (cleanupInvoiceDependencies only delinks/removes invoice-scoped rows).
  if (!safety.deletable && !_input.force) {
    return {
      deleted: false,
      forced: false,
      invoice,
      safety,
    }
  }

  await prisma.$transaction(async (tx) => {
    await cleanupInvoiceDependencies(tx, [id])
    await tx.invoice.delete({ where: { id } })
  })

  return {
    deleted: true,
    forced: !safety.deletable,
    invoice,
    safety,
  }
}
