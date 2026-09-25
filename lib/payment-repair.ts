import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { finalizeSuccessfulPayment, type FinalizeSuccessfulPaymentResult } from "@/lib/payment-finalization"
import { reconcileGatewayPayment, type ReconcileResult } from "@/lib/payment-reconciliation"
import { isWalletTopupPurpose } from "@/lib/wallet-topup"

const SUCCESS_ATTEMPT_STATUSES = ["success", "completed", "paid", "verification_pending"]
const SUCCESS_PAYMENT_STATUSES = ["completed", "paid", "success", "verification_pending"]

export async function repairPaidGatewayPayments(input: {
  limit?: number
  actor?: string
  dryRun?: boolean
} = {}) {
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 200))
  const actor = input.actor || "payment_repair"
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      gateway: { in: ["cashfree", "phonepe"] },
      OR: [
        { status: { in: SUCCESS_ATTEMPT_STATUSES } },
        { webhookVerifiedAt: { not: null } },
        { payment: { status: { in: SUCCESS_PAYMENT_STATUSES } } },
      ],
    },
    include: {
      payment: { include: { checkoutIntent: true, invoice: true, order: { include: { vpsInstance: true, dedicatedService: true, provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, take: 1 } } } } },
      invoice: true,
      order: { include: { vpsInstance: true, dedicatedService: true, provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, take: 1 } } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })

  const candidates = attempts.filter((attempt) => {
    const payment = attempt.payment
    if (!payment) return false
    const invoice = payment.invoice || attempt.invoice
    const order = payment.order || attempt.order
    const intent = payment.checkoutIntent
    const paidPayment = SUCCESS_PAYMENT_STATUSES.includes(String(payment.status || "").toLowerCase())
    const paidAttempt = SUCCESS_ATTEMPT_STATUSES.includes(String(attempt.status || "").toLowerCase()) || Boolean(attempt.webhookVerifiedAt)
    if (!paidPayment && !paidAttempt) return false
    if (invoice && String(invoice.status || "").toLowerCase() !== "paid") return true
    if (!order && intent) return true
    if (order && !order.vpsInstance && !order.dedicatedService && !order.provisioningJobs?.length && String(order.orderType || "").toLowerCase() !== "dedicated") return true
    return false
  })

  const repaired: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []

  for (const attempt of candidates) {
    if (input.dryRun) {
      skipped.push({ paymentAttemptId: attempt.id, reason: "dry_run" })
      continue
    }
    const result: FinalizeSuccessfulPaymentResult = await finalizeSuccessfulPayment(attempt.id, { actor }).catch((error) => ({
      finalized: false,
      reason: error?.message || "finalize_failed",
    }))
    const row = {
      paymentAttemptId: attempt.id,
      paymentId: attempt.paymentId,
      invoiceId: result.invoiceId || attempt.invoiceId || attempt.payment?.invoiceId || null,
      orderId: result.orderId || attempt.orderId || attempt.payment?.orderId || null,
      finalized: result.finalized,
      reason: result.reason || null,
      serviceId: result.serviceId || null,
      provisioningJobId: result.provisioningJobId || null,
    }
    if (result.finalized) repaired.push(row)
    else skipped.push(row)
  }

  await createPanelLog({
    category: "Payment",
    message: "paid_gateway_payment_repair_scan",
    metadata: {
      actor,
      scanned: attempts.length,
      candidates: candidates.length,
      repaired: repaired.length,
      skipped: skipped.length,
      repairedRecords: repaired,
      skippedRecords: skipped,
      dryRun: Boolean(input.dryRun),
    },
  }).catch(() => null)

  return { scanned: attempts.length, candidates: candidates.length, repaired, skipped, dryRun: Boolean(input.dryRun) }
}

const PENDING_SYNC_STATUSES = ["pending", "started", "processing", "created", "initiated"]

