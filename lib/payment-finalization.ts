import { prisma } from "@/lib/db"
import { markDedicatedPaymentConfirmed } from "@/lib/dedicated"
import { createInvoiceForOrder } from "@/lib/invoices"
import { createPanelLog } from "@/lib/panel-log"
import { enqueueProvisioningJob, enqueueUpgradeJob } from "@/lib/provision"
import { finalizeWalletTopupPayment, isWalletTopupPurpose } from "@/lib/wallet-topup"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { withRedisLock } from "@/lib/redis"
import { enqueuePaymentOutbox } from "@/lib/payments/outbox"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"
import { isBillableOrder, orderKind } from "@/lib/billing/kinds"
import { settleBillableOrderAfterPayment } from "@/lib/billing/settlement"

const PAID_PAYMENT_STATUSES = new Set(["completed", "paid", "success", "verification_pending"])
const UPGRADE_ORDER_TYPES = new Set(["vps_upgrade", "instance_upgrade", "disk_resize", "disk_migrate", "disk_add"])

export function isPaidPaymentStatus(status: unknown) {
  return PAID_PAYMENT_STATUSES.has(String(status || "").toLowerCase())
}

export function isPendingPaymentStatus(status: unknown) {
  return ["pending", "created", "initiated", "waiting", "started"].includes(String(status || "").toLowerCase())
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function checkoutSessionHasOrderSnapshot(session: { snapshot?: unknown } | null | undefined) {
  const snapshot = record(session?.snapshot)
  const orderData = record(snapshot.orderData)
  const bulkOrders = Array.isArray(snapshot.bulkOrders)
    ? snapshot.bulkOrders.map((item) => record(item)).filter((item) => Object.keys(item).length)
    : []
  return Object.keys(orderData).length > 0 || bulkOrders.length > 0
}

async function findRecoverableOrderCheckoutSession(input: {
  invoiceId?: string | null
  currentCheckoutSessionId?: string | null
}) {
  if (!input.invoiceId) return null
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, metadata: true },
  }).catch((error) => {
    paymentFlowError("Invoice lookup failed during checkout recovery", error, { invoiceId: input.invoiceId })
    return null
  })
  const metadata = record(invoice?.metadata)
  const metadataSessionId = String(metadata.checkoutSessionId || "").trim()
  const candidates: Array<any> = []
  if (metadataSessionId && metadataSessionId !== input.currentCheckoutSessionId) {
    const session = await prisma.checkoutSession.findUnique({ where: { id: metadataSessionId } }).catch((error) => {
      paymentFlowError("Metadata checkout session lookup failed", error, { invoiceId: input.invoiceId, checkoutSessionId: metadataSessionId })
      return null
    })
    if (session) candidates.push(session)
  }
  const sessions = await prisma.checkoutSession.findMany({
    where: {
      invoiceId: input.invoiceId,
      id: input.currentCheckoutSessionId ? { not: input.currentCheckoutSessionId } : undefined,
      purpose: "order_payment",
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  }).catch((error) => {
    paymentFlowError("Order checkout session scan failed", error, { invoiceId: input.invoiceId, currentCheckoutSessionId: input.currentCheckoutSessionId })
    return []
  })
  candidates.push(...sessions)
  return candidates.find((session) => checkoutSessionHasOrderSnapshot(session)) || null
}

function isUpgradeOrder(order: any, purpose?: string | null) {
  const normalizedPurpose = String(purpose || "").toLowerCase()
  const orderType = String(order?.orderType || "").toLowerCase()
  const metadata = record(order?.metadata)
  return normalizedPurpose === "upgrade_order" ||
    UPGRADE_ORDER_TYPES.has(orderType) ||
    String(metadata.kind || "").toLowerCase() === "upgrade" ||
    String(metadata.kind || "").toLowerCase() === "disk_upgrade" ||
    Boolean(metadata.upgrade?.vpsInstanceId)
}

function money(value: unknown) {
  const next = Number(value || 0)
  return Number.isFinite(next) ? Number(next.toFixed(2)) : 0
}

function normalizeCurrency(value: unknown) {
  return String(value || "INR").toUpperCase()
}

function idsMatch(expected: unknown, actual: unknown) {
  const a = String(expected || "").trim()
  const b = String(actual || "").trim()
  return !a || !b || a === b
}

function finalizerLogMetadata(input: {
  paymentAttempt?: any | null
  payment?: any | null
  invoiceId?: string | null
  orderId?: string | null
  result?: Record<string, unknown>
  webhookEventId?: string | null
}) {
  return {
    paymentAttemptId: input.paymentAttempt?.id || null,
    paymentId: input.payment?.id || input.paymentAttempt?.paymentId || null,
    invoiceId: input.invoiceId || input.payment?.invoiceId || input.paymentAttempt?.invoiceId || null,
    orderId: input.orderId || input.payment?.orderId || input.paymentAttempt?.orderId || null,
    gateway: input.paymentAttempt?.gateway || input.payment?.gateway || null,
    gatewayOrderId: input.paymentAttempt?.gatewayOrderId || input.payment?.gatewayOrderId || null,
    merchantOrderId: input.paymentAttempt?.merchantOrderId || null,
    customerId: input.payment?.customerId || input.paymentAttempt?.userId || null,
    amount: money(input.paymentAttempt?.amount || input.payment?.gatewayAmount || input.payment?.amount),
    currency: normalizeCurrency(input.paymentAttempt?.currency || input.payment?.currency),
    webhookEventId: input.webhookEventId || null,
    result: input.result || null,
  }
}

