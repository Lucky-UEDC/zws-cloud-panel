import { prisma } from "@/lib/db"
import { getPaymentStatus, getOrderPayments } from "@/lib/cashfree"
import { getPhonePePaymentStatus } from "@/lib/phonepe"
import { createInvoiceForOrder } from "@/lib/invoices"
import { getSetting, type PaymentSettings } from "@/lib/settings"
import { recordGatewayAttempt, safeGatewayError } from "@/lib/payment-attempts"
import { gatewayCredentials, gatewayMode } from "@/lib/payment-gateways"
import { fallbackGatewayConfig } from "@/lib/payments/payment-gateway-admin"
import { markDedicatedPaymentConfirmed } from "@/lib/dedicated"
import { finalizePaidOrder, finalizeSuccessfulPayment, handlePaidInvoice } from "@/lib/payment-finalization"
import { fulfillCheckoutIntent } from "@/lib/checkout-intents"
import { finalizeWalletTopupPayment, isWalletTopupPurpose, markWalletTopupPaymentFailed } from "@/lib/wallet-topup"

export type ReconcileResult = {
  reconciled: boolean
  paid: boolean
  failed: boolean
  status: string
  safeMessage?: string
  gatewayOrderIdUsed?: string | null
  attemptedReferences?: string[]
  gatewayHttpStatus?: number | null
  lastGatewayError?: string | null
  rawGatewaySummary?: Record<string, unknown> | null
}

function normalizeGatewayStatus(orderStatus?: string | null, paymentStatus?: string | null) {
  const value = `${orderStatus || ""} ${paymentStatus || ""}`.toUpperCase()
  if (value.includes("PAID") || value.includes("SUCCESS")) return "success"
  if (value.includes("FAILED") || value.includes("CANCELLED")) return "failed"
  if (value.includes("USER_DROPPED")) return "pending"
  return "pending"
}

function paymentMethodFromPayment(payment: any) {
  const method = payment?.payment_method
  if (!method || typeof method !== "object") return payment?.payment_group || null
  if (method.card) return "card"
  if (method.upi) return "upi"
  if (method.netbanking) return "netbanking"
  return payment?.payment_group || "unknown"
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Resolve the gateway config used for server-side reconciliation. Prefers the
 * config linked to the payment attempt; falls back to the enabled
 * payment_gateways row for the same gateway code so provider verification
 * works even before a domain config is linked.
 */
async function resolveReconcileGatewayConfig(gateway: string, prefer?: any): Promise<any> {
  if (prefer) return prefer
  if (String(gateway).toLowerCase() === "phonepe") return fallbackGatewayConfig("phonepe", null)
  if (String(gateway).toLowerCase() === "razorpay") return fallbackGatewayConfig("razorpay", null)
  return fallbackGatewayConfig("cashfree", null)
}

function cashfreeErrorStatus(error: any): number | null {
  const status = Number(error?.response?.status || error?.statusCode || 0)
  return Number.isFinite(status) && status > 0 ? status : null
}

function summarizeCashfreePayment(payment: any) {
  if (!payment) return null
  return {
    cf_payment_id: payment?.cf_payment_id || null,
    payment_status: payment?.payment_status || null,
    payment_amount: payment?.payment_amount || null,
    payment_currency: payment?.payment_currency || null,
    payment_time: payment?.payment_time || null,
    bank_reference: payment?.bank_reference || null,
    payment_group: payment?.payment_group || null,
  }
}

function chooseBestCashfreePayment(payments: any[]) {
  if (!Array.isArray(payments) || !payments.length) return null
  const normalized = payments
    .map((entry) => ({
      entry,
      status: String(entry?.payment_status || "").toUpperCase(),
      at: new Date(entry?.payment_time || entry?.created_at || 0).getTime() || 0,
    }))
    .sort((a, b) => b.at - a.at)

  const success = normalized.find((row) => row.status === "SUCCESS")
  if (success) return success.entry

  const terminal = normalized.find((row) => ["FAILED", "CANCELLED", "USER_DROPPED"].includes(row.status))
  if (terminal) return terminal.entry

  return normalized[0]?.entry || null
}

async function fetchCashfreeOrderAndPaymentsWithRetry(input: {
  references: string[]
  credentials: Record<string, any>
}) {
  const attemptedReferences: string[] = []
  const apiInput = {
    appId: String(input.credentials.appId || input.credentials.clientId || "") || undefined,
    secretKey: String(input.credentials.secretKey || "") || undefined,
    mode: input.credentials.mode as any,
    apiVersion: String(input.credentials.apiVersion || "") || undefined,
  }

  let lastError: any = null
  let lastGatewayHttpStatus: number | null = null

  for (const candidate of input.references) {
    const ref = String(candidate || "").trim()
    if (!ref) continue
    attemptedReferences.push(ref)

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const orderStatus = await getPaymentStatus(ref, apiInput)
        const payments = await getOrderPayments(ref, apiInput).catch(() => [])
        return {
          ok: true as const,
          gatewayOrderIdUsed: ref,
          attemptedReferences,
          orderStatus,
          payments: Array.isArray(payments) ? payments : [],
          gatewayHttpStatus: 200,
          lastGatewayError: null,
        }
      } catch (error: any) {
        lastError = error
        lastGatewayHttpStatus = cashfreeErrorStatus(error)
        if (attempt < 3) await delay(250 * attempt)
      }
    }
  }

  return {
    ok: false as const,
    gatewayOrderIdUsed: attemptedReferences[attemptedReferences.length - 1] || null,
    attemptedReferences,
    orderStatus: null,
    payments: [],
    gatewayHttpStatus: lastGatewayHttpStatus,
    lastGatewayError: lastError?.message || "gateway_lookup_failed",
  }
}

