import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSetting, type PaymentSettings, type PlatformSettings } from "@/lib/settings"
import { createWalletTransaction } from "@/lib/wallet"
import { createInvoiceForOrder } from "@/lib/invoices"
import { invoiceTaxWriteFields } from "@/lib/invoices/tax"
import { renewVpsFromPaidInvoice } from "@/lib/renewals"
import { gatewayCredentials, gatewayMode, normalizeGatewayWebhook, rawBodyHash } from "@/lib/payment-gateways"
import { paymentEmail } from "@/lib/email-templates"
import { sendEmail } from "@/lib/mailer"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { createPanelLog } from "@/lib/panel-log"
import { markDedicatedPaymentConfirmed } from "@/lib/dedicated"
import { getRequestHost } from "@/lib/domain/resolve-domain"
import { parseVerifiedJson, readRawBody } from "@/lib/payments/raw-body"
import { verifyPaymentWebhook } from "@/lib/payments/webhook-verify"
import { finalizePaidOrder, finalizeSuccessfulPayment, handlePaidInvoice, type FinalizeSuccessfulPaymentResult } from "@/lib/payment-finalization"
import { fulfillCheckoutIntent } from "@/lib/checkout-intents"
import { fulfillCheckoutSession } from "@/lib/checkout-sessions"
import { finalizeWalletTopupPayment, isWalletTopupPurpose, markWalletTopupPaymentFailed } from "@/lib/wallet-topup"
import { getSiteUrl } from "@/lib/settings/site-settings"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"
import { recordPaymentWebhookLog } from "@/lib/payments/webhook-logs"
import { activePaymentGatewayCredentials } from "@/lib/payments/payment-gateway-admin"
import { getPhonePePaymentStatus } from "@/lib/phonepe"
import { recordCouponRedemption } from "@/lib/coupons"
import { paymentLog, paymentRequestId } from "@/lib/payments/trace"
import { verifyRazorpayWebhookSignature, normalizeRazorpayCredentials } from "@/lib/razorpay"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"
import { captureAuthorizedRazorpayPayment } from "@/lib/payments/razorpay-capture"

interface WebhookPayload {
  type: string
  data: {
    order: {
      order_id: string
      cf_order_id?: string
      order_amount: number
      order_currency: string
      order_status: string
    }
    payment: {
      cf_payment_id: string
      payment_status: string
      payment_amount: number
      payment_currency: string
      payment_message: string
      payment_time: string
      payment_method: {
        card?: { card_network: string; card_type: string; card_bank_name: string }
        upi?: { upi_id: string }
        netbanking?: { netbanking_bank_name: string }
      }
      bank_reference: string | null
    }
    customer_details: {
      customer_id: string
      customer_email: string
      customer_phone: string
      customer_name: string | null
    }
  }
  event_time: string
}

const KNOWN_WEBHOOK_TYPES = new Set([
  "PAYMENT_SUCCESS_WEBHOOK",
  "PAYMENT_FAILED_WEBHOOK",
  "PAYMENT_USER_DROPPED_WEBHOOK",
  "PAYMENT_PENDING_WEBHOOK",
])

function safeWebhookHeaderSnapshot(request: NextRequest) {
  const eventType = request.headers.get("x-webhook-event") || request.headers.get("x-cf-event-type") || ""
  return {
    hasSignature: Boolean(request.headers.get("x-webhook-signature")),
    hasTimestamp: Boolean(request.headers.get("x-webhook-timestamp")),
    eventHeader: eventType || null,
    userAgent: request.headers.get("user-agent") || null,
    contentType: request.headers.get("content-type") || null,
    hasForwardedFor: Boolean(request.headers.get("x-forwarded-for")),
    hasRealIp: Boolean(request.headers.get("x-real-ip")),
  }
}

function looksLikeCashfreeTestCall(payload: unknown, headerEventType: string | null) {
  const eventHint = String(headerEventType || "").toLowerCase()
  if (eventHint.includes("test")) return true
  if (eventHint.includes("ping")) return true

  if (!payload || typeof payload !== "object") return false
  const p = payload as Record<string, unknown>
  const bodyType = String(p.type || "").toLowerCase()
  if (bodyType.includes("test")) return true
  if (bodyType.includes("ping")) return true
  if (bodyType.includes("health")) return true
  return false
}

function compactGatewayPayload(payload: WebhookPayload) {
  return {
    type: payload.type,
    event_time: payload.event_time,
    order: {
      order_id: payload.data?.order?.order_id || null,
      cf_order_id: payload.data?.order?.cf_order_id || null,
      order_status: payload.data?.order?.order_status || null,
      order_amount: payload.data?.order?.order_amount || null,
      order_currency: payload.data?.order?.order_currency || null,
    },
    payment: {
      cf_payment_id: payload.data?.payment?.cf_payment_id || null,
      payment_status: payload.data?.payment?.payment_status || null,
      payment_amount: payload.data?.payment?.payment_amount || null,
      payment_currency: payload.data?.payment?.payment_currency || null,
      payment_message: payload.data?.payment?.payment_message || null,
      payment_time: payload.data?.payment?.payment_time || null,
      bank_reference: payload.data?.payment?.bank_reference || null,
      payment_method: payload.data?.payment?.payment_method || null,
    },
    customer_details: {
      customer_id: payload.data?.customer_details?.customer_id || null,
      customer_email: payload.data?.customer_details?.customer_email || null,
      customer_phone: payload.data?.customer_details?.customer_phone ? "[provided]" : null,
      customer_name: payload.data?.customer_details?.customer_name || null,
    },
  }
}

function extractGatewayIds(gateway: "cashfree" | "phonepe" | "razorpay", payload: any) {
  if (gateway === "razorpay") {
    const payment = payload?.payload?.payment?.entity || {}
    const order = payload?.payload?.order?.entity || {}
    return {
      merchantOrderId: String(order.id || payment.order_id || ""),
      gatewayOrderId: String(order.id || payment.order_id || ""),
      gatewayPaymentId: payment.id ? String(payment.id) : null,
      gatewayTransactionId: payment.id ? String(payment.id) : null,
      bankReferenceId: payment.acquirer_data?.rrn || payment.acquirer_data?.upi_transaction_id || null,
    }
  }
  if (gateway === "cashfree") {
    return {
      merchantOrderId: String(payload?.data?.order?.order_id || ""),
      gatewayOrderId: String(payload?.data?.order?.cf_order_id || payload?.data?.order?.order_id || ""),
      gatewayPaymentId: payload?.data?.payment?.cf_payment_id ? String(payload.data.payment.cf_payment_id) : null,
      gatewayTransactionId: payload?.data?.payment?.cf_payment_id ? String(payload.data.payment.cf_payment_id) : null,
      bankReferenceId: payload?.data?.payment?.bank_reference ? String(payload.data.payment.bank_reference) : null,
    }
  }
  const data = payload?.data || payload?.response?.data || payload?.payload?.data || payload
  return {
    merchantOrderId: String(data?.merchantTransactionId || data?.merchantOrderId || payload?.merchantOrderId || ""),
    gatewayOrderId: String(data?.merchantTransactionId || data?.merchantOrderId || payload?.merchantOrderId || ""),
    gatewayPaymentId: data?.transactionId ? String(data.transactionId) : null,
    gatewayTransactionId: data?.transactionId ? String(data.transactionId) : null,
    bankReferenceId: data?.utr || data?.bankReferenceId ? String(data.utr || data.bankReferenceId) : null,
  }
}

async function findWebhookGatewayConfig(gateway: "cashfree" | "phonepe" | "razorpay", request: NextRequest, ids: ReturnType<typeof extractGatewayIds>) {
  const host = getRequestHost(request)
  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      gateway,
      OR: [
        ids.merchantOrderId ? { merchantOrderId: ids.merchantOrderId } : undefined,
        ids.gatewayOrderId ? { gatewayOrderId: ids.gatewayOrderId } : undefined,
        ids.gatewayPaymentId ? { gatewayPaymentId: ids.gatewayPaymentId } : undefined,
      ].filter(Boolean) as any,
    },
    include: { gatewayConfig: true },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (attempt?.gatewayConfig) return attempt.gatewayConfig
  const row = await (prisma as any).paymentGateway.findFirst({
    where: { OR: [{ code: gateway }, { provider: gateway }], enabled: true },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
  }).catch(() => null)
  if (!row) return null
  return {
    id: null,
    gateway,
    enabled: true,
    environment: String(row.mode || row.environment || "test").toLowerCase() === "production" ? "production" : "sandbox",
    approvedPaymentDomain: host,
    credentialsPlain: activePaymentGatewayCredentials(row),
  }
}