export async function finalizePaidOrder(input: {
  orderId: string
  paymentId?: string | null
  invoiceId?: string | null
  actor?: string
  manualVerification?: boolean
  autoProvision?: boolean
  purpose?: string | null
  transactionId?: string | null
}) {
  const actor = input.actor || "system"
  paymentFlowLog("Order lookup started", { orderId: input.orderId, invoiceId: input.invoiceId || null, paymentId: input.paymentId || null, actor })
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: {
      invoices: true,
      payments: { where: { status: { in: ["completed", "paid", "success", "verification_pending"] } }, take: 1 },
      provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      dedicatedService: true,
    },
  })
  if (!order) {
    paymentFlowLog("Order not found", { orderId: input.orderId, invoiceId: input.invoiceId || null, paymentId: input.paymentId || null })
    return { finalized: false, reason: "order_not_found" }
  }
  paymentFlowLog("Order found", { orderId: order.id, orderNumber: order.orderNumber, status: order.status, provisioningStatus: order.provisioningStatus })

  const nextOrderStatus = input.manualVerification ? "verification_pending" : "paid"
  const invoice = input.invoiceId
    ? await prisma.invoice.findUnique({ where: { id: input.invoiceId } })
    : order.invoices || await createInvoiceForOrder(order.id, input.paymentId ? { paymentId: input.paymentId } : undefined).catch(() => null)

  await prisma.$transaction(async (tx) => {
    const paidAt = new Date()
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: nextOrderStatus,
        provisioningError: null,
        metadata: {
          ...record(order.metadata),
          paymentProcessed: !input.manualVerification,
          paymentProcessedAt: input.manualVerification ? null : paidAt.toISOString(),
          paymentVerification: {
            verified: !input.manualVerification,
            paymentId: input.paymentId || null,
            transactionId: input.transactionId || null,
            actor,
            verifiedAt: input.manualVerification ? null : paidAt.toISOString(),
          },
        },
      },
    })
    if (input.paymentId) {
      await tx.payment.update({
        where: { id: input.paymentId },
        data: {
          status: input.manualVerification ? "verification_pending" : "completed",
          completedAt: paidAt,
          webhookProcessedAt: paidAt,
          ...(input.transactionId ? { transactionId: input.transactionId, gatewayTransactionId: input.transactionId } : {}),
        },
      }).catch(() => undefined)
    }
    if (invoice) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paidAt: invoice.paidAt || paidAt,
          ...(input.transactionId ? { paymentTransactionId: input.transactionId } : {}),
          metadata: {
            ...((invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)) ? invoice.metadata as Record<string, unknown> : {}),
            paymentId: input.paymentId || null,
            paidBy: actor,
          },
        },
      }).catch(() => undefined)
    }
  })
  paymentFlowLog("Order updated", { orderId: order.id, nextOrderStatus, invoiceId: invoice?.id || null, paymentId: input.paymentId || null })

  if (!input.manualVerification && isBillableOrder(order)) {
    const settlement = await settleBillableOrderAfterPayment({
      order,
      paymentId: input.paymentId || null,
      invoiceId: invoice?.id || null,
      actor,
    }).catch((error) => {
      paymentFlowError("Billable order settlement failed", error, { orderId: order.id, invoiceId: invoice?.id || null, paymentId: input.paymentId || null })
      return { settled: false, reason: "settlement_failed", error: error?.message || String(error) }
    })
    paymentFlowLog("Billable order settled", { orderId: order.id, kind: orderKind(order) || null, settlement })
    await createPanelLog({
      category: "Payment",
      message: settlement?.settled ? "billable_order_paid" : "billable_order_settlement_failed",
      level: settlement?.settled ? "info" : "error",
      customerId: order.customerId,
      orderId: order.id,
      paymentId: input.paymentId || null,
      metadata: { kind: orderKind(order) || null, invoiceId: invoice?.id || null, actor, settlement },
    }).catch(() => null)
    return { finalized: true, billable: true, queued: false, settled: Boolean(settlement?.settled), settlementReason: settlement?.reason || null, invoiceId: invoice?.id || null }
  }

  const upgradeOrder = isUpgradeOrder(order, input.purpose)

  if (upgradeOrder) {
    await createPanelLog({
      category: "Payment",
      message: "upgrade_payment_completed",
      customerId: order.customerId,
      orderId: order.id,
      paymentId: input.paymentId || null,
      metadata: { actor, invoiceId: invoice?.id || null, transactionId: input.transactionId || null },
    }).catch(() => null)
  }

  if (String(order.orderType || "").toLowerCase() === "dedicated") {
    await markDedicatedPaymentConfirmed(order.id, actor).catch(() => undefined)
    return { finalized: true, dedicated: true, invoiceId: invoice?.id || null }
  }

  if (input.manualVerification || input.autoProvision === false) {
    return { finalized: true, queued: false, invoiceId: invoice?.id || null }
  }

  const existingActiveJob = order.provisioningJobs.find((job) => ["queued", "running", "completed"].includes(String(job.status || "").toLowerCase()))
  if (existingActiveJob) {
    paymentFlowLog("Provision job already exists", { orderId: order.id, jobId: existingActiveJob.id, jobStatus: existingActiveJob.status })
    return { finalized: true, queued: false, existingJobId: existingActiveJob.id, invoiceId: invoice?.id || null }
  }

  const purpose = String(input.purpose || "").toLowerCase()
  let job: any = null
  try {
    job = upgradeOrder
      ? await enqueueUpgradeJob(order.id, actor)
      : await enqueueProvisioningJob(order.id, actor)
    paymentFlowLog("Provision job queued", { orderId: order.id, jobId: job?.id || null, type: upgradeOrder ? "upgrade" : "provision", purpose })
  } catch (error) {
    paymentFlowError("Provision job queue failed", error, { orderId: order.id, invoiceId: invoice?.id || null, paymentId: input.paymentId || null, purpose })
    await createPanelLog({
      category: "Provisioning",
      level: "error",
      message: "paid_order_provisioning_enqueue_failed",
      customerId: order.customerId,
      orderId: order.id,
      paymentId: input.paymentId || null,
      metadata: { actor, purpose: input.purpose || null, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null },
    }).catch(() => null)
    return { finalized: false, queued: false, reason: "provision_enqueue_failed", error: error instanceof Error ? error.message : String(error), invoiceId: invoice?.id || null }
  }
  await createPanelLog({
    category: "Provisioning",
    message: job ? "paid_order_provisioning_queued" : "paid_order_provisioning_enqueue_failed",
    customerId: order.customerId,
    orderId: order.id,
    paymentId: input.paymentId || null,
    metadata: { actor, purpose: input.purpose || null, jobId: job?.id || null },
  }).catch(() => null)
  return { finalized: true, queued: Boolean(job), jobId: job?.id || null, invoiceId: invoice?.id || null }
}