async function reconcileCheckoutIntentPayment(
  payment: any,
  paymentSettings: PaymentSettings,
  orderNumberOrGatewayId: string,
  actor: string,
): Promise<ReconcileResult> {
  const gateway = String(payment.gateway || "cashfree").toLowerCase()
  const gatewayOrderId = payment.gatewayOrderId || payment.checkoutIntent?.referenceId || orderNumberOrGatewayId
  const gatewayConfig = await resolveReconcileGatewayConfig(gateway, payment.paymentAttempts?.[0]?.gatewayConfig)
  const credentials = gatewayCredentials(gatewayConfig || {})
  try {
    let outcome = "pending"
    let transactionId: string | null = null
    let gatewayResponse: any = null
    let method: string | null = null

    if (gateway === "phonepe") {
      const statusResponse = await getPhonePePaymentStatus(gatewayOrderId, {
        merchantId: String(credentials.merchantId || ""),
        clientId: String(credentials.clientId || ""),
        clientSecret: String(credentials.clientSecret || ""),
        clientVersion: String(credentials.clientVersion || ""),
        webhookUsername: String(credentials.webhookUsername || ""),
        webhookPassword: String(credentials.webhookPassword || ""),
        webhookSecret: String(credentials.webhookPassword || credentials.webhookSecret || ""),
        environment: gatewayMode(gatewayConfig) as any,
      })
      const data = statusResponse?.data || statusResponse
      outcome = normalizeGatewayStatus(data?.state || statusResponse?.code, data?.paymentState || data?.state)
      transactionId = data?.transactionId || payment.gatewayTransactionId || null
      gatewayResponse = { source: actor, statusResponse }
    } else {
      const fetched = await fetchCashfreeOrderAndPaymentsWithRetry({
        references: [gatewayOrderId, payment.checkoutIntent?.referenceId, orderNumberOrGatewayId].filter(Boolean),
        credentials: { ...credentials, mode: gatewayMode(gatewayConfig) },
      })
      if (!fetched.ok) {
        return {
          reconciled: false,
          paid: false,
          failed: false,
          status: String(payment.status || "pending"),
          safeMessage: "Payment status is being verified. Please wait.",
          gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
          attemptedReferences: fetched.attemptedReferences,
          gatewayHttpStatus: fetched.gatewayHttpStatus,
          lastGatewayError: fetched.lastGatewayError,
        }
      }
      const orderStatus = fetched.orderStatus
      const bestPayment = chooseBestCashfreePayment(fetched.payments)
      outcome = normalizeGatewayStatus(orderStatus.orderStatus, bestPayment?.payment_status || orderStatus.paymentStatus)
      transactionId = bestPayment?.cf_payment_id || orderStatus.cfOrderId || payment.gatewayTransactionId || null
      method = paymentMethodFromPayment(bestPayment) || orderStatus.paymentMethod || payment.paymentMethod
      gatewayResponse = {
        source: actor,
        orderStatus,
        payment: summarizeCashfreePayment(bestPayment),
        gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
        attemptedReferences: fetched.attemptedReferences,
      }
    }

    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"
    const nextPaymentStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "completed") : isFailed ? "failed" : "pending"
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        gatewayTransactionId: transactionId || payment.gatewayTransactionId,
        transactionId: transactionId || payment.transactionId,
        paymentMethod: method || payment.paymentMethod,
        gatewayResponse: gatewayResponse as any,
        errorMessage: isFailed ? "Payment failed at gateway" : null,
        completedAt: isSuccess ? new Date() : payment.completedAt,
        webhookProcessedAt: isSuccess ? (payment.webhookProcessedAt || new Date()) : payment.webhookProcessedAt,
        gatewayPaymentId: transactionId || payment.gatewayPaymentId,
      },
    })
    if (payment.paymentAttempts?.[0]?.id) {
      await prisma.paymentAttempt.update({
        where: { id: payment.paymentAttempts[0].id },
        data: {
          statusCheckedAt: new Date(),
          gatewayOrderId,
          gatewayPaymentId: transactionId || payment.paymentAttempts[0].gatewayPaymentId || null,
          gatewayTransactionId: transactionId || payment.paymentAttempts[0].gatewayTransactionId || null,
          rawGatewayResponse: gatewayResponse as any,
        },
      }).catch(() => undefined)
    }

    if (isSuccess && payment.paymentAttempts?.[0]?.id) {
      const finalized = await finalizeSuccessfulPayment(payment.paymentAttempts[0].id, {
        actor,
        amount: payment.gatewayAmount || payment.amount,
        currency: payment.currency,
        gatewayOrderId,
        gatewayPaymentId: transactionId,
        gatewayTransactionId: transactionId,
        paymentMethod: method,
        gatewayResponse,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
      })
      if (!finalized.finalized) {
        return {
          reconciled: true,
          paid: false,
          failed: false,
          status: finalized.reason || "finalization_failed",
          safeMessage: finalized.reason === "amount_or_currency_mismatch" ? "Gateway amount does not match the invoice amount." : "Payment is paid at gateway but could not be finalized.",
        }
      }
    } else if (isSuccess) {
      await fulfillCheckoutIntent({
        checkoutIntentId: payment.checkoutIntent.id,
        paymentId: payment.id,
        invoiceId: payment.invoiceId || payment.checkoutIntent.invoiceId || null,
        actor,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
        transactionId,
      })
    } else if (isFailed) {
      await prisma.checkoutIntent.update({ where: { id: payment.checkoutIntent.id }, data: { status: "payment_failed" } }).catch(() => undefined)
    }
    return {
      reconciled: true,
      paid: isSuccess,
      failed: isFailed,
      status: isSuccess ? "paid" : isFailed ? "payment_failed" : "pending",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: 200,
      lastGatewayError: null,
      rawGatewaySummary: gatewayResponse ? { payment: (gatewayResponse as any)?.payment || null } : null,
    }
  } catch (error: any) {
    await recordGatewayAttempt({
      paymentId: payment?.id,
      gateway: gateway === "phonepe" ? "phonepe" : "cashfree",
      status: "failed",
      ...safeGatewayError(error),
      metadata: { actor, orderNumberOrGatewayId, checkoutIntentId: payment.checkoutIntent?.id || null },
    })
    return {
      reconciled: false,
      paid: false,
      failed: false,
      status: String(payment.status || "pending"),
      safeMessage: "Payment status is being verified. Please wait.",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: cashfreeErrorStatus(error),
      lastGatewayError: error?.message || "gateway_lookup_failed",
    }
  }
}