function resolveWebhookOutcome(type: string) {
  if (type === "PAYMENT_SUCCESS_WEBHOOK") return "success" as const
  if (type === "PAYMENT_FAILED_WEBHOOK") return "failed" as const
  return "pending" as const
}

async function verifyPhonePeStatusWithGateway(input: {
  gatewayConfig: any
  merchantOrderId: string
  expectedAmount: number
  expectedCurrency: string
}) {
  const credentials = gatewayCredentials(input.gatewayConfig)
  const status = await getPhonePePaymentStatus(input.merchantOrderId, {
    merchantId: String(credentials.merchantId || ""),
    clientId: String(credentials.clientId || ""),
    clientSecret: String(credentials.clientSecret || ""),
    clientVersion: String(credentials.clientVersion || ""),
    environment: gatewayMode(input.gatewayConfig) as any,
  })
  const state = String(status?.state || status?.orderStatus || status?.status || status?.data?.state || "").toUpperCase()
  const rawAmount = Number(status?.amount || status?.data?.amount || 0)
  const statusAmount = rawAmount > input.expectedAmount * 10 ? Number((rawAmount / 100).toFixed(2)) : Number(rawAmount.toFixed(2))
  const currency = String(status?.currency || status?.data?.currency || input.expectedCurrency || "INR").toUpperCase()
  return {
    ok: state === "COMPLETED" && Math.abs(statusAmount - input.expectedAmount) <= 0.009 && currency === input.expectedCurrency,
    state,
    amount: statusAmount,
    currency,
    raw: status,
  }
}

function phonePePayloadMerchantId(payload: any) {
  const data = payload?.data || payload?.payload || payload?.response?.data || payload || {}
  return String(data.merchantId || data.merchantID || data.merchant_id || payload?.merchantId || "").trim()
}

async function updatePaymentFromWebhookSafe(input: {
  paymentId: string
  data: Record<string, any>
}) {
  try {
    return await prisma.payment.update({ where: { id: input.paymentId }, data: input.data })
  } catch (error: any) {
    if (error?.code !== "P2002") throw error
    const { gatewayPaymentId, gatewayTransactionId, transactionId, ...fallback } = input.data
    await createPanelLog({
      category: "Webhook",
      level: "warn",
      message: "payment_webhook_unique_conflict_replayed",
      paymentId: input.paymentId,
      metadata: {
        conflict: "gateway identifiers already linked",
        gatewayPaymentId: gatewayPaymentId || null,
        gatewayTransactionId: gatewayTransactionId || null,
      },
    }).catch(() => null)
    return prisma.payment.update({ where: { id: input.paymentId }, data: fallback })
  }
}

function razorpayEntity(payload: any, key: string) {
  return payload?.payload?.[key]?.entity || {}
}

function razorpayAmount(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Number((amount / 100).toFixed(2)) : 0
}