export type FinalizeSuccessfulPaymentResult = {
  finalized: boolean
  reason?: string
  paymentStatus?: string
  invoiceStatus?: string | null
  orderId?: string | null
  invoiceId?: string | null
  serviceId?: string | null
  vpsInstanceId?: string | null
  dedicatedServiceId?: string | null
  provisioningJobId?: string | null
  repaired?: boolean
  reused?: boolean
  mismatch?: {
    expectedAmount?: number
    incomingAmount?: number
    expectedCurrency?: string
    incomingCurrency?: string
  }
}

export async function finalizeSuccessfulPayment(paymentAttemptId: string, options: {
  actor?: string
  amount?: number | string | null
  currency?: string | null
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  gatewayTransactionId?: string | null
  merchantOrderId?: string | null
  bankReferenceId?: string | null
  paymentMethod?: string | null
  gatewayResponse?: unknown
  webhookEventId?: string | null
  manualVerification?: boolean
  autoProvision?: boolean
} = {}): Promise<FinalizeSuccessfulPaymentResult> {
  return withRedisLock(`payment-processing-lock:${paymentAttemptId}`, 20000, async () => {
  const actor = options.actor || "system"
  const now = new Date()
  paymentFlowLog("Finalization started", { paymentAttemptId, actor, gatewayOrderId: options.gatewayOrderId || null, gatewayPaymentId: options.gatewayPaymentId || null })

  const prepared = await prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.findUnique({
      where: { id: paymentAttemptId },
      include: {
        payment: { include: { checkoutIntent: true, checkoutSession: true, invoice: true, order: true } },
        invoice: true,
        order: true,
      },
    })
    if (!attempt) return { ok: false as const, result: { finalized: false, reason: "payment_attempt_not_found" } }

    const payment = attempt.payment
    if (!payment) return { ok: false as const, attempt, result: { finalized: false, reason: "payment_not_found" } }
    paymentFlowLog("Payment record found", { paymentAttemptId: attempt.id, paymentId: payment.id, invoiceId: payment.invoiceId || attempt.invoiceId || null, orderId: payment.orderId || attempt.orderId || null, gateway: attempt.gateway })

    const expectedAmount = money(attempt.amount || payment.gatewayAmount || payment.amount)
    const incomingAmount = options.amount === undefined || options.amount === null ? expectedAmount : money(options.amount)
    const expectedCurrency = normalizeCurrency(attempt.currency || payment.currency)
    const incomingCurrency = normalizeCurrency(options.currency || expectedCurrency)
    // Compare in INR minor units (₹1.18 === 118 paise) to avoid float drift.
    const inrMinor = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100)
    if (inrMinor(incomingAmount) !== inrMinor(expectedAmount) || incomingCurrency !== expectedCurrency) {
      const result = {
        finalized: false,
        reason: "amount_or_currency_mismatch",
        mismatch: { expectedAmount, incomingAmount, expectedCurrency, incomingCurrency },
      }
      return { ok: false as const, attempt, payment, result }
    }

    if (!idsMatch(attempt.merchantOrderId, options.merchantOrderId) || !idsMatch(attempt.gatewayOrderId || payment.gatewayOrderId, options.gatewayOrderId)) {
      const result = { finalized: false, reason: "gateway_order_mismatch" }
      return { ok: false as const, attempt, payment, result }
    }

    const invoice = payment.invoice || attempt.invoice
    const order = payment.order || attempt.order
    const checkoutIntent = payment.checkoutIntent
    const checkoutSession = payment.checkoutSession
    const invoiceWasPaid = String(invoice?.status || "").toLowerCase() === "paid"
    const paymentWasPaid = isPaidPaymentStatus(payment.status)
    const orderWasFulfilled = Boolean(order?.id || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId)

    const transactionId = options.gatewayTransactionId || options.gatewayPaymentId || payment.gatewayTransactionId || payment.transactionId || null
    await tx.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: options.manualVerification ? "verification_pending" : "success",
        gatewayOrderId: options.gatewayOrderId || attempt.gatewayOrderId || payment.gatewayOrderId,
        gatewayPaymentId: options.gatewayPaymentId || attempt.gatewayPaymentId,
        gatewayTransactionId: transactionId || attempt.gatewayTransactionId,
        bankReferenceId: options.bankReferenceId || attempt.bankReferenceId,
        utr: options.bankReferenceId || attempt.utr,
        webhookVerifiedAt: attempt.webhookVerifiedAt || now,
        statusCheckedAt: now,
        rawGatewayResponse: (options.gatewayResponse ?? attempt.rawGatewayResponse) as any,
        failureCode: null,
        failureMessage: null,
      },
    })
    paymentFlowLog("Payment attempt updated", { paymentAttemptId: attempt.id, status: options.manualVerification ? "verification_pending" : "success" })

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: options.manualVerification ? "verification_pending" : "completed",
        gatewayOrderId: options.gatewayOrderId || payment.gatewayOrderId || attempt.gatewayOrderId,
        gatewayPaymentId: options.gatewayPaymentId || payment.gatewayPaymentId || attempt.gatewayPaymentId,
        gatewayTransactionId: transactionId || payment.gatewayTransactionId,
        transactionId: transactionId || payment.transactionId,
        paymentMethod: options.paymentMethod || payment.paymentMethod,
        gatewayResponse: (options.gatewayResponse ?? payment.gatewayResponse) as any,
        errorMessage: null,
        completedAt: payment.completedAt || now,
        webhookProcessedAt: payment.webhookProcessedAt || now,
        invoiceId: payment.invoiceId || attempt.invoiceId || null,
        orderId: payment.orderId || attempt.orderId || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId || null,
      },
    })
    paymentFlowLog("Payment record updated", { paymentId: payment.id, status: options.manualVerification ? "verification_pending" : "completed", invoiceId: payment.invoiceId || attempt.invoiceId || null, orderId: payment.orderId || attempt.orderId || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId || null })

    await tx.paymentTransaction.upsert({
      where: { merchantOrderId: attempt.merchantOrderId },
      create: {
        paymentId: payment.id,
        orderId: payment.orderId || attempt.orderId || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId || null,
        invoiceId: payment.invoiceId || attempt.invoiceId || null,
        customerId: payment.customerId || attempt.userId || null,
        gateway: attempt.gateway,
        merchantOrderId: attempt.merchantOrderId,
        gatewayOrderId: options.gatewayOrderId || attempt.gatewayOrderId || payment.gatewayOrderId || null,
        gatewayPaymentId: options.gatewayPaymentId || attempt.gatewayPaymentId || payment.gatewayPaymentId || null,
        gatewayTransactionId: transactionId,
        amount: incomingAmount,
        currency: incomingCurrency,
        status: options.manualVerification ? "verification_pending" : "success",
        rawGatewayResponse: options.gatewayResponse as any,
      },
      update: {
        paymentId: payment.id,
        orderId: payment.orderId || attempt.orderId || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId || null,
        invoiceId: payment.invoiceId || attempt.invoiceId || null,
        customerId: payment.customerId || attempt.userId || null,
        gatewayOrderId: options.gatewayOrderId || attempt.gatewayOrderId || payment.gatewayOrderId || null,
        gatewayPaymentId: options.gatewayPaymentId || attempt.gatewayPaymentId || payment.gatewayPaymentId || null,
        gatewayTransactionId: transactionId,
        amount: incomingAmount,
        currency: incomingCurrency,
        status: options.manualVerification ? "verification_pending" : "success",
        rawGatewayResponse: options.gatewayResponse as any,
      },
    }).catch(() => undefined)

    if (invoice) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paidAt: invoice.paidAt || now,
          paymentTransactionId: transactionId || invoice.paymentTransactionId,
          metadata: {
            ...record(invoice.metadata),
            gateway: attempt.gateway,
            gatewayOrderId: options.gatewayOrderId || attempt.gatewayOrderId || payment.gatewayOrderId || null,
            gatewayPaymentId: options.gatewayPaymentId || attempt.gatewayPaymentId || payment.gatewayPaymentId || null,
            gatewayTransactionId: transactionId,
            bankReferenceId: options.bankReferenceId || null,
            paidBy: actor,
            paymentAttemptId: attempt.id,
            paymentId: payment.id,
          },
        },
      })
      paymentFlowLog("Invoice updated", { invoiceId: invoice.id, status: "paid", orderId: invoice.orderId || null, paymentId: payment.id })
    }

    await enqueuePaymentOutbox(tx, {
      eventType: "payment_captured",
      aggregateType: "payment",
      aggregateId: payment.id,
      idempotencyKey: `payment-captured:${payment.id}`,
      payload: {
        paymentId: payment.id,
        paymentAttemptId: attempt.id,
        invoiceId: invoice?.id || payment.invoiceId || attempt.invoiceId || null,
        orderId: order?.id || payment.orderId || attempt.orderId || null,
        customerId: payment.customerId || attempt.userId || null,
        amount: incomingAmount,
        currency: incomingCurrency,
        taxAmount: Number(invoice?.taxAmount || 0),
        actor,
      },
    })

    return {
      ok: true as const,
      attempt,
      payment,
      invoiceId: invoice?.id || payment.invoiceId || attempt.invoiceId || null,
      orderId: order?.id || payment.orderId || attempt.orderId || checkoutSession?.fulfilledOrderId || checkoutIntent?.fulfilledOrderId || null,
      checkoutSessionId: checkoutSession?.id || null,
      checkoutIntentId: checkoutIntent?.id || null,
      purpose: payment.purpose,
      transactionId,
      wasComplete: paymentWasPaid && invoiceWasPaid && orderWasFulfilled,
      repaired: !paymentWasPaid || !invoiceWasPaid || !orderWasFulfilled,
    }
  }, { isolationLevel: "Serializable" })

  if (!prepared.ok) {
    await createPanelLog({
      category: "Payment",
      level: prepared.result.reason === "amount_or_currency_mismatch" ? "error" : "warn",
      message: prepared.result.reason === "amount_or_currency_mismatch" ? "payment_finalize_amount_mismatch" : "payment_finalize_rejected",
      customerId: prepared.payment?.customerId || prepared.attempt?.userId || null,
      orderId: prepared.payment?.orderId || prepared.attempt?.orderId || null,
      paymentId: prepared.payment?.id || prepared.attempt?.paymentId || null,
      metadata: finalizerLogMetadata({
        paymentAttempt: prepared.attempt,
        payment: prepared.payment,
        result: prepared.result as Record<string, unknown>,
        webhookEventId: options.webhookEventId || null,
      }),
    }).catch(() => null)
    return prepared.result
  }

  if (isWalletTopupPurpose(prepared.purpose)) {
    const wallet = await finalizeWalletTopupPayment({
      paymentAttemptId: prepared.attempt.id,
      paymentId: prepared.payment.id,
      paidAmount: money(options.amount || prepared.payment.gatewayAmount || prepared.payment.amount),
      currency: normalizeCurrency(options.currency || prepared.payment.currency),
      merchantOrderId: options.merchantOrderId || prepared.attempt.merchantOrderId || null,
      gatewayOrderId: options.gatewayOrderId || prepared.attempt.gatewayOrderId || prepared.payment.gatewayOrderId || null,
      customerId: prepared.payment.customerId || prepared.attempt.userId || null,
      gatewayPaymentId: options.gatewayPaymentId || prepared.payment.gatewayPaymentId || null,
      gatewayTransactionId: options.gatewayTransactionId || prepared.payment.gatewayTransactionId || null,
      bankReferenceId: options.bankReferenceId || null,
      paymentMethod: options.paymentMethod || prepared.payment.paymentMethod || null,
      gatewayResponse: options.gatewayResponse as any,
      actor,
    })
    const result = {
      finalized: true,
      paymentStatus: "completed",
      invoiceStatus: "paid",
      invoiceId: prepared.invoiceId,
      orderId: null,
      serviceId: null,
      provisioningJobId: null,
      repaired: prepared.repaired || Boolean(wallet.reused === false),
      reused: Boolean(wallet.reused),
    }
    await createPanelLog({
      category: "Payment",
      message: "payment_finalize_success",
      customerId: prepared.payment.customerId || prepared.attempt.userId || null,
      paymentId: prepared.payment.id,
      metadata: finalizerLogMetadata({ paymentAttempt: prepared.attempt, payment: prepared.payment, invoiceId: result.invoiceId, result, webhookEventId: options.webhookEventId || null }),
    }).catch(() => null)
    return result
  }

  let orderId = prepared.orderId || null
  let provisioningJobId: string | null = null
  let reused = Boolean(prepared.wasComplete)

  const fulfillCheckoutSessionForPayment = async (checkoutSessionId: string, source: string) => {
    const { fulfillCheckoutSession } = await import("@/lib/checkout-sessions")
    paymentFlowLog("Checkout session fulfillment started", {
      checkoutSessionId,
      source,
      paymentId: prepared.payment.id,
      invoiceId: prepared.invoiceId || null,
      paymentAttemptId: prepared.attempt.id,
    })
    const fulfilled = await fulfillCheckoutSession({
      checkoutSessionId,
      paymentId: prepared.payment.id,
      actor,
      manualVerification: options.manualVerification,
      autoProvision: options.autoProvision,
      transactionId: prepared.transactionId,
    })
    if ((fulfilled as any).fulfilled) {
      paymentFlowLog("Checkout session fulfilled", {
        checkoutSessionId,
        source,
        orderId: (fulfilled as any).orderId || null,
        jobId: (fulfilled as any).finalized?.jobId || (fulfilled as any).finalized?.existingJobId || null,
      })
    } else {
      paymentFlowLog("Checkout session fulfillment failed", {
        checkoutSessionId,
        source,
        reason: (fulfilled as any).reason || "unknown",
        invoiceId: prepared.invoiceId || null,
      })
    }
    return fulfilled as any
  }

  if (prepared.checkoutSessionId && !orderId) {
    let fulfilled = await fulfillCheckoutSessionForPayment(prepared.checkoutSessionId, "payment_checkout_session")
    if (!fulfilled.fulfilled && prepared.invoiceId) {
      const fallbackSession = await findRecoverableOrderCheckoutSession({
        invoiceId: prepared.invoiceId,
        currentCheckoutSessionId: prepared.checkoutSessionId,
      })
      if (fallbackSession?.id) {
        paymentFlowLog("Recovered original order checkout session", {
          invoiceId: prepared.invoiceId,
          detachedCheckoutSessionId: prepared.checkoutSessionId,
          recoveredCheckoutSessionId: fallbackSession.id,
          referenceId: fallbackSession.referenceId,
        })
        fulfilled = await fulfillCheckoutSessionForPayment(fallbackSession.id, "invoice_original_order_session")
        if (fulfilled.fulfilled) {
          await prisma.checkoutSession.update({
            where: { id: prepared.checkoutSessionId },
            data: {
              status: options.manualVerification ? "verification_pending" : "fulfilled",
              fulfilledOrderId: fulfilled.orderId || null,
              paidAt: new Date(),
              fulfilledAt: new Date(),
              snapshot: {
                ...record((await prisma.checkoutSession.findUnique({ where: { id: prepared.checkoutSessionId }, select: { snapshot: true } }).catch(() => null))?.snapshot),
                recoveredOrderCheckoutSessionId: fallbackSession.id,
                primaryOrderId: fulfilled.orderId || null,
              },
            },
          }).catch((error) => {
            paymentFlowError("Detached checkout session status update failed", error, { checkoutSessionId: prepared.checkoutSessionId, recoveredCheckoutSessionId: fallbackSession.id })
          })
        }
      }
    }
    if (!fulfilled.fulfilled) {
      const result = { finalized: false, reason: fulfilled.reason || "checkout_session_fulfillment_failed", invoiceId: prepared.invoiceId, orderId: null }
      await createPanelLog({
        category: "Payment",
        level: "error",
        message: "payment_finalize_checkout_fulfillment_failed",
        customerId: prepared.payment.customerId || prepared.attempt.userId || null,
        paymentId: prepared.payment.id,
        metadata: finalizerLogMetadata({ paymentAttempt: prepared.attempt, payment: prepared.payment, invoiceId: prepared.invoiceId, result, webhookEventId: options.webhookEventId || null }),
      }).catch(() => null)
      return result
    }
    orderId = fulfilled.orderId || orderId
    reused = Boolean(fulfilled.reused)
    provisioningJobId = fulfilled.finalized?.jobId || fulfilled.finalized?.existingJobId || null
    if (fulfilled.finalized && !fulfilled.finalized.finalized) {
      return {
        ...fulfilled.finalized,
        invoiceId: fulfilled.finalized.invoiceId || prepared.invoiceId,
        orderId: fulfilled.orderId || orderId || null,
      }
    }
  } else if (prepared.checkoutIntentId && !orderId) {
    const { fulfillCheckoutIntent } = await import("@/lib/checkout-intents")
    const fulfilled = await fulfillCheckoutIntent({
      checkoutIntentId: prepared.checkoutIntentId,
      paymentId: prepared.payment.id,
      invoiceId: prepared.invoiceId,
      actor,
      manualVerification: options.manualVerification,
      autoProvision: options.autoProvision,
      transactionId: prepared.transactionId,
    })
    orderId = fulfilled.orderId || orderId
    reused = Boolean(fulfilled.reused)
    provisioningJobId = fulfilled.finalized?.jobId || fulfilled.finalized?.existingJobId || null
  } else if (prepared.invoiceId) {
    const finalized = await handlePaidInvoice(prepared.invoiceId, {
      paymentId: prepared.payment.id,
      actor,
      manualVerification: options.manualVerification,
      autoProvision: options.autoProvision,
      purpose: prepared.purpose,
      transactionId: prepared.transactionId,
    })
    let finalizedViaFallback = false
    if (!(finalized as any).finalized) {
      const fallbackSession = await findRecoverableOrderCheckoutSession({
        invoiceId: prepared.invoiceId,
        currentCheckoutSessionId: prepared.checkoutSessionId,
      })
      if (fallbackSession?.id) {
        const fulfilled = await fulfillCheckoutSessionForPayment(fallbackSession.id, "invoice_original_order_session")
        if (fulfilled.fulfilled) {
          orderId = fulfilled.orderId || orderId
          provisioningJobId = fulfilled.finalized?.jobId || fulfilled.finalized?.existingJobId || null
          reused = reused || Boolean(fulfilled.reused)
          finalizedViaFallback = true
        } else {
          return { finalized: false, reason: fulfilled.reason || "checkout_session_fulfillment_failed", invoiceId: prepared.invoiceId, orderId: null }
        }
      } else {
        return {
          ...(finalized as any),
          invoiceId: (finalized as any).invoiceId || prepared.invoiceId,
          orderId: (finalized as any).orderId || orderId || null,
        }
      }
    }
    if (!finalizedViaFallback) {
      orderId = (finalized as any).orderId || orderId
      provisioningJobId = (finalized as any).jobId || (finalized as any).existingJobId || null
      reused = reused || Boolean((finalized as any).existingJobId)
    }
  } else if (orderId) {
    const finalized = await finalizePaidOrder({
      orderId,
      paymentId: prepared.payment.id,
      actor,
      manualVerification: options.manualVerification,
      autoProvision: options.autoProvision,
      purpose: prepared.purpose,
      transactionId: prepared.transactionId,
    })
    if (!(finalized as any).finalized) return finalized as any
    provisioningJobId = (finalized as any).jobId || (finalized as any).existingJobId || null
    reused = reused || Boolean((finalized as any).existingJobId)
  }

  if (orderId) {
    await prisma.payment.update({ where: { id: prepared.payment.id }, data: { orderId, invoiceId: prepared.invoiceId || undefined } }).catch(() => undefined)
    await prisma.paymentAttempt.update({ where: { id: prepared.attempt.id }, data: { orderId, invoiceId: prepared.invoiceId || undefined } }).catch(() => undefined)
    await prisma.paymentTransaction.update({
      where: { merchantOrderId: prepared.attempt.merchantOrderId },
      data: { orderId, invoiceId: prepared.invoiceId || undefined },
    }).catch(() => undefined)
    if (prepared.invoiceId) {
      await prisma.invoice.update({
        where: { id: prepared.invoiceId },
        data: { orderId },
      }).catch(() => undefined)
    }
  }

  const order = orderId
    ? await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          invoices: true,
          vpsInstance: true,
          dedicatedService: true,
          provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }).catch(() => null)
    : null
  const invoice = prepared.invoiceId ? await prisma.invoice.findUnique({ where: { id: prepared.invoiceId } }).catch(() => null) : order?.invoices || null
  const invoiceMetadata = record(invoice?.metadata)
  const requiresOrderForService = Boolean(
    prepared.purpose !== "invoice_payment" ||
    invoiceMetadata.pendingOrderSnapshot ||
    invoiceMetadata.checkoutSessionId ||
    invoiceMetadata.orderNumber ||
    invoiceMetadata.productId
  )
  if (!orderId && requiresOrderForService) {
    const result = {
      finalized: false,
      reason: "order_not_linked_after_payment",
      paymentStatus: options.manualVerification ? "verification_pending" : "completed",
      invoiceStatus: invoice?.status || null,
      orderId: null,
      invoiceId: prepared.invoiceId || invoice?.id || null,
      provisioningJobId: null,
    }
    paymentFlowLog("Order link missing after payment finalization", { paymentId: prepared.payment.id, paymentAttemptId: prepared.attempt.id, invoiceId: result.invoiceId, purpose: prepared.purpose })
    await createPanelLog({
      category: "Payment",
      level: "error",
      message: "payment_finalize_order_link_missing",
      customerId: prepared.payment.customerId || prepared.attempt.userId || null,
      paymentId: prepared.payment.id,
      metadata: finalizerLogMetadata({ paymentAttempt: prepared.attempt, payment: prepared.payment, invoiceId: result.invoiceId, result, webhookEventId: options.webhookEventId || null }),
    }).catch(() => null)
    return result
  }
  const serviceId = order?.vpsInstance?.id || order?.dedicatedService?.id || null
  provisioningJobId = provisioningJobId || order?.provisioningJobs?.[0]?.id || null
  const result: FinalizeSuccessfulPaymentResult = {
    finalized: true,
    paymentStatus: options.manualVerification ? "verification_pending" : "completed",
    invoiceStatus: invoice?.status || null,
    orderId,
    invoiceId: prepared.invoiceId || invoice?.id || null,
    serviceId,
    vpsInstanceId: order?.vpsInstance?.id || null,
    dedicatedServiceId: order?.dedicatedService?.id || null,
    provisioningJobId,
    repaired: prepared.repaired || !prepared.wasComplete,
    reused,
  }

  if (orderId && result.invoiceId && result.invoiceId !== prepared.invoiceId) {
    await Promise.all([
      prisma.payment.update({ where: { id: prepared.payment.id }, data: { invoiceId: result.invoiceId } }),
      prisma.paymentAttempt.update({ where: { id: prepared.attempt.id }, data: { invoiceId: result.invoiceId } }),
      prisma.paymentTransaction.update({
        where: { merchantOrderId: prepared.attempt.merchantOrderId },
        data: { invoiceId: result.invoiceId },
      }),
    ]).catch(() => undefined)
  }

  await createPanelLog({
    category: "Payment",
    message: "payment_finalize_success",
    customerId: prepared.payment.customerId || prepared.attempt.userId || null,
    orderId,
    paymentId: prepared.payment.id,
    metadata: finalizerLogMetadata({ paymentAttempt: prepared.attempt, payment: prepared.payment, invoiceId: result.invoiceId, orderId, result, webhookEventId: options.webhookEventId || null }),
  }).catch(() => null)

  if (!prepared.wasComplete && orderId) {
    // Send a single consolidated notification (email + WhatsApp) — removes duplicate order_paid and invoice_paid sends
    await sendOrderInvoiceNotification({
      templateKey: "payment_success",
      orderId,
      invoiceId: result.invoiceId,
      metadata: { source: "payment_finalizer", paymentId: prepared.payment.id, paymentAttemptId: prepared.attempt.id },
    }).catch((error) => {
      console.error("[Payments][Finalize] success notification failed", { orderId, paymentAttemptId: prepared.attempt.id, message: (error as any)?.message })
    })
  }

  return result
  })
}