async function reconcileCheckoutSessionPayment(
  payment: any,
  paymentSettings: PaymentSettings,
  orderNumberOrGatewayId: string,
  actor: string,
): Promise<ReconcileResult> {
  const gateway = String(payment.gateway || "cashfree").toLowerCase()
  const gatewayOrderId = payment.gatewayOrderId || payment.checkoutSession?.referenceId || orderNumberOrGatewayId
  const gatewayConfig = await resolveReconcileGatewayConfig(gateway, payment.paymentAttempts?.[0]?.gatewayConfig)
  const credentials = gatewayCredentials(gatewayConfig || {})
  try {
    let outcome = "pending"
    let transactionId: string | null = null
    let gatewayResponse: any = null
    let method: string | null = null

    if (gateway === "phonepe") {
      const statusResponse = await getPhonePePaymentStatus(gatewayOrderId, {
        merchantId: String(credentials.merchantId || ""),
        clientId: String(credentials.clientId || ""),
        clientSecret: String(credentials.clientSecret || ""),
        clientVersion: String(credentials.clientVersion || ""),
        webhookUsername: String(credentials.webhookUsername || ""),
        webhookPassword: String(credentials.webhookPassword || ""),
        webhookSecret: String(credentials.webhookPassword || credentials.webhookSecret || ""),
        environment: gatewayMode(gatewayConfig) as any,
      })
      const data = statusResponse?.data || statusResponse
      outcome = normalizeGatewayStatus(data?.state || statusResponse?.code, data?.paymentState || data?.state)
      transactionId = data?.transactionId || payment.gatewayTransactionId || null
      gatewayResponse = { source: actor, statusResponse }
    } else {
      const fetched = await fetchCashfreeOrderAndPaymentsWithRetry({
        references: [gatewayOrderId, payment.checkoutSession?.referenceId, orderNumberOrGatewayId].filter(Boolean),
        credentials: { ...credentials, mode: gatewayMode(gatewayConfig) },
      })
      if (!fetched.ok) {
        return {
          reconciled: false,
          paid: false,
          failed: false,
          status: String(payment.status || "pending"),
          safeMessage: "Payment status is being verified. Please wait.",
          gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
          attemptedReferences: fetched.attemptedReferences,
          gatewayHttpStatus: fetched.gatewayHttpStatus,
          lastGatewayError: fetched.lastGatewayError,
        }
      }
      const orderStatus = fetched.orderStatus
      const bestPayment = chooseBestCashfreePayment(fetched.payments)
      outcome = normalizeGatewayStatus(orderStatus.orderStatus, bestPayment?.payment_status || orderStatus.paymentStatus)
      transactionId = bestPayment?.cf_payment_id || orderStatus.cfOrderId || payment.gatewayTransactionId || null
      method = paymentMethodFromPayment(bestPayment) || orderStatus.paymentMethod || payment.paymentMethod
      gatewayResponse = {
        source: actor,
        orderStatus,
        payment: summarizeCashfreePayment(bestPayment),
        gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
        attemptedReferences: fetched.attemptedReferences,
      }
    }

    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"
    if (isSuccess && payment.paymentAttempts?.[0]?.id) {
      const finalized = await finalizeSuccessfulPayment(payment.paymentAttempts[0].id, {
        actor,
        amount: payment.gatewayAmount || payment.amount,
        currency: payment.currency,
        gatewayOrderId,
        gatewayPaymentId: transactionId,
        gatewayTransactionId: transactionId,
        paymentMethod: method,
        gatewayResponse,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
      })
      if (!finalized.finalized) {
        return {
          reconciled: true,
          paid: false,
          failed: false,
          status: finalized.reason || "finalization_failed",
          safeMessage: finalized.reason === "amount_or_currency_mismatch" ? "Gateway amount does not match the invoice amount." : "Payment is paid at gateway but could not be finalized.",
        }
      }
      return {
        reconciled: true,
        paid: true,
        failed: false,
        status: "paid",
        gatewayOrderIdUsed: gatewayOrderId,
        attemptedReferences: [gatewayOrderId],
        gatewayHttpStatus: 200,
        lastGatewayError: null,
        rawGatewaySummary: gatewayResponse ? { payment: (gatewayResponse as any)?.payment || null } : null,
      }
    }
    if (isFailed) {
      await prisma.paymentAttempt.update({
        where: { id: payment.paymentAttempts[0].id },
        data: { status: "failed", failureCode: "PAYMENT_FAILED", failureMessage: "Payment failed at gateway", statusCheckedAt: new Date() },
      }).catch(() => undefined)
      await prisma.checkoutSession.update({ where: { id: payment.checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
      return {
        reconciled: true,
        paid: false,
        failed: true,
        status: "payment_failed",
        gatewayOrderIdUsed: gatewayOrderId,
        attemptedReferences: [gatewayOrderId],
        gatewayHttpStatus: 200,
        lastGatewayError: null,
      }
    }
    return {
      reconciled: true,
      paid: false,
      failed: false,
      status: "pending",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: 200,
      lastGatewayError: null,
    }
  } catch (error: any) {
    await recordGatewayAttempt({
      paymentId: payment?.id,
      gateway: gateway === "phonepe" ? "phonepe" : "cashfree",
      status: "failed",
      ...safeGatewayError(error),
      metadata: { actor, orderNumberOrGatewayId, checkoutSessionId: payment.checkoutSession?.id || null },
    })
    return {
      reconciled: false,
      paid: false,
      failed: false,
      status: String(payment.status || "pending"),
      safeMessage: "Payment status is being verified. Please wait.",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: cashfreeErrorStatus(error),
      lastGatewayError: error?.message || "gateway_lookup_failed",
    }
  }
}

async function reconcileWalletTopupPayment(
  payment: any,
  paymentSettings: PaymentSettings,
  orderNumberOrGatewayId: string,
  actor: string,
): Promise<ReconcileResult> {
  const gateway = String(payment.gateway || "cashfree").toLowerCase()
  const gatewayOrderId = payment.gatewayOrderId || payment.topupReference || orderNumberOrGatewayId
  const gatewayConfig = await resolveReconcileGatewayConfig(gateway, payment.paymentAttempts?.[0]?.gatewayConfig)
  const credentials = gatewayCredentials(gatewayConfig || {})

  try {
    let outcome = "pending"
    let transactionId: string | null = null
    let gatewayPaymentId: string | null = null
    let gatewayResponse: any = null
    let method: string | null = null
    let amount = Number(payment.gatewayAmount || payment.amount || 0)
    let currency = String(payment.currency || "INR")
    let bankReferenceId: string | null = null

    if (gateway === "phonepe") {
      const statusResponse = await getPhonePePaymentStatus(gatewayOrderId, {
        merchantId: String(credentials.merchantId || ""),
        clientId: String(credentials.clientId || ""),
        clientSecret: String(credentials.clientSecret || ""),
        clientVersion: String(credentials.clientVersion || ""),
        webhookUsername: String(credentials.webhookUsername || ""),
        webhookPassword: String(credentials.webhookPassword || ""),
        webhookSecret: String(credentials.webhookPassword || credentials.webhookSecret || ""),
        environment: gatewayMode(gatewayConfig) as any,
      })
      const data = statusResponse?.data || statusResponse
      outcome = normalizeGatewayStatus(data?.state || statusResponse?.code, data?.paymentState || data?.state)
      transactionId = data?.transactionId || payment.gatewayTransactionId || null
      gatewayPaymentId = data?.transactionId || payment.gatewayPaymentId || null
      bankReferenceId = data?.utr || data?.bankReferenceId || null
      amount = Number(data?.amount ? Number(data.amount) / 100 : amount)
      gatewayResponse = { source: actor, statusResponse }
    } else {
      const fetched = await fetchCashfreeOrderAndPaymentsWithRetry({
        references: [gatewayOrderId, payment.topupReference, orderNumberOrGatewayId].filter(Boolean),
        credentials: { ...credentials, mode: gatewayMode(gatewayConfig) },
      })
      if (!fetched.ok) {
        return {
          reconciled: false,
          paid: false,
          failed: false,
          status: String(payment.status || "pending"),
          safeMessage: "Payment status is being verified. Please wait.",
          gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
          attemptedReferences: fetched.attemptedReferences,
          gatewayHttpStatus: fetched.gatewayHttpStatus,
          lastGatewayError: fetched.lastGatewayError,
        }
      }
      const orderStatus = fetched.orderStatus
      const bestPayment = chooseBestCashfreePayment(fetched.payments)
      outcome = normalizeGatewayStatus(orderStatus.orderStatus, bestPayment?.payment_status || orderStatus.paymentStatus)
      transactionId = bestPayment?.cf_payment_id || orderStatus.cfOrderId || payment.gatewayTransactionId || null
      gatewayPaymentId = bestPayment?.cf_payment_id || payment.gatewayPaymentId || null
      bankReferenceId = bestPayment?.bank_reference || null
      method = paymentMethodFromPayment(bestPayment) || orderStatus.paymentMethod || payment.paymentMethod
      amount = Number(bestPayment?.payment_amount || (orderStatus as any).orderAmount || amount)
      currency = String(bestPayment?.payment_currency || (orderStatus as any).orderCurrency || currency)
      gatewayResponse = {
        source: actor,
        orderStatus,
        payment: summarizeCashfreePayment(bestPayment),
        gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
        attemptedReferences: fetched.attemptedReferences,
      }
    }

    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"
    const nextPaymentStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "completed") : isFailed ? "failed" : "pending"
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId,
        transactionId: transactionId || payment.transactionId,
        gatewayTransactionId: transactionId || payment.gatewayTransactionId,
        paymentMethod: method || payment.paymentMethod,
        gatewayResponse: gatewayResponse as any,
        errorMessage: isFailed ? "Payment failed at gateway" : null,
        completedAt: isSuccess ? new Date() : payment.completedAt,
        webhookProcessedAt: isSuccess || isFailed ? (payment.webhookProcessedAt || new Date()) : payment.webhookProcessedAt,
      },
    })
    if (payment.paymentAttempts?.[0]?.id) {
      await prisma.paymentAttempt.update({
        where: { id: payment.paymentAttempts[0].id },
        data: {
          statusCheckedAt: new Date(),
          gatewayOrderId: gatewayOrderId || payment.paymentAttempts[0].gatewayOrderId,
          gatewayPaymentId: gatewayPaymentId || payment.paymentAttempts[0].gatewayPaymentId || null,
          gatewayTransactionId: transactionId || payment.paymentAttempts[0].gatewayTransactionId || null,
          bankReferenceId: bankReferenceId || payment.paymentAttempts[0].bankReferenceId || null,
          utr: bankReferenceId || payment.paymentAttempts[0].utr || null,
          rawGatewayResponse: gatewayResponse as any,
        },
      }).catch(() => undefined)
    }

    if (isSuccess) {
      const paymentAttemptId = payment.paymentAttempts?.[0]?.id || null
      await finalizeWalletTopupPayment({
        paymentAttemptId,
        paymentId: payment.id,
        paidAmount: amount,
        currency,
        merchantOrderId: payment.paymentAttempts?.[0]?.merchantOrderId || payment.topupReference || null,
        gatewayOrderId: payment.paymentAttempts?.[0]?.gatewayOrderId || payment.gatewayOrderId || gatewayOrderId || null,
        customerId: payment.customerId || null,
        gatewayPaymentId,
        gatewayTransactionId: transactionId,
        paymentMethod: method,
        gatewayResponse,
        actor,
      })
    } else if (isFailed) {
      await markWalletTopupPaymentFailed({ paymentId: payment.id, message: "Payment failed at gateway", status: "failed" })
    }

    return {
      reconciled: true,
      paid: isSuccess,
      failed: isFailed,
      status: isSuccess ? "paid" : isFailed ? "payment_failed" : "pending",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: 200,
      lastGatewayError: null,
      rawGatewaySummary: gatewayResponse ? { payment: (gatewayResponse as any)?.payment || null } : null,
    }
  } catch (error: any) {
    await recordGatewayAttempt({
      paymentId: payment?.id,
      gateway: gateway === "phonepe" ? "phonepe" : "cashfree",
      status: "failed",
      ...safeGatewayError(error),
      metadata: { actor, orderNumberOrGatewayId, purpose: payment?.purpose || null },
    })
    return {
      reconciled: false,
      paid: false,
      failed: false,
      status: String(payment.status || "pending"),
      safeMessage: "Payment status is being verified. Please wait.",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: cashfreeErrorStatus(error),
      lastGatewayError: error?.message || "gateway_lookup_failed",
    }
  }
}