async function handleRazorpayWebhook(input: {
  request: NextRequest
  body: string
  requestId: string
  requestHost: string
  headerSnapshot: Record<string, unknown>
}) {
  const payload = JSON.parse(input.body)
  const eventType = String(payload.event || "")
  const eventId = input.request.headers.get("x-razorpay-event-id") || payload.id || rawBodyHash(input.body)
  const ids = extractGatewayIds("razorpay", payload)
  const gatewayConfig = await findWebhookGatewayConfig("razorpay", input.request, ids)
  if (!gatewayConfig) {
    await upsertWebhookEvent({
      gateway: "razorpay",
      eventId,
      eventType,
      gatewayOrderId: ids.gatewayOrderId || null,
      gatewayPaymentId: ids.gatewayPaymentId || null,
      requestHost: input.requestHost,
      requestHeaders: input.headerSnapshot,
      signatureValid: null,
      status: "gateway_config_missing",
      payload,
      rawBody: input.body,
      errorMessage: "gateway_config_missing",
      processed: true,
    })
    return NextResponse.json({ success: false, ignored: true, reason: "gateway_config_missing", requestId: input.requestId }, { status: 503 })
  }
  const signatureValid = verifyRazorpayWebhookSignature(
    input.body,
    input.request.headers.get("x-razorpay-signature"),
    normalizeRazorpayCredentials(gatewayConfig).webhookSecret,
  )
  if (!signatureValid) {
    await upsertWebhookEvent({
      gateway: "razorpay",
      eventId,
      eventType,
      gatewayOrderId: ids.gatewayOrderId || null,
      gatewayPaymentId: ids.gatewayPaymentId || null,
      requestHost: input.requestHost,
      requestHeaders: input.headerSnapshot,
      signatureValid: false,
      status: "invalid_signature",
      payload,
      rawBody: input.body,
      errorMessage: "invalid_signature",
      processed: true,
    })
    return NextResponse.json({ success: false, ignored: true, reason: "invalid_signature", requestId: input.requestId }, { status: 400 })
  }
  paymentFlowLog("Signature verified", { gateway: "razorpay", requestId: input.requestId, eventType, gatewayOrderId: ids.gatewayOrderId || null, gatewayPaymentId: ids.gatewayPaymentId || null })
  const eventRow = await upsertWebhookEvent({
    gateway: "razorpay",
    eventId,
    eventType,
    gatewayOrderId: ids.gatewayOrderId || null,
    gatewayPaymentId: ids.gatewayPaymentId || null,
    requestHost: input.requestHost,
    requestHeaders: input.headerSnapshot,
    signatureValid: true,
    status: "received",
    payload,
    rawBody: input.body,
  })
  if (eventRow?.processedAt) {
    return NextResponse.json({ success: true, duplicate: true, requestId: input.requestId })
  }
  if (!eventRow) {
    return NextResponse.json({ success: false, ignored: true, reason: "webhook_event_not_recorded", requestId: input.requestId }, { status: 500 })
  }

  const payment = razorpayEntity(payload, "payment")
  const order = razorpayEntity(payload, "order")
  const orderId = String(order.id || payment.order_id || ids.gatewayOrderId || "")
  const paymentId = String(payment.id || ids.gatewayPaymentId || "")
  const amount = razorpayAmount(payment.amount || order.amount_paid || order.amount)
  const currency = String(payment.currency || order.currency || "INR").toUpperCase()
  const supportedEvents = new Set(["payment.authorized", "payment.captured", "payment.failed", "refund.created", "refund.processed", "order.paid"])
  if (!supportedEvents.has(eventType)) {
    await prisma.paymentWebhookEvent.update({
      where: { id: eventRow.id },
      data: { status: "ignored_unsupported_event", processedAt: new Date(), gatewayPaymentId: paymentId || null },
    }).catch(() => null)
    return NextResponse.json({ success: true, ignored: true, reason: "unsupported_razorpay_event", eventType, requestId: input.requestId })
  }
  const attempt = await prisma.paymentAttempt.findFirst({
    where: {
      gateway: "razorpay",
      OR: [
        orderId ? { gatewayOrderId: orderId } : undefined,
        paymentId ? { gatewayPaymentId: paymentId } : undefined,
      ].filter(Boolean) as any,
    },
    orderBy: { createdAt: "desc" },
  })
  let isPaid = ["payment.captured", "order.paid"].includes(eventType)
  const isAuthorized = eventType === "payment.authorized"
  const isFailed = eventType === "payment.failed"
  const isRefund = eventType === "refund.created" || eventType === "refund.processed"
  if (attempt && isAuthorized) {
    const capture = await captureAuthorizedRazorpayPayment({ attemptId: attempt.id, gatewayConfig, paymentId })
    if (capture.state === "captured") {
      isPaid = true
      if (capture.payment) {
        Object.assign(payment, capture.payment)
      }
      paymentFlowLog("Razorpay authorized payment captured", { paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, gatewayPaymentId: paymentId, reason: capture.reason })
    } else if (capture.state === "processing") {
      await prisma.paymentWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "capture_processing", gatewayPaymentId: paymentId || null } }).catch(() => null)
      return NextResponse.json({ success: true, pending: true, reason: capture.reason, requestId: input.requestId }, { status: 202 })
    } else {
      await prisma.paymentWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "capture_failed", gatewayPaymentId: paymentId || null, errorMessage: capture.reason } }).catch(() => null)
      return NextResponse.json({ success: false, reason: capture.reason, retryable: capture.retryable, requestId: input.requestId }, { status: capture.retryable ? 503 : 422 })
    }
  }
  if (attempt && isPaid) {
    paymentFlowLog("Razorpay paid webhook matched payment attempt", { paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: attempt.invoiceId || null, orderId: attempt.orderId || null, eventType, gatewayOrderId: orderId || null, gatewayPaymentId: paymentId || null })
    const expectedAmount = Number(attempt.amount)
    const expectedCurrency = String(attempt.currency || "INR").toUpperCase()
    if (amount > 0 && Math.abs(amount - expectedAmount) > 0.009) {
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: {
          status: "amount_mismatch",
          processedAt: new Date(),
          errorMessage: `Amount mismatch. Expected ${expectedAmount}, received ${amount}.`,
        },
      }).catch(() => null)
      return NextResponse.json({ success: false, reason: "amount_mismatch", expectedAmount, receivedAmount: amount, requestId: input.requestId }, { status: 422 })
    }
    if (currency !== expectedCurrency) {
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: {
          status: "currency_mismatch",
          processedAt: new Date(),
          errorMessage: `Currency mismatch. Expected ${expectedCurrency}, received ${currency}.`,
        },
      }).catch(() => null)
      return NextResponse.json({ success: false, reason: "currency_mismatch", expectedCurrency, receivedCurrency: currency, requestId: input.requestId }, { status: 422 })
    }
    let result: FinalizeSuccessfulPaymentResult
    try {
      result = await finalizeSuccessfulPayment(attempt.id, {
        actor: "razorpay_webhook",
        amount: amount || Number(attempt.amount),
        currency,
        gatewayOrderId: orderId || attempt.gatewayOrderId,
        gatewayPaymentId: paymentId || null,
        gatewayTransactionId: paymentId || null,
        bankReferenceId: ids.bankReferenceId || null,
        paymentMethod: payment.method || null,
        gatewayResponse: payload,
        webhookEventId: eventRow?.id || null,
      })
    } catch (error) {
      paymentFlowError("Payment finalization threw", error, { gateway: "razorpay", paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: attempt.invoiceId || null, orderId: attempt.orderId || null, eventRowId: eventRow.id })
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: { status: "finalization_failed", processedAt: new Date(), gatewayPaymentId: paymentId || null, errorMessage: error instanceof Error ? error.message : String(error) },
      }).catch(() => null)
      return NextResponse.json({ success: false, reason: "finalization_failed", requestId: input.requestId }, { status: 500 })
    }
    if (!result.finalized) {
      paymentFlowLog("Payment finalization failed", { gateway: "razorpay", paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: result.invoiceId || attempt.invoiceId || null, orderId: result.orderId || attempt.orderId || null, reason: result.reason || null })
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: { status: "finalization_failed", processedAt: new Date(), gatewayPaymentId: paymentId || null, errorMessage: result.reason || "payment_finalization_failed" },
      }).catch(() => null)
      return NextResponse.json({ success: false, reason: result.reason || "payment_finalization_failed", requestId: input.requestId, finalization: result }, { status: 500 })
    }
    paymentFlowLog("Payment finalization completed", { gateway: "razorpay", paymentAttemptId: attempt.id, paymentId: attempt.paymentId || null, invoiceId: result.invoiceId || null, orderId: result.orderId || null, provisioningJobId: result.provisioningJobId || null })
    await createPanelLog({
      category: "Payment",
      message: "razorpay_one_time_payment_captured",
      customerId: attempt.userId || null,
      orderId: attempt.orderId || null,
      paymentId: attempt.paymentId || null,
      metadata: { eventType, razorpayOrderId: orderId || null, razorpayPaymentId: paymentId || null, finalizeResult: result },
    }).catch(() => null)
  } else if (attempt && isAuthorized) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "authorized",
        gatewayOrderId: orderId || attempt.gatewayOrderId,
        gatewayPaymentId: paymentId || attempt.gatewayPaymentId,
        gatewayTransactionId: paymentId || attempt.gatewayTransactionId,
        webhookVerifiedAt: new Date(),
        rawGatewayResponse: payload,
      },
    }).catch(() => null)
    if (attempt.paymentId) {
      await prisma.payment.update({
        where: { id: attempt.paymentId },
        data: {
          status: "authorized",
          gatewayOrderId: orderId || attempt.gatewayOrderId,
          gatewayPaymentId: paymentId || null,
          gatewayTransactionId: paymentId || null,
          transactionId: paymentId || null,
          paymentMethod: payment.method || null,
          gatewayResponse: payload,
        },
      }).catch(() => null)
    }
  } else if (attempt && isFailed) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "failed",
        failureCode: payment.error_code || eventType,
        failureMessage: payment.error_description || payment.error_reason || "Razorpay payment failed",
        rawGatewayResponse: payload,
      },
    }).catch(() => null)
    if (attempt.paymentId) {
      await prisma.payment.update({
        where: { id: attempt.paymentId },
        data: {
          status: "failed",
          gatewayPaymentId: paymentId || null,
          gatewayTransactionId: paymentId || null,
          errorMessage: payment.error_description || payment.error_reason || "Razorpay payment failed",
          gatewayResponse: payload,
        },
      }).catch(() => null)
    }
    await (prisma as any).paymentRetryQueue.upsert({
      where: { notificationKey: `razorpay:${eventId}` },
      update: { status: "pending", attempts: { increment: 1 }, lastAttemptAt: new Date(), metadata: payload },
      create: {
        orderId: attempt.orderId || null,
        invoiceId: attempt.invoiceId || null,
        paymentId: attempt.paymentId || null,
        customerId: attempt.userId || null,
        gateway: "razorpay",
        reason: eventType,
        retryAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
        notificationKey: `razorpay:${eventId}`,
        metadata: payload,
      },
    }).catch(() => null)
  } else if (attempt && isRefund) {
    if (attempt.paymentId) {
      await prisma.payment.update({
        where: { id: attempt.paymentId },
        data: { gatewayResponse: payload },
      }).catch(() => null)
    }
  } else if (!attempt) {
    await prisma.paymentWebhookEvent.update({
      where: { id: eventRow.id },
      data: { status: "payment_attempt_not_found", processedAt: new Date(), gatewayPaymentId: paymentId || null, errorMessage: "payment_attempt_not_found" },
    }).catch(() => null)
    return NextResponse.json({ success: false, ignored: true, reason: "payment_attempt_not_found", requestId: input.requestId }, { status: 404 })
  }
  if (eventRow?.id) {
    await prisma.paymentWebhookEvent.update({
      where: { id: eventRow.id },
      data: { status: isPaid ? "processed" : isAuthorized ? "processed_authorized" : isFailed ? "processed_failed" : isRefund ? "processed_refund" : "processed_state", processedAt: new Date(), gatewayPaymentId: paymentId || null },
    }).catch(() => null)
  }
  return NextResponse.json({ success: true, requestId: input.requestId })
}

async function upsertWebhookEvent(input: {
  gateway: "cashfree" | "phonepe" | "razorpay"
  eventId: string
  eventType: string
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  requestHost?: string | null
  requestHeaders?: Record<string, unknown> | null
  signatureValid?: boolean | null
  status: string
  payload?: unknown
  rawBody?: string
  errorMessage?: string | null
  paymentId?: string | null
  processed?: boolean
}) {
  const eventId = String(input.eventId || "").trim() || rawBodyHash(String(input.rawBody || ""))
  const payload = (input.payload || null) as any
  try {
    return await prisma.paymentWebhookEvent.upsert({
      where: { gateway_eventId: { gateway: input.gateway, eventId } },
      create: {
        gateway: input.gateway,
        eventId,
        eventType: input.eventType || "UNKNOWN",
        gatewayOrderId: input.gatewayOrderId || null,
        gatewayPaymentId: input.gatewayPaymentId || null,
        requestHost: input.requestHost || null,
        requestHeaders: (input.requestHeaders || null) as any,
        signatureValid: input.signatureValid ?? null,
        status: input.status,
        payload,
        rawBodyHash: rawBodyHash(String(input.rawBody || JSON.stringify(payload || {}))),
        errorMessage: input.errorMessage || null,
        paymentId: input.paymentId || null,
        processedAt: input.processed ? new Date() : null,
      },
      update: {
        eventType: input.eventType || undefined,
        gatewayOrderId: input.gatewayOrderId || undefined,
        gatewayPaymentId: input.gatewayPaymentId || undefined,
        requestHost: input.requestHost || undefined,
        requestHeaders: (input.requestHeaders || undefined) as any,
        signatureValid: input.signatureValid ?? undefined,
        status: input.status,
        payload,
        errorMessage: input.errorMessage || null,
        paymentId: input.paymentId || null,
        processedAt: input.processed ? new Date() : undefined,
      },
    })
  } catch {
    return null
  }
}