export async function repairStuckCashfreePayments(input: {
  limit?: number
  actor?: string
  dryRun?: boolean
} = {}) {
  const limit = Math.max(1, Math.min(Number(input.limit || 100), 500))
  const actor = input.actor || "cashfree_repair"
  const rows = await prisma.payment.findMany({
    where: {
      gateway: "cashfree",
      status: { in: PENDING_SYNC_STATUSES },
    },
    include: {
      order: { select: { id: true, orderNumber: true } },
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  })

  const repaired: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []

  for (const row of rows) {
    const refs = Array.from(new Set([
      row.paymentAttempts?.[0]?.merchantOrderId,
      row.paymentAttempts?.[0]?.gatewayOrderId,
      row.gatewayOrderId,
      row.topupReference,
      row.order?.orderNumber,
      row.id,
    ].filter(Boolean).map((value) => String(value).trim())))
    const reference = refs[0] || null
    if (!reference) {
      skipped.push({ paymentId: row.id, reason: "missing_reference" })
      continue
    }
    if (input.dryRun) {
      skipped.push({ paymentId: row.id, reference, reason: "dry_run" })
      continue
    }
    const result: ReconcileResult = await reconcileGatewayPayment(reference, actor).catch((error: any) => ({
      reconciled: false,
      paid: false,
      failed: false,
      status: String(row.status || "pending"),
      gatewayOrderIdUsed: null,
      gatewayHttpStatus: null,
      attemptedReferences: [reference],
      lastGatewayError: error?.message || "reconcile_failed",
      rawGatewaySummary: null,
    }))

    const item = {
      paymentId: row.id,
      orderId: row.orderId || null,
      invoiceId: row.invoiceId || null,
      reference,
      reconciled: result.reconciled,
      paid: result.paid,
      failed: result.failed,
      status: result.status,
      gatewayOrderIdUsed: result.gatewayOrderIdUsed || null,
      gatewayHttpStatus: result.gatewayHttpStatus ?? null,
      lastGatewayError: result.lastGatewayError || null,
    }
    if (result.paid || result.failed || result.reconciled) repaired.push(item)
    else skipped.push(item)
  }

  await createPanelLog({
    category: "Payment",
    message: "cashfree_stuck_payment_repair_scan",
    metadata: {
      actor,
      scanned: rows.length,
      repaired: repaired.length,
      skipped: skipped.length,
      dryRun: Boolean(input.dryRun),
      repairedRecords: repaired,
      skippedRecords: skipped,
    },
  }).catch(() => null)

  return {
    scanned: rows.length,
    repaired,
    skipped,
    dryRun: Boolean(input.dryRun),
  }
}

function isSuccessStatus(status: unknown) {
  const normalized = String(status || "").toLowerCase()
  return SUCCESS_PAYMENT_STATUSES.includes(normalized) || SUCCESS_ATTEMPT_STATUSES.includes(normalized)
}

export async function repairManualPaidInvoices(input: {
  limit?: number
  actor?: string
  dryRun?: boolean
} = {}) {
  const limit = Math.max(1, Math.min(Number(input.limit || 200), 1000))
  const actor = input.actor || "manual_paid_repair"
  const invoices = await prisma.invoice.findMany({
    where: { status: "paid" },
    include: {
      order: { include: { vpsInstance: true, dedicatedService: true, provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, orderBy: { createdAt: "desc" }, take: 1 } } },
      payments: { orderBy: { createdAt: "desc" }, include: { checkoutIntent: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  })

  const repaired: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []
  const errors: Array<Record<string, unknown>> = []

  for (const invoice of invoices) {
    const invoiceMeta = (invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata))
      ? invoice.metadata as Record<string, unknown>
      : {}
    const latestPayment = invoice.payments[0] || null
    const latestAttempt = invoice.paymentAttempts[0] || latestPayment?.paymentAttempts?.[0] || null
    const purpose = String(latestPayment?.purpose || invoiceMeta.paymentPurpose || invoiceMeta.invoiceType || "").toLowerCase()
    const walletTopup = isWalletTopupPurpose(purpose)
    const hasSuccessfulPayment = invoice.payments.some((payment) => isSuccessStatus(payment.status))
    const hasSuccessfulAttempt = invoice.paymentAttempts.some((attempt) => isSuccessStatus(attempt.status))
    const hasOrderOrIntent = Boolean(invoice.orderId || latestPayment?.orderId || latestPayment?.checkoutIntent?.fulfilledOrderId || latestAttempt?.orderId)
    const hasProvisioning = Boolean(invoice.order?.provisioningJobs?.[0]?.id || invoice.order?.vpsInstance?.id || invoice.order?.dedicatedService?.id)
    const needsWalletCreditCheck = walletTopup && latestAttempt?.id
    let walletMissing = false
    if (needsWalletCreditCheck) {
      const walletTxn = await prisma.walletTransaction.findFirst({
        where: { paymentAttemptId: latestAttempt.id },
        select: { id: true },
      })
      walletMissing = !walletTxn
    }

    const issueCodes = [
      !hasSuccessfulPayment ? "payment_not_success" : null,
      !hasSuccessfulAttempt ? "payment_attempt_not_success" : null,
      walletMissing ? "wallet_not_credited" : null,
      !walletTopup && !hasOrderOrIntent ? "order_or_intent_missing" : null,
      !walletTopup && hasOrderOrIntent && !hasProvisioning ? "provisioning_or_service_missing" : null,
    ].filter(Boolean) as string[]

    if (!issueCodes.length) continue

    if (!latestAttempt?.id) {
      skipped.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        reason: "no_usable_payment_attempt",
        issueCodes,
      })
      continue
    }

    if (input.dryRun) {
      skipped.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        reason: "dry_run",
        paymentAttemptId: latestAttempt.id,
        issueCodes,
      })
      continue
    }

    const result: FinalizeSuccessfulPaymentResult = await finalizeSuccessfulPayment(latestAttempt.id, { actor }).catch((error: any) => ({
      finalized: false,
      reason: error?.message || "finalize_failed",
    }))
    const row = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentAttemptId: latestAttempt.id,
      orderId: result.orderId || invoice.orderId || null,
      provisioningJobId: result.provisioningJobId || null,
      issueCodes,
      finalized: Boolean(result.finalized),
      reused: Boolean(result.reused),
      reason: result.reason || null,
      walletTopup,
    }
    if (result.finalized) repaired.push(row)
    else errors.push(row)
  }

  await createPanelLog({
    category: "Payment",
    message: "manual_paid_repair_scan",
    metadata: {
      actor,
      scanned: invoices.length,
      repaired: repaired.length,
      skipped: skipped.length,
      errors: errors.length,
      dryRun: Boolean(input.dryRun),
      repairedRecords: repaired,
      skippedRecords: skipped,
      errorRecords: errors,
    },
  }).catch(() => null)

  return {
    scanned: invoices.length,
    repaired,
    skipped,
    errors,
    dryRun: Boolean(input.dryRun),
  }
}