export async function reconcileCashfreeOrder(orderNumberOrGatewayId: string, actor = "status_page"): Promise<ReconcileResult> {
  return reconcileGatewayPayment(orderNumberOrGatewayId, actor)
}

export async function reconcileGatewayPayment(orderNumberOrGatewayId: string, actor = "status_page"): Promise<ReconcileResult> {
  const paymentSettings = await getSetting<PaymentSettings>("payment_settings")
  const localOrder = await prisma.order.findFirst({
    where: {
      OR: [
        { orderNumber: orderNumberOrGatewayId },
        { cashfreeOrderId: orderNumberOrGatewayId },
        { payments: { some: { gatewayOrderId: orderNumberOrGatewayId } } },
      ],
    },
    include: {
      payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } } } },
      invoices: true,
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } },
    },
  })
  if (!localOrder) {
    const intentPayment = await prisma.payment.findFirst({
      where: {
        OR: [
          { gatewayOrderId: orderNumberOrGatewayId },
          { idempotencyKey: orderNumberOrGatewayId },
          { checkoutIntent: { referenceId: orderNumberOrGatewayId } },
          { checkoutIntent: { idempotencyKey: orderNumberOrGatewayId } },
        ],
      },
      include: {
        checkoutIntent: true,
        paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } },
      },
      orderBy: { createdAt: "desc" },
    })
      if (intentPayment?.checkoutIntent) {
        return reconcileCheckoutIntentPayment(intentPayment, paymentSettings, orderNumberOrGatewayId, actor)
      }
      // Checkout-session payments (current VM checkout flow) are not linked to
      // an order until the session is fulfilled. Server-side verification must
      // be able to settle them so the status-poll converges with the provider.
      const sessionPayment = await prisma.payment.findFirst({
        where: {
          OR: [
            { gatewayOrderId: orderNumberOrGatewayId },
            { idempotencyKey: orderNumberOrGatewayId },
            { checkoutSession: { referenceId: orderNumberOrGatewayId } },
            { checkoutSession: { idempotencyKey: orderNumberOrGatewayId } },
            { paymentAttempts: { some: { merchantOrderId: orderNumberOrGatewayId } } },
          ],
        },
        include: {
          checkoutSession: true,
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } },
        },
        orderBy: { createdAt: "desc" },
      })
      if (sessionPayment?.checkoutSession) {
        return reconcileCheckoutSessionPayment(sessionPayment, paymentSettings, orderNumberOrGatewayId, actor)
      }
      const walletTopupPayment = await prisma.payment.findFirst({
        where: {
          purpose: { in: ["wallet_topup", "topup"] },
          OR: [
            { id: orderNumberOrGatewayId },
            { gatewayOrderId: orderNumberOrGatewayId },
            { topupReference: orderNumberOrGatewayId },
            { idempotencyKey: orderNumberOrGatewayId },
            { paymentAttempts: { some: { merchantOrderId: orderNumberOrGatewayId } } },
          ],
        },
        include: {
          invoice: true,
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, include: { gatewayConfig: true } },
        },
        orderBy: { createdAt: "desc" },
      })
      if (walletTopupPayment && isWalletTopupPurpose(walletTopupPayment.purpose)) {
        return reconcileWalletTopupPayment(walletTopupPayment, paymentSettings, orderNumberOrGatewayId, actor)
      }
      return { reconciled: false, paid: false, failed: false, status: "not_found", safeMessage: "Order not found", gatewayOrderIdUsed: orderNumberOrGatewayId, attemptedReferences: [orderNumberOrGatewayId], gatewayHttpStatus: null, lastGatewayError: "not_found" }
  }

  const payment = localOrder.payments[0]
  if (payment?.gateway === "phonepe") {
    return reconcilePhonePeOrder(localOrder, payment, paymentSettings, orderNumberOrGatewayId, actor)
  }
  const gatewayOrderId = localOrder.orderNumber || localOrder.cashfreeOrderId || payment?.gatewayOrderId
  const gatewayOrderCandidates = Array.from(new Set([localOrder.orderNumber, localOrder.cashfreeOrderId, payment?.gatewayOrderId, orderNumberOrGatewayId].filter(Boolean) as string[]))
  if (!gatewayOrderCandidates.length) return { reconciled: false, paid: false, failed: false, status: localOrder.status }

  try {
    let resolvedGatewayOrderId = gatewayOrderId
    const gatewayConfig = await resolveReconcileGatewayConfig(
      String(payment?.gateway || "cashfree"),
      payment?.paymentAttempts?.[0]?.gatewayConfig || localOrder.paymentAttempts?.[0]?.gatewayConfig,
    )
    const credentials = gatewayCredentials(gatewayConfig || {})
    const fetched = await fetchCashfreeOrderAndPaymentsWithRetry({
      references: gatewayOrderCandidates,
      credentials: { ...credentials, mode: gatewayMode(gatewayConfig) },
    })
    if (!fetched.ok) {
      return {
        reconciled: false,
        paid: false,
        failed: false,
        status: localOrder.status,
        safeMessage: "Payment status is being verified. Please wait.",
        gatewayOrderIdUsed: fetched.gatewayOrderIdUsed,
        attemptedReferences: fetched.attemptedReferences,
        gatewayHttpStatus: fetched.gatewayHttpStatus,
        lastGatewayError: fetched.lastGatewayError,
      }
    }
    const orderStatus = fetched.orderStatus
    resolvedGatewayOrderId = fetched.gatewayOrderIdUsed || resolvedGatewayOrderId
    const bestPayment = chooseBestCashfreePayment(fetched.payments)
    const outcome = normalizeGatewayStatus(orderStatus.orderStatus, bestPayment?.payment_status || orderStatus.paymentStatus)
    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"
    const nextPaymentStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "completed") : isFailed ? "failed" : "pending"
    const nextOrderStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "paid") : isFailed ? "payment_failed" : "pending"

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: nextPaymentStatus,
          gatewayPaymentId: bestPayment?.cf_payment_id || orderStatus.cfOrderId || payment.gatewayPaymentId,
          transactionId: bestPayment?.cf_payment_id || payment.transactionId,
          gatewayTransactionId: bestPayment?.cf_payment_id || payment.gatewayTransactionId,
          paymentMethod: paymentMethodFromPayment(bestPayment) || orderStatus.paymentMethod || payment.paymentMethod,
          paymentMethodDetails: bestPayment?.payment_method || payment.paymentMethodDetails || undefined,
          gatewayResponse: {
            source: actor,
            orderStatus,
            resolvedGatewayOrderId,
            payment: bestPayment ? {
              cf_payment_id: bestPayment.cf_payment_id || null,
              payment_status: bestPayment.payment_status || null,
              payment_amount: bestPayment.payment_amount || null,
              payment_time: bestPayment.payment_time || null,
              bank_reference: bestPayment.bank_reference || null,
              payment_method: bestPayment.payment_method || null,
            } : null,
            attemptedReferences: fetched.attemptedReferences,
          } as any,
          errorMessage: isFailed ? "Payment failed at gateway" : null,
          completedAt: isSuccess ? new Date() : payment.completedAt,
          webhookProcessedAt: isSuccess ? (payment.webhookProcessedAt || new Date()) : payment.webhookProcessedAt,
        },
      })
      if (payment.paymentAttempts?.[0]?.id) {
        await prisma.paymentAttempt.update({
          where: { id: payment.paymentAttempts[0].id },
          data: {
            statusCheckedAt: new Date(),
            gatewayOrderId: resolvedGatewayOrderId || payment.paymentAttempts[0].gatewayOrderId || null,
            gatewayPaymentId: bestPayment?.cf_payment_id || payment.paymentAttempts[0].gatewayPaymentId || null,
            gatewayTransactionId: bestPayment?.cf_payment_id || payment.paymentAttempts[0].gatewayTransactionId || null,
            bankReferenceId: bestPayment?.bank_reference || payment.paymentAttempts[0].bankReferenceId || null,
            utr: bestPayment?.bank_reference || payment.paymentAttempts[0].utr || null,
            rawGatewayResponse: {
              source: actor,
              orderStatus,
              payment: summarizeCashfreePayment(bestPayment),
              attemptedReferences: fetched.attemptedReferences,
            } as any,
          },
        }).catch(() => undefined)
      }
    }

    await prisma.order.update({
      where: { id: localOrder.id },
      data: { status: nextOrderStatus },
    })

    if (isSuccess && payment?.paymentAttempts?.[0]?.id) {
      const finalized = await finalizeSuccessfulPayment(payment.paymentAttempts[0].id, {
        actor,
        amount: bestPayment?.payment_amount || (orderStatus as any).orderAmount || payment.gatewayAmount || payment.amount,
        currency: bestPayment?.payment_currency || (orderStatus as any).orderCurrency || payment.currency,
        gatewayOrderId: resolvedGatewayOrderId,
        gatewayPaymentId: bestPayment?.cf_payment_id || orderStatus.cfOrderId || payment.gatewayPaymentId || null,
        gatewayTransactionId: bestPayment?.cf_payment_id || payment.gatewayTransactionId || null,
        paymentMethod: paymentMethodFromPayment(bestPayment) || orderStatus.paymentMethod || payment.paymentMethod || null,
        gatewayResponse: { source: actor, orderStatus, payment: bestPayment } as any,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
      })
      if (!finalized.finalized) {
        return {
          reconciled: true,
          paid: false,
          failed: false,
          status: finalized.reason || "finalization_failed",
          safeMessage: finalized.reason === "amount_or_currency_mismatch" ? "Gateway amount does not match the invoice amount." : "Payment is paid at gateway but could not be finalized.",
        }
      }
    } else if (isSuccess) {
      let invoice = localOrder.invoices
      if (paymentSettings.autoCreateInvoiceOnPaymentSuccess && !invoice) {
        invoice = await createInvoiceForOrder(localOrder.id).catch(() => null)
      }
      if (invoice) {
        await handlePaidInvoice(invoice.id, {
          paymentId: payment?.id || null,
          actor,
          manualVerification: paymentSettings.requireManualVerification,
          autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
          purpose: payment?.purpose,
          transactionId: bestPayment?.cf_payment_id || payment?.gatewayTransactionId || null,
        }).catch(() => undefined)
      } else {
        await finalizePaidOrder({
          orderId: localOrder.id,
          paymentId: payment?.id || null,
          actor,
          manualVerification: paymentSettings.requireManualVerification,
          autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
          purpose: payment?.purpose,
          transactionId: bestPayment?.cf_payment_id || payment?.gatewayTransactionId || null,
        }).catch(() => undefined)
      }
      if (String(localOrder.orderType || "").toLowerCase() === "dedicated") {
        await markDedicatedPaymentConfirmed(localOrder.id, actor).catch(() => undefined)
      }
    }

    return {
      reconciled: true,
      paid: isSuccess,
      failed: isFailed,
      status: nextOrderStatus,
      gatewayOrderIdUsed: resolvedGatewayOrderId || null,
      attemptedReferences: fetched.attemptedReferences,
      gatewayHttpStatus: fetched.gatewayHttpStatus,
      lastGatewayError: null,
      rawGatewaySummary: {
        orderStatus: orderStatus?.orderStatus || null,
        payment: summarizeCashfreePayment(bestPayment),
      },
    }
  } catch (error: any) {
    await recordGatewayAttempt({
      orderId: localOrder.id,
      paymentId: payment?.id,
      gateway: "cashfree",
      status: "failed",
      ...safeGatewayError(error),
      metadata: { actor, orderNumberOrGatewayId },
    })
    console.error("[Payments][Reconcile] failed", {
      orderNumber: localOrder.orderNumber,
      gatewayOrderId,
      message: error?.message,
      statusCode: error?.statusCode,
    })
    return {
      reconciled: false,
      paid: false,
      failed: false,
      status: localOrder.status,
      safeMessage: "Payment status is being verified. Please wait.",
      gatewayOrderIdUsed: gatewayOrderId || null,
      attemptedReferences: gatewayOrderCandidates,
      gatewayHttpStatus: cashfreeErrorStatus(error),
      lastGatewayError: error?.message || "gateway_lookup_failed",
    }
  }
}