async function logWebhookAttempt(input: {
  gateway: "cashfree" | "phonepe" | "razorpay"
  eventId?: string | null
  eventType?: string | null
  status: string
  payload?: unknown
  response?: unknown
  rawBody?: string | null
}) {
  await recordPaymentWebhookLog({
    gateway: input.gateway,
    eventId: input.eventId || rawBodyHash(String(input.rawBody || "")),
    eventType: input.eventType || "UNKNOWN",
    status: input.status,
    payload: input.payload,
    response: input.response,
  })
}

export async function POST(request: NextRequest) {
  const requestId = paymentRequestId(request)
  try {
    const [paymentSettings, platformSettings] = await Promise.all([
      getSetting<PaymentSettings>("payment_settings"),
      getSetting<PlatformSettings>("platform_settings"),
    ])
    const primaryDomain = await getPrimaryPaymentDomain()
    const requestHost = normalizePaymentDomain(getRequestHost(request))
    const expectedHost = normalizePaymentDomain(primaryDomain?.domain || "")
    if (expectedHost && requestHost && expectedHost !== requestHost) {
      await createPanelLog({
        category: "Webhook",
        level: "warn",
        message: "payment_webhook_rejected_non_primary_domain",
        metadata: { requestHost, expectedHost },
      }).catch(() => null)
      return NextResponse.json({ success: true, ignored: true, reason: "non_primary_domain", requestId, code: "non_primary_domain", stage: "webhook" }, { headers: { "x-request-id": requestId } })
    }

	    const body = await readRawBody(request)
    const headerSnapshot = safeWebhookHeaderSnapshot(request)
	    const gateway = request.nextUrl.searchParams.get("gateway") === "razorpay" || request.nextUrl.pathname.includes("/razorpay")
	      ? "razorpay"
	      : request.nextUrl.searchParams.get("gateway") === "phonepe" || request.nextUrl.pathname.includes("/phonepe")
	        ? "phonepe"
	        : "cashfree"

	    paymentLog("payments_webhook_received", {
        requestId,
        stage: "webhook",
        gateway,
        bodyLength: body.length,
        headers: headerSnapshot,
      })
      if (gateway === "razorpay") {
        return handleRazorpayWebhook({ request, body, requestId, requestHost, headerSnapshot })
      }
	    await createPanelLog({
	      category: "Webhook",
	      message: "Payment webhook received",
	      metadata: { gateway, bodyLength: body.length, headers: headerSnapshot },
	    })

      let normalized: any = null
      try {
        normalized = normalizeGatewayWebhook(gateway, body)
      } catch {
        normalized = null
      }

	    const webhookGatewayConfig = await findWebhookGatewayConfig(gateway, request, {
	      merchantOrderId: "",
	      gatewayOrderId: "",
	      gatewayPaymentId: null,
	      gatewayTransactionId: null,
	      bankReferenceId: null,
	    })
	    if (!webhookGatewayConfig) {
        await createPanelLog({
          category: "Webhook",
          level: "warn",
          message: "payment_webhook_gateway_config_missing",
          metadata: { gateway, host: getRequestHost(request), headers: headerSnapshot },
        }).catch(() => null)
        await upsertWebhookEvent({
          gateway,
          eventId: normalized?.eventId || rawBodyHash(body),
          eventType: normalized?.eventType || "UNKNOWN",
          gatewayOrderId: normalized?.gatewayOrderId || null,
          gatewayPaymentId: normalized?.gatewayPaymentId || null,
          requestHost,
          requestHeaders: headerSnapshot,
          signatureValid: null,
          status: "gateway_config_missing",
          payload: normalized?.raw || null,
          rawBody: body,
          errorMessage: "gateway_config_missing",
          processed: true,
        })
        await logWebhookAttempt({
          gateway,
          eventId: normalized?.eventId || rawBodyHash(body),
          eventType: normalized?.eventType || "UNKNOWN",
          status: "gateway_config_missing",
          payload: normalized?.raw || null,
          response: { ignored: true, reason: "gateway_config_missing" },
          rawBody: body,
        })
	      return NextResponse.json({ success: true, ignored: true, reason: "gateway_config_missing", requestId, code: "gateway_config_missing", stage: "webhook" }, { headers: { "x-request-id": requestId } })
	    }
	    const isValid = verifyPaymentWebhook({ gateway, rawBody: body, headers: request.headers, gatewayConfig: webhookGatewayConfig })
	    if (!isValid) {
	      await createPanelLog({
	        category: "Webhook",
	        level: "warn",
	        message: "payment_webhook_signature_failed",
	        metadata: { gateway, headers: headerSnapshot, gatewayConfigId: webhookGatewayConfig.id },
	      })
        await upsertWebhookEvent({
          gateway,
          eventId: normalized?.eventId || rawBodyHash(body),
          eventType: normalized?.eventType || "UNKNOWN",
          gatewayOrderId: normalized?.gatewayOrderId || null,
          gatewayPaymentId: normalized?.gatewayPaymentId || null,
          requestHost,
          requestHeaders: headerSnapshot,
          signatureValid: false,
          status: "signature_failed",
          payload: normalized?.raw || null,
          rawBody: body,
          errorMessage: "invalid_signature",
          processed: true,
        })
        await logWebhookAttempt({
          gateway,
          eventId: normalized?.eventId || rawBodyHash(body),
          eventType: normalized?.eventType || "UNKNOWN",
          status: "signature_failed",
          payload: normalized?.raw || null,
          response: { ignored: true, reason: "invalid_signature" },
          rawBody: body,
        })
	      return NextResponse.json({ success: true, ignored: true, reason: "invalid_signature", requestId, code: "invalid_signature", stage: "webhook" }, { headers: { "x-request-id": requestId } })
	    }

	    let payload: WebhookPayload | null = null
	    try {
	      payload = parseVerifiedJson<WebhookPayload>(body)
    } catch (parseError: any) {
      console.warn("[Payments][Webhook] malformed payload ignored", {
        message: parseError?.message || "invalid_json",
      })
      await upsertWebhookEvent({
        gateway,
        eventId: normalized?.eventId || rawBodyHash(body),
        eventType: normalized?.eventType || "UNKNOWN",
        gatewayOrderId: normalized?.gatewayOrderId || null,
        gatewayPaymentId: normalized?.gatewayPaymentId || null,
        requestHost,
        requestHeaders: headerSnapshot,
        signatureValid: true,
        status: "invalid_payload",
        payload: normalized?.raw || null,
        rawBody: body,
        errorMessage: parseError?.message || "invalid_json",
        processed: true,
      })
      await logWebhookAttempt({
        gateway,
        eventId: normalized?.eventId || rawBodyHash(body),
        eventType: normalized?.eventType || "UNKNOWN",
        status: "invalid_payload",
        payload: normalized?.raw || null,
        response: { ignored: true, reason: "invalid_payload" },
        rawBody: body,
      })
      return NextResponse.json({ success: true, ignored: true, reason: "invalid_payload" })
	    }

	    const headerEventType = request.headers.get("x-webhook-event") || request.headers.get("x-cf-event-type")
    if (looksLikeCashfreeTestCall(payload, headerEventType)) {
      console.log("[Payments][Webhook] test webhook accepted", {
        type: payload.type || null,
        eventHeader: headerEventType || null,
      })
	      return NextResponse.json({ success: true, test: true })
	    }

	    const ids = extractGatewayIds(gateway, payload)

    normalized = normalizeGatewayWebhook(gateway, body)
    console.log("[Payments][Webhook] payload parsed", {
      type: payload.type,
      gateway,
      orderId: payload.data?.order?.order_id || null,
      cfOrderId: payload.data?.order?.cf_order_id || null,
      paymentStatus: payload.data?.payment?.payment_status || null,
      paymentMessage: payload.data?.payment?.payment_message || null,
      amount: payload.data?.payment?.payment_amount || null,
    })
    if (gateway === "cashfree" && !KNOWN_WEBHOOK_TYPES.has(payload.type)) {
      console.warn("[Payments][Webhook] unknown webhook event ignored", {
        type: payload.type,
      })
      await upsertWebhookEvent({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        gatewayOrderId: normalized.gatewayOrderId || null,
        gatewayPaymentId: normalized.gatewayPaymentId || null,
        requestHost,
        requestHeaders: headerSnapshot,
        signatureValid: true,
        status: "unknown_event",
        payload: normalized.raw as any,
        rawBody: body,
        errorMessage: "unknown_event",
        processed: true,
      })
      await logWebhookAttempt({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        status: "unknown_event",
        payload: normalized.raw,
        response: { ignored: true, reason: "unknown_event" },
        rawBody: body,
      })
      return NextResponse.json({ success: true, ignored: true, reason: "unknown_event" })
    }
    if (gateway === "cashfree" && (!payload.data?.order || !payload.data?.payment)) {
      console.warn("[Payments][Webhook] invalid webhook shape ignored", {
        type: payload.type,
        hasOrder: Boolean(payload.data?.order),
        hasPayment: Boolean(payload.data?.payment),
      })
      await upsertWebhookEvent({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        gatewayOrderId: normalized.gatewayOrderId || null,
        gatewayPaymentId: normalized.gatewayPaymentId || null,
        requestHost,
        requestHeaders: headerSnapshot,
        signatureValid: true,
        status: "invalid_shape",
        payload: normalized.raw as any,
        rawBody: body,
        errorMessage: "invalid_shape",
        processed: true,
      })
      await logWebhookAttempt({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        status: "invalid_shape",
        payload: normalized.raw,
        response: { ignored: true, reason: "invalid_shape" },
        rawBody: body,
      })
      return NextResponse.json({ success: true, ignored: true, reason: "invalid_shape" })
    }
    const { order, payment } = gateway === "cashfree" ? payload.data : {
      order: { order_id: normalized.gatewayOrderId, cf_order_id: normalized.gatewayOrderId, order_amount: normalized.amount, order_currency: "INR", order_status: normalized.status },
      payment: { cf_payment_id: normalized.gatewayPaymentId || normalized.eventId, payment_status: normalized.status, payment_amount: normalized.amount, payment_currency: "INR", payment_message: normalized.status, payment_time: new Date().toISOString(), payment_method: {}, bank_reference: null },
    }
    const outcome = gateway === "cashfree" ? resolveWebhookOutcome(payload.type) : normalized.status
    const isSuccess = outcome === "success"
    const isFailed = outcome === "failed"

    let eventRow: any = null
    try {
      eventRow = await prisma.paymentWebhookEvent.create({
        data: {
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          gatewayOrderId: normalized.gatewayOrderId || order.order_id,
          gatewayPaymentId: normalized.gatewayPaymentId,
          requestHost,
          requestHeaders: headerSnapshot as any,
          signatureValid: true,
          status: "received",
          rawBodyHash: rawBodyHash(body),
          payload: normalized.raw as any,
        },
      })
    } catch (eventError: any) {
      if (eventError?.code === "P2002") {
        console.log("[Payments][Webhook] duplicate webhook event ignored", {
          gateway,
          eventId: normalized.eventId,
        })
        await logWebhookAttempt({
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          status: "duplicate_ignored",
          payload: normalized.raw,
          response: { duplicate: true },
          rawBody: body,
        })
        return NextResponse.json({ success: true, duplicate: true })
      }
      throw eventError
    }

    const paymentRecord = await prisma.payment.findFirst({
      where: {
        OR: [
          order.cf_order_id ? { gatewayOrderId: order.cf_order_id } : undefined,
          { gatewayOrderId: order.order_id },
          { topupReference: order.order_id },
          {
            order: {
              orderNumber: order.order_id,
            },
          },
        ].filter(Boolean) as any,
      },
      include: {
        order: true,
        invoice: true,
        checkoutSession: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    })

    const bridgeAttempt = await prisma.paymentAttempt.findUnique({
      where: { merchantOrderId: order.order_id },
    }).catch(() => null)

    if (!paymentRecord) {
      if (bridgeAttempt) {
        if (gateway === "phonepe" && isSuccess && !(ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id)) {
          await prisma.paymentWebhookEvent.update({
            where: { id: eventRow.id },
            data: { status: "rejected_phonepe_transaction_missing", errorMessage: "PhonePe success webhook did not include a transaction id", processedAt: new Date() },
          }).catch(() => undefined)
          await logWebhookAttempt({
            gateway,
            eventId: normalized.eventId,
            eventType: normalized.eventType,
            status: "rejected_phonepe_transaction_missing",
            payload: normalized.raw,
            response: { ignored: true, reason: "transaction_id_missing" },
            rawBody: body,
          })
          return NextResponse.json({ success: true, ignored: true, reason: "transaction_id_missing" })
        }
        await prisma.paymentAttempt.update({
          where: { id: bridgeAttempt.id },
          data: {
	            status: isSuccess ? "success" : isFailed ? "failed" : "pending",
	            gatewayOrderId: normalized.gatewayOrderId || ids.gatewayOrderId || bridgeAttempt.gatewayOrderId,
	            gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId,
	            gatewayTransactionId: ids.gatewayTransactionId || normalized.gatewayPaymentId,
	            bankReferenceId: ids.bankReferenceId,
	            utr: ids.bankReferenceId,
	            webhookVerifiedAt: isSuccess ? new Date() : bridgeAttempt.webhookVerifiedAt,
            statusCheckedAt: new Date(),
            rawGatewayResponse: normalized.raw as any,
            failureCode: isFailed ? String(normalized.eventType || "PHONEPE_FAILED") : null,
            failureMessage: isFailed ? String(payment.payment_message || "PhonePe payment failed") : null,
          },
        }).catch(() => null)
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: { status: "processed_bridge_attempt", processedAt: new Date() },
        }).catch(() => undefined)
        await logWebhookAttempt({
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          status: "processed_bridge_attempt",
          payload: normalized.raw,
          response: { success: true },
          rawBody: body,
        })
        return NextResponse.json({ success: true })
      }
      console.warn("[Payments][Webhook] payment record not found", {
        orderId: order.order_id,
        cfOrderId: order.cf_order_id || null,
      })
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: { status: "ignored_unmatched", errorMessage: "payment_record_not_found", processedAt: new Date() },
      }).catch(() => undefined)
      await logWebhookAttempt({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        status: "ignored_unmatched",
        payload: normalized.raw,
        response: { ignored: true, reason: "payment_record_not_found" },
        rawBody: body,
      })
      return NextResponse.json({ success: true })
    }

    const matchedAttempt = await prisma.paymentAttempt.findFirst({
      where: {
        OR: [
          { paymentId: paymentRecord.id },
          { merchantOrderId: order.order_id },
          order.cf_order_id ? { gatewayOrderId: order.cf_order_id } : undefined,
          { gatewayOrderId: order.order_id },
          payment.cf_payment_id ? { gatewayPaymentId: payment.cf_payment_id } : undefined,
        ].filter(Boolean) as any,
      },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
    let sharedFinalizeResult: FinalizeSuccessfulPaymentResult | null = null

    const existingStatus = String(paymentRecord.status || "").toLowerCase()
    const alreadyPaid = ["completed", "paid", "verification_pending", "success"].includes(existingStatus)
    const alreadyFailed = ["failed", "payment_failed"].includes(existingStatus)
    if ((alreadyPaid && isSuccess) || (alreadyPaid && !isSuccess) || (alreadyFailed && isFailed)) {
      if (alreadyPaid && isSuccess && isWalletTopupPurpose(paymentRecord.purpose)) {
        await finalizeWalletTopupPayment({
          paymentAttemptId: matchedAttempt?.id || null,
          paymentId: paymentRecord.id,
          paidAmount: Number(payment.payment_amount || paymentRecord.gatewayAmount || paymentRecord.amount || 0),
          currency: payment.payment_currency || paymentRecord.currency,
          merchantOrderId: order.order_id,
          gatewayOrderId: order.cf_order_id || order.order_id,
          customerId: paymentRecord.customerId || null,
          gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId || null,
          gatewayTransactionId: ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id || null,
          bankReferenceId: ids.bankReferenceId || null,
          paymentMethod: getPaymentMethodType(payment.payment_method),
          gatewayResponse: compactGatewayPayload(payload) as any,
          actor: "webhook_duplicate",
        }).catch((topupError) => {
          console.error("[Payments][Webhook] duplicate wallet top-up finalization failed", {
            paymentId: paymentRecord.id,
            message: topupError?.message,
          })
        })
      }
      if (alreadyPaid && isSuccess && matchedAttempt) {
        sharedFinalizeResult = await finalizeSuccessfulPayment(matchedAttempt.id, {
          actor: "webhook_duplicate",
          amount: payment.payment_amount,
          currency: payment.payment_currency,
          merchantOrderId: order.order_id,
          gatewayOrderId: order.cf_order_id || order.order_id,
          gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId || null,
          gatewayTransactionId: ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id || null,
          bankReferenceId: ids.bankReferenceId || null,
          paymentMethod: getPaymentMethodType(payment.payment_method),
          gatewayResponse: compactGatewayPayload(payload) as any,
          webhookEventId: eventRow.id,
          manualVerification: paymentSettings.requireManualVerification,
          autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
        }).catch((finalizeError) => {
          console.error("[Payments][Webhook] duplicate finalization repair failed", {
            paymentAttemptId: matchedAttempt.id,
            paymentId: paymentRecord.id,
            message: finalizeError?.message,
          })
          return null
        })
      }
      console.log("[Payments][Webhook] terminal payment webhook ignored", {
        paymentId: paymentRecord.id,
        orderId: order.order_id,
        existingStatus,
        incomingOutcome: outcome,
        finalizeResult: sharedFinalizeResult ? {
          finalized: sharedFinalizeResult.finalized,
          orderId: sharedFinalizeResult.orderId || null,
          invoiceId: sharedFinalizeResult.invoiceId || null,
          provisioningJobId: sharedFinalizeResult.provisioningJobId || null,
        } : null,
      })
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: { paymentId: paymentRecord.id, status: "duplicate_terminal_payment", processedAt: new Date() },
      }).catch(() => undefined)
      await logWebhookAttempt({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        status: "duplicate_terminal_payment",
        payload: normalized.raw,
        response: { duplicate: true },
        rawBody: body,
      })
      return NextResponse.json({ success: true, duplicate: true })
    }

    const expectedAmount = Number(paymentRecord.gatewayAmount || paymentRecord.amount || 0)
    const incomingAmount = Number(payment.payment_amount || 0)
    const expectedCurrency = String(paymentRecord.currency || "INR").toUpperCase()
    const incomingCurrency = String(payment.payment_currency || "INR").toUpperCase()
    if (isSuccess && (!Number.isFinite(incomingAmount) || Math.abs(incomingAmount - expectedAmount) > 0.009 || incomingCurrency !== expectedCurrency)) {
      await prisma.paymentWebhookEvent.update({
        where: { id: eventRow.id },
        data: {
          paymentId: paymentRecord.id,
          status: "rejected_amount_or_currency_mismatch",
          errorMessage: `expected ${expectedAmount} ${expectedCurrency}, got ${incomingAmount} ${incomingCurrency}`,
          processedAt: new Date(),
        },
      }).catch(() => undefined)
      await createPanelLog({
        category: "Webhook",
        level: "error",
        message: "payment_webhook_amount_mismatch",
        customerId: paymentRecord.customerId,
        orderId: paymentRecord.orderId,
        paymentId: paymentRecord.id,
        metadata: { expectedAmount, incomingAmount, expectedCurrency, incomingCurrency, gateway, gatewayOrderId: paymentRecord.gatewayOrderId },
      }).catch(() => null)
      await logWebhookAttempt({
        gateway,
        eventId: normalized.eventId,
        eventType: normalized.eventType,
        status: "rejected_amount_or_currency_mismatch",
        payload: normalized.raw,
        response: { ignored: true, reason: "amount_or_currency_mismatch" },
        rawBody: body,
      })
      return NextResponse.json({ success: true, ignored: true, reason: "amount_or_currency_mismatch" })
    }

    if (gateway === "phonepe" && isSuccess) {
      const transactionId = ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id || null
      if (!transactionId) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: {
            paymentId: paymentRecord.id,
            status: "rejected_phonepe_transaction_missing",
            errorMessage: "PhonePe success webhook did not include a transaction id",
            processedAt: new Date(),
          },
        }).catch(() => undefined)
        await logWebhookAttempt({
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          status: "rejected_phonepe_transaction_missing",
          payload: normalized.raw,
          response: { ignored: true, reason: "transaction_id_missing" },
          rawBody: body,
        })
        return NextResponse.json({ success: true, ignored: true, reason: "transaction_id_missing" })
      }
      const credentials = gatewayCredentials(webhookGatewayConfig)
      const expectedMerchantId = String(credentials.merchantId || "").trim()
      const incomingMerchantId = phonePePayloadMerchantId(normalized.raw)
      if (expectedMerchantId && incomingMerchantId && incomingMerchantId !== expectedMerchantId) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: {
            paymentId: paymentRecord.id,
            status: "rejected_phonepe_merchant_mismatch",
            errorMessage: "PhonePe merchant id mismatch",
            processedAt: new Date(),
          },
        }).catch(() => undefined)
        await logWebhookAttempt({
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          status: "rejected_phonepe_merchant_mismatch",
          payload: normalized.raw,
          response: { ignored: true, reason: "merchant_id_mismatch" },
          rawBody: body,
        })
        return NextResponse.json({ success: true, ignored: true, reason: "merchant_id_mismatch" })
      }
      const statusCheck = await verifyPhonePeStatusWithGateway({
        gatewayConfig: webhookGatewayConfig,
        merchantOrderId: order.order_id,
        expectedAmount,
        expectedCurrency,
      }).catch((error) => ({
        ok: false,
        state: "STATUS_CHECK_FAILED",
        amount: incomingAmount,
        currency: incomingCurrency,
        raw: { message: error?.message || "PhonePe status check failed" },
      }))
      if (!statusCheck.ok) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: {
            paymentId: paymentRecord.id,
            status: "rejected_phonepe_status_mismatch",
            errorMessage: `PhonePe status check failed: ${statusCheck.state}`,
            processedAt: new Date(),
          },
        }).catch(() => undefined)
        await createPanelLog({
          category: "Webhook",
          level: "error",
          message: "phonepe_webhook_status_verification_failed",
          customerId: paymentRecord.customerId,
          orderId: paymentRecord.orderId,
          paymentId: paymentRecord.id,
          metadata: { gatewayOrderId: order.order_id, expectedAmount, expectedCurrency, statusCheck },
        }).catch(() => null)
        await logWebhookAttempt({
          gateway,
          eventId: normalized.eventId,
          eventType: normalized.eventType,
          status: "rejected_phonepe_status_mismatch",
          payload: normalized.raw,
          response: { ignored: true, reason: "phonepe_status_mismatch", statusCheck },
          rawBody: body,
        })
        return NextResponse.json({ success: true, ignored: true, reason: "phonepe_status_mismatch" })
      }
    }

    const paymentStatus = isSuccess
      ? paymentSettings.requireManualVerification
        ? "verification_pending"
        : "completed"
      : isFailed
        ? "failed"
        : "pending"

    console.log("[Payments][Webhook] payment record matched", {
      paymentId: paymentRecord.id,
      dbOrderId: paymentRecord.orderId || null,
      purpose: paymentRecord.purpose,
      outcome,
      nextPaymentStatus: paymentStatus,
      failureReason: isFailed ? payment.payment_message : null,
    })

    await updatePaymentFromWebhookSafe({
      paymentId: paymentRecord.id,
      data: {
	        gatewayPaymentId: payment.cf_payment_id,
	        transactionId: ids.gatewayTransactionId || payment.cf_payment_id,
	        gatewayTransactionId: ids.gatewayTransactionId || payment.cf_payment_id,
	        status: paymentStatus,
        paymentMethod: getPaymentMethodType(payment.payment_method),
        paymentMethodDetails: payment.payment_method as any,
        gatewayResponse: compactGatewayPayload(payload) as any,
        errorMessage: isFailed ? payment.payment_message : null,
        completedAt: isSuccess ? new Date() : paymentRecord.completedAt,
        webhookProcessedAt: isSuccess || isFailed ? new Date() : paymentRecord.webhookProcessedAt,
      },
    })
    await prisma.paymentWebhookEvent.update({
      where: { id: eventRow.id },
      data: { paymentId: paymentRecord.id, status: "processed", processedAt: new Date() },
    }).catch(() => undefined)

    if (isSuccess && matchedAttempt) {
      sharedFinalizeResult = await finalizeSuccessfulPayment(matchedAttempt.id, {
        actor: "webhook",
        amount: payment.payment_amount,
        currency: payment.payment_currency,
        merchantOrderId: order.order_id,
        gatewayOrderId: order.cf_order_id || order.order_id,
        gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId || null,
        gatewayTransactionId: ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id || null,
        bankReferenceId: ids.bankReferenceId || null,
        paymentMethod: getPaymentMethodType(payment.payment_method),
        gatewayResponse: compactGatewayPayload(payload) as any,
        webhookEventId: eventRow.id,
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
      }).catch((finalizeError) => {
        console.error("[Payments][Webhook] shared paid finalization failed", {
          paymentAttemptId: matchedAttempt.id,
          paymentId: paymentRecord.id,
          message: finalizeError?.message,
        })
        return null
      })
      if (sharedFinalizeResult?.finalized) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: { status: "processed_finalized", processedAt: new Date() },
        }).catch(() => undefined)
      }
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentRecord.checkoutSessionId && !paymentRecord.orderId) {
      const fulfilled = await fulfillCheckoutSession({
        checkoutSessionId: paymentRecord.checkoutSessionId,
        paymentId: paymentRecord.id,
        actor: "webhook",
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
        transactionId: ids.gatewayTransactionId || payment.cf_payment_id || null,
      }).catch((finalizeError) => {
        console.error("[Payments][Webhook] checkout session fulfillment failed", {
          checkoutSessionId: paymentRecord.checkoutSessionId,
          paymentId: paymentRecord.id,
          message: finalizeError?.message,
        })
        return null
      })
      if (fulfilled?.orderId) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: { status: "processed_checkout_session", processedAt: new Date() },
        }).catch(() => undefined)
      }
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentRecord.checkoutIntentId && !paymentRecord.orderId && !paymentRecord.checkoutSessionId) {
      const fulfilled = await fulfillCheckoutIntent({
        checkoutIntentId: paymentRecord.checkoutIntentId,
        paymentId: paymentRecord.id,
        invoiceId: paymentRecord.invoiceId,
        actor: "webhook",
        manualVerification: paymentSettings.requireManualVerification,
        autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
        transactionId: ids.gatewayTransactionId || payment.cf_payment_id || null,
      }).catch((finalizeError) => {
        console.error("[Payments][Webhook] checkout intent fulfillment failed", {
          checkoutIntentId: paymentRecord.checkoutIntentId,
          paymentId: paymentRecord.id,
          message: finalizeError?.message,
        })
        return null
      })
      if (fulfilled?.orderId) {
        await prisma.paymentWebhookEvent.update({
          where: { id: eventRow.id },
          data: { status: "processed_checkout_intent", processedAt: new Date() },
        }).catch(() => undefined)
      }
    }

    if (paymentRecord.orderId && !(isSuccess && sharedFinalizeResult?.finalized)) {
      const nextOrderStatus = isSuccess
        ? paymentSettings.requireManualVerification
          ? "verification_pending"
          : "paid"
        : isFailed
          ? "payment_failed"
          : "pending"

      await prisma.order.update({
        where: { id: paymentRecord.orderId },
        data: {
          status: nextOrderStatus,
        },
      })
      if (isSuccess && String(paymentRecord.order?.orderType || "").toLowerCase() === "dedicated") {
        await markDedicatedPaymentConfirmed(paymentRecord.orderId, "webhook").catch((dedicatedError) => {
          console.error("[Payments][Webhook] dedicated payment finalization failed", {
            orderId: paymentRecord.orderId,
            message: dedicatedError?.message,
          })
        })
      }

      console.log("[Payments][Webhook] order status updated", {
        orderId: paymentRecord.orderId,
        status: nextOrderStatus,
        failureReason: isFailed ? payment.payment_message : null,
      })

      if (isSuccess && paymentRecord.order?.couponId && paymentRecord.customerId) {
        await recordCouponRedemption({
          couponId: paymentRecord.order.couponId,
          orderId: paymentRecord.orderId,
          customerId: paymentRecord.customerId,
          paymentId: paymentRecord.id,
          discountAmount: Number(paymentRecord.order.discountAmount || 0),
          gatewayOrderId: paymentRecord.gatewayOrderId || order.cf_order_id || order.order_id,
          gatewayPaymentId: payment.cf_payment_id || null,
          metadata: { source: "payment_webhook", eventType: payload.type },
        })
      }
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && isWalletTopupPurpose(paymentRecord.purpose) && paymentRecord.customerId) {
      await finalizeWalletTopupPayment({
        paymentAttemptId: matchedAttempt?.id || null,
        paymentId: paymentRecord.id,
        paidAmount: Number(payment.payment_amount || paymentRecord.gatewayAmount || paymentRecord.amount || 0),
        currency: payment.payment_currency || paymentRecord.currency,
        merchantOrderId: order.order_id,
        gatewayOrderId: order.cf_order_id || order.order_id,
        customerId: paymentRecord.customerId || null,
        gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId || null,
        gatewayTransactionId: ids.gatewayTransactionId || normalized.gatewayPaymentId || payment.cf_payment_id || null,
        bankReferenceId: ids.bankReferenceId || null,
        paymentMethod: getPaymentMethodType(payment.payment_method),
        gatewayResponse: compactGatewayPayload(payload) as any,
        actor: "webhook",
      }).catch((topupError) => {
        console.error("[Payments][Webhook] wallet top-up finalization failed", {
          paymentId: paymentRecord.id,
          message: topupError?.message,
        })
      })
    } else if (isFailed && isWalletTopupPurpose(paymentRecord.purpose)) {
      await markWalletTopupPaymentFailed({
        paymentId: paymentRecord.id,
        message: payment.payment_message || "Payment failed at gateway",
        status: "failed",
      }).catch(() => undefined)
    } else if (isFailed && paymentRecord.checkoutSessionId) {
      await prisma.checkoutSession.update({
        where: { id: paymentRecord.checkoutSessionId },
        data: { status: "payment_failed" },
      }).catch(() => undefined)
    }

    // If gateway failed after wallet was partially applied, refund that wallet amount once.
    if (isFailed && paymentRecord.customerId && Number(paymentRecord.walletAppliedAmount) > 0) {
      await prisma.$transaction(async (tx) => {
        const referenceId = `${paymentRecord.id}-gateway-failed-refund`
        const existingRefund = await tx.walletTransaction.findFirst({
          where: {
            customerId: paymentRecord.customerId!,
            type: "refund",
            referenceId,
          },
        })
        if (existingRefund) return

        await createWalletTransaction(tx as any, {
          customerId: paymentRecord.customerId!,
          paymentId: paymentRecord.id,
          type: "refund",
          amount: Number(paymentRecord.walletAppliedAmount),
          reason: "Gateway payment failed; wallet amount refunded",
          referenceId,
          createdByType: "system",
          status: "completed",
        })
      })
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentSettings.autoCreateInvoiceOnPaymentSuccess && paymentRecord.orderId) {
      await createInvoiceForOrder(paymentRecord.orderId).catch((invoiceError) => {
        console.error("[Payments][Webhook] invoice creation failed", {
          orderId: paymentRecord.orderId,
          message: invoiceError?.message,
        })
      })
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentRecord.invoiceId && paymentRecord.invoice && !isWalletTopupPurpose(paymentRecord.purpose)) {
      const invoice = await prisma.invoice.update({
        where: { id: paymentRecord.invoiceId },
        data: {
          status: "paid",
	          paidAt: new Date(),
	          paymentTransactionId: ids.gatewayTransactionId || payment.cf_payment_id || paymentRecord.gatewayPaymentId || null,
	          metadata: {
            ...((paymentRecord.invoice.metadata as any) || {}),
            invoiceType: "tax_invoice",
	            convertedFrom: ((paymentRecord.invoice.metadata as any)?.invoiceType || null),
	            gateway: paymentRecord.gateway,
	            gatewayOrderId: paymentRecord.gatewayOrderId || order.cf_order_id || order.order_id,
	            gatewayPaymentId: payment.cf_payment_id || normalized.gatewayPaymentId || null,
	            gatewayTransactionId: ids.gatewayTransactionId || null,
	            bankReferenceId: ids.bankReferenceId || null,
	          },
        },
      })
      await renewVpsFromPaidInvoice(invoice).catch((renewalError) => {
        console.error("[Payments][Webhook] renewal finalization failed", {
          invoiceId: paymentRecord.invoiceId,
          message: renewalError?.message,
        })
      })
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentRecord.orderId) {
      try {
        if (paymentRecord.invoiceId) {
          await handlePaidInvoice(paymentRecord.invoiceId, {
            paymentId: paymentRecord.id,
            actor: "webhook",
            manualVerification: paymentSettings.requireManualVerification,
            autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
            purpose: paymentRecord.purpose,
            transactionId: ids.gatewayTransactionId || payment.cf_payment_id || null,
          })
        } else {
          await finalizePaidOrder({
            orderId: paymentRecord.orderId,
            paymentId: paymentRecord.id,
            actor: "webhook",
            manualVerification: paymentSettings.requireManualVerification,
            autoProvision: paymentSettings.autoProvisionOnPaymentSuccess,
            purpose: paymentRecord.purpose,
            transactionId: ids.gatewayTransactionId || payment.cf_payment_id || null,
          })
        }
      } catch (finalizeError: any) {
        console.error("[Payments][Webhook] paid finalization failed", {
          orderId: paymentRecord.orderId,
          message: finalizeError?.message,
        })
      }
    }

    if (platformSettings.notifyOnPayment) {
      await prisma.analyticsEvent.create({
        data: {
          eventType: "payment",
          eventName: isSuccess ? "payment_success" : isFailed ? "payment_failed" : "payment_pending",
          properties: {
            orderId: order.order_id,
            cfOrderId: order.cf_order_id || null,
            amount: payment.payment_amount,
            paymentMethod: getPaymentMethodType(payment.payment_method),
            cfPaymentId: payment.cf_payment_id,
          },
        },
      })
    }

    if (isSuccess && !sharedFinalizeResult?.finalized && paymentRecord.orderId && paymentRecord.customer?.email) {
      await Promise.all([
        sendOrderInvoiceNotification({ templateKey: "order_paid", orderId: paymentRecord.orderId, invoiceId: paymentRecord.invoiceId, metadata: { source: "payment_webhook", paymentId: paymentRecord.id } }),
        sendOrderInvoiceNotification({ templateKey: "payment_success", orderId: paymentRecord.orderId, invoiceId: paymentRecord.invoiceId, metadata: { source: "payment_webhook", paymentId: paymentRecord.id } }),
        sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: paymentRecord.orderId, invoiceId: paymentRecord.invoiceId, metadata: { source: "payment_webhook", paymentId: paymentRecord.id } }),
      ]).catch((emailError) => {
        console.error("[Payments][Webhook] success email failed", { orderId: paymentRecord.orderId, message: emailError?.message })
      })
    } else if (isFailed && paymentRecord.orderId && paymentRecord.customer?.email) {
      await sendOrderInvoiceNotification({
        templateKey: "payment_failed",
        orderId: paymentRecord.orderId,
        invoiceId: paymentRecord.invoiceId,
        paymentUrl: paymentRecord.invoiceId ? `/client-area/billing/invoices/${paymentRecord.invoiceId}` : "/client-area/billing",
        metadata: { source: "payment_webhook", paymentId: paymentRecord.id },
      }).catch((emailError) => {
        console.error("[Payments][Webhook] failure email failed", { orderId: paymentRecord.orderId, message: emailError?.message })
      })
    } else if (isFailed && paymentRecord.customer?.email) {
      const appUrl = await getSiteUrl()
      const email = await paymentEmail("failure", {
        name: paymentRecord.customer.name,
        amount: Number(paymentRecord.amount || payment.payment_amount || 0),
        reference: paymentRecord.order?.orderNumber || paymentRecord.invoice?.invoiceNumber || order.order_id,
        url: `${appUrl}/client-area/billing`,
      })
      await sendEmail({
        type: "billing",
        to: paymentRecord.customer.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        logMessage: "payment failure notice sent",
        customerId: paymentRecord.customerId,
        orderId: paymentRecord.orderId,
        paymentId: paymentRecord.id,
      }).catch(() => undefined)
    }

	    await createPanelLog({
      category: "Payment",
      level: isFailed ? "warn" : "info",
      message: isSuccess ? "payment_success" : isFailed ? "payment_failed" : "payment_webhook_received",
      customerId: paymentRecord.customerId,
      orderId: paymentRecord.orderId,
      paymentId: paymentRecord.id,
      metadata: {
        gateway,
        outcome,
        gatewayOrderId: paymentRecord.gatewayOrderId,
        gatewayPaymentId: paymentRecord.gatewayPaymentId,
        finalizeResult: sharedFinalizeResult ? {
          finalized: sharedFinalizeResult.finalized,
          reason: sharedFinalizeResult.reason || null,
          invoiceId: sharedFinalizeResult.invoiceId || null,
          orderId: sharedFinalizeResult.orderId || null,
          serviceId: sharedFinalizeResult.serviceId || null,
          provisioningJobId: sharedFinalizeResult.provisioningJobId || null,
        } : null,
      },
	    })

    await logWebhookAttempt({
      gateway,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      status: isSuccess ? "processed" : isFailed ? "processed_failed" : "processed_pending",
      payload: normalized.raw,
      response: { success: true, outcome },
      rawBody: body,
    })

	    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("[Payments][Webhook] processing error", {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
    })
    return NextResponse.json({
      success: false,
      code: error?.code || "webhook_processing_failed",
      message: error?.message || "Payment webhook processing failed.",
      requestId,
    }, { status: 500 })
  }
}