export async function handlePaidInvoice(invoiceId: string, input: {
  paymentId?: string | null
  actor?: string
  manualVerification?: boolean
  autoProvision?: boolean
  purpose?: string | null
  transactionId?: string | null
} = {}) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      payments: { orderBy: { createdAt: "desc" } },
      order: {
        include: {
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  })
  if (!invoice) return { finalized: false, reason: "invoice_not_found" }

  const invoiceMetadata = record(invoice.metadata)
  const invoicePayment = input.paymentId
    ? invoice.payments.find((entry) => entry.id === input.paymentId) || null
    : invoice.payments.find((entry) => isPaidPaymentStatus(entry.status)) || invoice.payments[0] || null
  const invoicePurpose = input.purpose || invoicePayment?.purpose || invoiceMetadata.paymentPurpose || invoiceMetadata.invoiceType || null
  if (isWalletTopupPurpose(invoicePurpose)) {
    if (!invoicePayment) return { finalized: false, reason: "wallet_topup_payment_not_found" }
    const topupAttempt = await prisma.paymentAttempt.findFirst({
      where: { paymentId: invoicePayment.id },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
    return finalizeWalletTopupPayment({
      paymentAttemptId: topupAttempt?.id || null,
      paymentId: invoicePayment.id,
      paidAmount: Number(invoicePayment.gatewayAmount || invoicePayment.amount || invoice.totalAmount || 0),
      currency: invoicePayment.currency || invoice.currency,
      merchantOrderId: topupAttempt?.merchantOrderId || invoicePayment.topupReference || null,
      gatewayOrderId: topupAttempt?.gatewayOrderId || invoicePayment.gatewayOrderId || null,
      customerId: invoicePayment.customerId || null,
      gatewayPaymentId: invoicePayment.gatewayPaymentId || null,
      gatewayTransactionId: input.transactionId || invoicePayment.gatewayTransactionId || invoicePayment.transactionId || invoice.paymentTransactionId || null,
      paymentMethod: invoicePayment.paymentMethod || null,
      gatewayResponse: invoicePayment.gatewayResponse,
      actor: input.actor || "invoice_paid",
    })
  }

  if (!invoice.orderId || !invoice.order) {
    return { finalized: false, reason: "invoice_order_not_found" }
  }
  const payment = input.paymentId
    ? invoice.order.payments.find((entry) => entry.id === input.paymentId) || null
    : invoice.order.payments[0] || null
  const inferredPurpose = isUpgradeOrder(invoice.order, payment?.purpose)
    ? "upgrade_order"
    : payment?.purpose || "order_payment"
  return finalizePaidOrder({
    orderId: invoice.orderId,
    paymentId: input.paymentId || payment?.id || null,
    invoiceId,
    actor: input.actor || "invoice_paid",
    manualVerification: input.manualVerification,
    autoProvision: input.autoProvision,
    purpose: input.purpose || inferredPurpose,
    transactionId: input.transactionId || payment?.gatewayTransactionId || payment?.transactionId || invoice.paymentTransactionId || null,
  })
}

export async function handleInvoicePaid(invoiceId: string, input: Parameters<typeof handlePaidInvoice>[1] = {}) {
  return handlePaidInvoice(invoiceId, input)
}

export async function finalizeManualInvoicePayment(input: {
  invoiceId: string
  actorEmail: string
  reason?: string | null
  autoProvision?: boolean
}) {
  const actorEmail = String(input.actorEmail || "").trim().toLowerCase()
  const reason = String(input.reason || "").trim() || "Marked paid by admin"
  const actor = `admin:${actorEmail || "unknown"}`

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: {
      order: true,
      payments: {
        orderBy: { createdAt: "desc" },
        include: {
          checkoutIntent: true,
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  })
  if (!invoice) return { finalized: false, reason: "invoice_not_found" as const }

  const invoiceMeta = record(invoice.metadata)
  const directAttempt = invoice.paymentAttempts[0] || null
  const paymentWithAttempt = invoice.payments.find((payment) => payment.paymentAttempts?.length) || null
  const payment = invoice.payments[0] || null
  const selectedAttempt = directAttempt || paymentWithAttempt?.paymentAttempts?.[0] || null
  const selectedPayment = paymentWithAttempt || payment
  let finalization: any = null

  if (selectedAttempt) {
    finalization = await finalizeSuccessfulPayment(selectedAttempt.id, {
      actor,
      amount: Number(selectedAttempt.amount || selectedPayment?.gatewayAmount || selectedPayment?.amount || invoice.totalAmount || 0),
      currency: selectedAttempt.currency || selectedPayment?.currency || invoice.currency,
      gatewayOrderId: selectedAttempt.gatewayOrderId || selectedPayment?.gatewayOrderId || null,
      gatewayPaymentId: selectedAttempt.gatewayPaymentId || selectedPayment?.gatewayPaymentId || null,
      gatewayTransactionId: selectedAttempt.gatewayTransactionId || selectedPayment?.gatewayTransactionId || selectedPayment?.transactionId || null,
      merchantOrderId: selectedAttempt.merchantOrderId || null,
      bankReferenceId: selectedAttempt.bankReferenceId || null,
      paymentMethod: selectedPayment?.paymentMethod || null,
      manualVerification: false,
      autoProvision: input.autoProvision !== false,
    })
  } else if (selectedPayment) {
    finalization = await handleInvoicePaid(invoice.id, {
      paymentId: selectedPayment.id,
      actor,
      manualVerification: false,
      autoProvision: input.autoProvision !== false,
      purpose: selectedPayment.purpose || invoiceMeta.paymentPurpose || invoiceMeta.invoiceType || null,
      transactionId: selectedPayment.gatewayTransactionId || selectedPayment.transactionId || invoice.paymentTransactionId || null,
    })
  } else {
    return {
      finalized: false as const,
      reason: "manual_payment_reference_missing" as const,
      invoiceId: invoice.id,
      orderId: invoice.orderId || null,
      walletTopup: isWalletTopupPurpose(invoiceMeta.paymentPurpose || invoiceMeta.invoiceType || null),
    }
  }

  if (!finalization?.finalized) {
    return {
      ...finalization,
      invoiceId: finalization?.invoiceId || invoice.id,
      orderId: finalization?.orderId || invoice.orderId || null,
    }
  }

  const now = new Date()
  const refreshed = await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      manualProcessedBy: actorEmail || null,
      manualProcessedAt: now,
      manualReason: reason,
      metadata: {
        ...invoiceMeta,
        manualPaidReason: reason,
        manualPaidBy: actorEmail || null,
        manualProcessedAt: now.toISOString(),
      },
    },
    include: {
      order: { include: { provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 }, vpsInstance: true, dedicatedService: true } },
      payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })

  const latestPayment = refreshed.payments[0] || null
  const latestAttempt = refreshed.paymentAttempts[0] || latestPayment?.paymentAttempts?.[0] || null

  return {
    ...finalization,
    finalized: true,
    invoiceId: refreshed.id,
    invoiceStatus: refreshed.status,
    orderId: finalization?.orderId || refreshed.orderId || null,
    paymentId: latestPayment?.id || selectedPayment?.id || null,
    paymentStatus: latestPayment?.status || finalization?.paymentStatus || null,
    paymentAttemptId: latestAttempt?.id || selectedAttempt?.id || null,
    paymentAttemptStatus: latestAttempt?.status || null,
    serviceId: refreshed.order?.vpsInstance?.id || refreshed.order?.dedicatedService?.id || null,
    provisioningJobId: finalization?.provisioningJobId || refreshed.order?.provisioningJobs?.[0]?.id || null,
    walletTopup: Boolean(latestPayment && isWalletTopupPurpose(latestPayment.purpose || invoiceMeta.paymentPurpose || invoiceMeta.invoiceType || null)),
    manualProcessedBy: refreshed.manualProcessedBy || null,
    manualProcessedAt: refreshed.manualProcessedAt?.toISOString() || null,
    manualReason: refreshed.manualReason || null,
  }
}