async function reconcilePhonePeOrder(
  localOrder: any,
  payment: any,
  paymentSettings: PaymentSettings,
  orderNumberOrGatewayId: string,
  actor: string,
): Promise<ReconcileResult> {
  const gatewayOrderId = payment?.gatewayOrderId || localOrder.orderNumber || orderNumberOrGatewayId
  try {
    const gatewayConfig = payment?.paymentAttempts?.[0]?.gatewayConfig || localOrder.paymentAttempts?.[0]?.gatewayConfig
    const credentials = gatewayCredentials(gatewayConfig || {})
    const statusResponse = await getPhonePePaymentStatus(gatewayOrderId, {
      merchantId: String(credentials.merchantId || ""),
      clientId: String(credentials.clientId || ""),
      clientSecret: String(credentials.clientSecret || ""),
      clientVersion: String(credentials.clientVersion || ""),
      webhookUsername: String(credentials.webhookUsername || ""),
      webhookPassword: String(credentials.webhookPassword || ""),
      webhookSecret: String(credentials.webhookPassword || credentials.webhookSecret || ""),
      environment: gatewayMode(gatewayConfig) as any,
    })
    const data = statusResponse?.data || statusResponse
    const outcome = normalizeGatewayStatus(data?.state || statusResponse?.code, data?.paymentState || data?.state)
    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"
    const nextPaymentStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "completed") : isFailed ? "failed" : "pending"
    const nextOrderStatus = isSuccess ? (paymentSettings.requireManualVerification ? "verification_pending" : "paid") : isFailed ? "payment_failed" : "pending"

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: nextPaymentStatus,
        gatewayPaymentId: data?.transactionId || payment.gatewayPaymentId,
        transactionId: data?.transactionId || payment.transactionId,
        gatewayTransactionId: data?.transactionId || payment.gatewayTransactionId,
        gatewayResponse: { source: actor, statusResponse } as any,
        errorMessage: isFailed ? "Payment failed at gateway" : null,
        completedAt: isSuccess ? new Date() : payment.completedAt,
        webhookProcessedAt: isSuccess ? (payment.webhookProcessedAt || new Date()) : payment.webhookProcessedAt,
      },
    })
    await prisma.order.update({ where: { id: localOrder.id }, data: { status: nextOrderStatus } })
    await recordGatewayAttempt({
      orderId: localOrder.id,
      paymentId: payment.id,
      gateway: "phonepe",
      status: isSuccess ? "success" : isFailed ? "failed" : "pending",
      requestId: gatewayOrderId,
      metadata: { actor },
    })

    if (isSuccess && payment?.paymentAttempts?.[0]?.id) {
      const finalized = await finalizeSuccessfulPayment(payment.paymentAttempts[0].id, {
        actor,
        amount: payment.gatewayAmount || payment.amount,
        currency: payment.currency,
        gatewayOrderId,
        gatewayPaymentId: data?.transactionId || payment.gatewayPaymentId || null,
        gatewayTransactionId: data?.transactionId || payment.gatewayTransactionId || null,
        gatewayResponse: { source: actor, statusResponse } as any,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
      })
      if (!finalized.finalized) {
        return {
          reconciled: true,
          paid: false,
          failed: false,
          status: finalized.reason || "finalization_failed",
          safeMessage: finalized.reason === "amount_or_currency_mismatch" ? "Gateway amount does not match the invoice amount." : "Payment is paid at gateway but could not be finalized.",
        }
      }
    } else if (isSuccess) {
      let invoice = localOrder.invoices
      if (paymentSettings.autoCreateInvoiceOnPaymentSuccess && !invoice) {
        invoice = await createInvoiceForOrder(localOrder.id).catch(() => null)
      }
      if (invoice) {
        await handlePaidInvoice(invoice.id, {
          paymentId: payment?.id || null,
          actor,
          manualVerification: paymentSettings.requireManualVerification,
          autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
          purpose: payment?.purpose,
          transactionId: data?.transactionId || payment?.gatewayTransactionId || null,
        }).catch(() => undefined)
      } else {
        await finalizePaidOrder({
          orderId: localOrder.id,
          paymentId: payment?.id || null,
          actor,
          manualVerification: paymentSettings.requireManualVerification,
          autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
          purpose: payment?.purpose,
          transactionId: data?.transactionId || payment?.gatewayTransactionId || null,
        }).catch(() => undefined)
      }
      if (String(localOrder.orderType || "").toLowerCase() === "dedicated") {
        await markDedicatedPaymentConfirmed(localOrder.id, actor).catch(() => undefined)
      }
    }

    return { reconciled: true, paid: isSuccess, failed: isFailed, status: nextOrderStatus }
  } catch (error: any) {
    await recordGatewayAttempt({
      orderId: localOrder.id,
      paymentId: payment?.id,
      gateway: "phonepe",
      status: "failed",
      ...safeGatewayError(error),
      metadata: { actor, orderNumberOrGatewayId },
    })
    return {
      reconciled: false,
      paid: false,
      failed: false,
      status: localOrder.status,
      safeMessage: "Payment status is being verified. Please wait.",
      gatewayOrderIdUsed: gatewayOrderId,
      attemptedReferences: [gatewayOrderId],
      gatewayHttpStatus: cashfreeErrorStatus(error),
      lastGatewayError: error?.message || "gateway_lookup_failed",
    }
  }
}