function getPaymentMethodType(paymentMethod: WebhookPayload["data"]["payment"]["payment_method"]): string {
  if (paymentMethod.card) return "card"
  if (paymentMethod.upi) return "upi"
  if (paymentMethod.netbanking) return "netbanking"
  return "unknown"
}

function formatCustomConfigSummary(order: any): string {
  const config = order.customConfig
  if (!config) {
    return "Custom Cloud Instance"
  }

  const diskSummary = Array.isArray(config.disks)
    ? config.disks
        .map((disk: any) => `${disk.sizeGb}GB ${(disk.type || "storage").toUpperCase()}`)
        .join(" + ")
    : "Custom Storage"

  return `Custom Cloud Instance (${config.cpuCores} vCPU, ${config.ramGb}GB RAM, ${diskSummary})`
}

async function createInvoice(order: any) {
  const invoiceNumber = `INV-${order.orderNumber.replace("ZWS-", "")}`

  const lineItems = [
    {
      description: order.product?.name || formatCustomConfigSummary(order),
      quantity: 1,
      unitPrice: order.subtotal / order.termMonths,
      termMonths: order.termMonths,
      total: order.subtotal,
    },
  ]

  const issueDate = new Date()
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)

  await prisma.invoice.create({
    data: {
      invoiceNumber,
      orderId: order.id,
      customerId: order.customerId,
      issueDate,
      dueDate,
      subtotal: order.subtotal,
      ...invoiceTaxWriteFields({ taxRate: 18, taxAmount: order.taxAmount }),
      totalAmount: order.totalAmount,
      currency: "INR",
      status: "paid",
      type: "service",
      lineItems: lineItems as any,
      paidAt: new Date(),
    },
  })
}
