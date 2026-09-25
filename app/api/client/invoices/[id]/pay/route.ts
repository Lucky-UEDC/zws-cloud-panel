import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { createPanelLog } from "@/lib/panel-log"
import { gatewayCredentials } from "@/lib/payment-gateways"
import { canPayInvoiceStatus } from "@/lib/invoices/invoice-view-model"
import { recordGatewayAttempt, safeGatewayError } from "@/lib/payment-attempts"
import { getPrimaryDomainForGatewayAdmin } from "@/lib/payments/payment-gateway-admin"
import { getBaseUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"
import { getUsableGateways, type UsableRuntimeGateway } from "@/lib/runtime-payment-resolver"
import { paymentErrorResponse, paymentLog, paymentRequestId, paymentSuccessResponse } from "@/lib/payments/trace"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"
import { getOrCreateCheckoutSession, getOrCreateCheckoutPayment } from "@/lib/payments/checkout-idempotency"

function requiredGatewayCredentials(gateway: string) {
  if (gateway === "razorpay") return ["keyId", "keySecret", "webhookSecret"]
  if (gateway === "cashfree") return ["appId", "secretKey"]
  if (gateway === "phonepe") return ["merchantId", "clientId", "clientSecret", "clientVersion"]
  return []
}

function gatewayReady(config: any) {
  if (!config?.enabled) return false
  const credentials = gatewayCredentials(config)
  return requiredGatewayCredentials(String(config.gateway)).every((key) => Boolean(credentials[key]))
}

function templateUrl(value: string | null | undefined, fallback: string, referenceId: string) {
  return String(value || fallback).replace(/\{order_id\}/g, encodeURIComponent(referenceId))
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

async function recoverInvoiceOrderCheckoutSession(invoiceId: string, metadata: Record<string, any>) {
  const metadataSessionId = String(metadata.checkoutSessionId || "").trim()
  if (metadataSessionId) {
    const session = await prisma.checkoutSession.findUnique({ where: { id: metadataSessionId } }).catch((error) => {
      paymentFlowError("Invoice pay original checkout lookup failed", error, { invoiceId, checkoutSessionId: metadataSessionId })
      return null
    })
    if (checkoutSessionHasOrderSnapshot(session)) return session
  }
  const sessions = await prisma.checkoutSession.findMany({
    where: { invoiceId, purpose: "order_payment" },
    orderBy: { createdAt: "asc" },
    take: 5,
  }).catch((error) => {
    paymentFlowError("Invoice pay checkout recovery scan failed", error, { invoiceId })
    return []
  })
  return sessions.find((session) => checkoutSessionHasOrderSnapshot(session)) || null
}

function gatewayMode(config: any) {
  return String(config.environment || config.mode || "sandbox").toLowerCase() === "production" ? "production" : "sandbox"
}

async function updateAdminGatewayStatus(config: any, data: Record<string, unknown>) {
  const id = config?.paymentGatewayId || config?.id
  if (!id) return
  await (prisma as any).paymentGateway.update({ where: { id }, data }).catch(() => null)
}

async function logRetry(input: {
  level?: "info" | "warn" | "error"
  message: string
  customerId: string
  orderId?: string | null
  invoiceId: string
  invoiceNumber: string
  paymentId?: string | null
  metadata?: Record<string, unknown>
}) {
  await createPanelLog({
    category: "Payment",
    level: input.level || "info",
    message: input.message,
    actorType: "customer",
    actorId: input.customerId,
    customerId: input.customerId,
    orderId: input.orderId || null,
    paymentId: input.paymentId || null,
    metadata: {
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      ...(input.metadata || {}),
    },
  }).catch(() => null)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const requestId = paymentRequestId(request)
  const client = await getClientFromRequest(request)
  const customerId = String(client?.sub || "")
  if (!customerId) {
    return paymentErrorResponse({
      requestId,
      code: "unauthorized",
      message: "Unauthorized",
      httpStatus: 401,
      stage: "auth",
      retryable: false,
    })
  }

  const { id } = await params
  const invoice = await prisma.invoice.findFirst({
    where: { id, customerId, deletedAt: null },
    include: {
      customer: true,
      order: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1 },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!invoice) {
    return paymentErrorResponse({
      requestId,
      code: "invoice_not_found",
      message: "Invoice not found",
      httpStatus: 404,
      stage: "validation",
      retryable: false,
    })
  }
  if (!canPayInvoiceStatus(invoice.status)) {
    return paymentErrorResponse({
      requestId,
      code: "invoice_not_payable",
      message: "This invoice is not payable.",
      httpStatus: 409,
      stage: "validation",
      retryable: false,
      details: { status: invoice.status },
    })
  }
  const invoiceMetadata = invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata)
    ? invoice.metadata as Record<string, any>
    : {}
  const isAddonInvoice = String(invoiceMetadata.paymentPurpose || invoiceMetadata.invoiceType || "").toLowerCase() === "addon_purchase"
  const recoveredOrderCheckoutSession = !isAddonInvoice && !invoice.orderId && (invoiceMetadata.pendingOrderSnapshot || invoiceMetadata.checkoutSessionId)
    ? await recoverInvoiceOrderCheckoutSession(invoice.id, invoiceMetadata)
    : null
  const invoicePurpose = isAddonInvoice
    ? "addon_purchase"
    : invoice.orderId || recoveredOrderCheckoutSession ? "order_payment" : "invoice_payment"
  if (recoveredOrderCheckoutSession) {
    paymentFlowLog("Invoice retry recovered order checkout session", {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      checkoutSessionId: recoveredOrderCheckoutSession.id,
      referenceId: recoveredOrderCheckoutSession.referenceId,
    })
  }

  const recentPayment = invoice.payments?.[0]
  const recentAttempt = invoice.paymentAttempts?.[0]
  const recentRedirect = recentAttempt?.bridgeUrl || recentAttempt?.redirectUrl
  if (
    recentPayment?.gatewaySessionId &&
    ["created", "pending"].includes(String(recentPayment.status || "").toLowerCase()) &&
    Date.now() - new Date(recentPayment.createdAt).getTime() < 60 * 60 * 1000
  ) {
    await logRetry({
      message: "pending_invoice_payment_retry_started",
      customerId,
      orderId: invoice.orderId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      paymentId: recentPayment.id,
      metadata: { reusedExistingPayment: true, gateway: recentPayment.gateway, gatewayOrderId: recentPayment.gatewayOrderId },
    })
    return paymentSuccessResponse({
      redirectUrl: recentRedirect || null,
      statusUrl: recentPayment.gatewayOrderId ? `/payment/status?order_id=${encodeURIComponent(recentPayment.gatewayOrderId)}` : null,
      paymentSessionId: recentPayment.gatewaySessionId,
      payment_session_id: recentPayment.gatewaySessionId,
      gatewayOrderId: recentPayment.gatewayOrderId,
      paymentId: recentPayment.id,
      gateway: recentPayment.gateway,
      mode: "production",
      reusedExistingPayment: true,
    }, {
      requestId,
      code: "payment_reused",
      message: "Reused an existing pending payment.",
      stage: "redirect",
    })
  }

  if (
    recentRedirect &&
    ["created", "started", "pending"].includes(String(recentAttempt.status || "").toLowerCase()) &&
    Date.now() - new Date(recentAttempt.createdAt).getTime() < 60 * 60 * 1000
  ) {
    await logRetry({
      message: "pending_invoice_payment_retry_started",
      customerId,
      orderId: invoice.orderId,
      invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentId: recentAttempt.paymentId,
        metadata: { reusedExistingAttempt: true, paymentAttemptId: recentAttempt.id, gateway: recentAttempt.gateway },
      })
    return paymentSuccessResponse({
      redirectUrl: recentRedirect,
      statusUrl: recentAttempt.gatewayOrderId ? `/payment/status?order_id=${encodeURIComponent(recentAttempt.gatewayOrderId)}` : null,
      gatewayOrderId: recentAttempt.gatewayOrderId,
      paymentAttemptId: recentAttempt.id,
      reusedExistingAttempt: true,
    }, {
      requestId,
      code: "payment_attempt_reused",
      message: "Reused an existing pending payment attempt.",
      stage: "redirect",
    })
  }

  const [runtimeConfigs, primaryDomain] = await Promise.all([
    getUsableGateways({ request }),
    getPrimaryDomainForGatewayAdmin().catch(() => null),
  ])
  const configs = runtimeConfigs
    .map((gateway: UsableRuntimeGateway) => ({
      ...gateway,
      id: null,
      paymentGatewayId: gateway.paymentGatewayId,
      enabled: true,
      credentialsPlain: gateway.credentials,
      displayName: gateway.name,
    }))
  if (!configs.length) {
    await logRetry({
      level: "warn",
      message: "payment_retry_failed",
      customerId,
      orderId: invoice.orderId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      metadata: { reason: "no_enabled_admin_gateway" },
    })
    return paymentErrorResponse({
      requestId,
      code: "NO_GATEWAY_AVAILABLE",
      message: "No enabled payment gateway is available. Please contact support.",
      httpStatus: 503,
      stage: "gateway_init",
      retryable: true,
    })
  }

  const baseUrl = getBaseUrl(request)
  const approvedDomain = primaryDomain?.domain || new URL(baseUrl).host
  for (const config of configs) {
    if (!gatewayReady(config)) {
      await recordGatewayAttempt({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        gateway: String(config.gateway || "unknown"),
        status: "failed",
        errorCode: "missing_credentials",
        safeErrorMessage: "Gateway credentials are missing or incomplete.",
        requestPayloadSafe: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: Number(invoice.totalAmount), currency: invoice.currency },
      })
      if (!config.failsafeEnabled) break
      continue
    }
    const addonStableKey = invoicePurpose === "addon_purchase"
      ? String(invoiceMetadata.idempotencyKey || invoiceMetadata.addonPurchaseId || invoice.id).slice(0, 120)
      : ""
    const referenceId = addonStableKey
      ? `ADDON-${invoice.invoiceNumber}-${addonStableKey}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 160)
      : `INV-${invoice.invoiceNumber}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 160)
    const returnUrl = templateUrl(config.returnUrl, `${baseUrl}/payment/status?order_id={order_id}`, referenceId)
    const defaultWebhookUrl = paymentWebhookUrl(String(config.gateway), baseUrl)
    const webhookUrl = templateUrl(config.webhookUrl, defaultWebhookUrl, referenceId)

    paymentLog("invoice_payment_gateway_attempt", {
      requestId,
      stage: "gateway_init",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      gateway: config.gateway,
      customerId,
    })
    let checkoutSession: { id: string } | null = null
    try {
      if (recoveredOrderCheckoutSession?.id) {
        checkoutSession = await prisma.checkoutSession.update({
          where: { id: recoveredOrderCheckoutSession.id },
          data: { status: "pending", gateway: config.gateway, invoiceId: invoice.id },
          select: { id: true },
        })
      } else {
        const preparedCheckout = await getOrCreateCheckoutSession({
          requestId,
          data: {
            referenceId,
            customerId,
            invoiceId: invoice.id,
            status: "pending",
            purpose: invoicePurpose,
            gateway: config.gateway,
            amount: Number(invoice.totalAmount),
            currency: invoice.currency,
            idempotencyKey: addonStableKey ? `${addonStableKey}:checkout` : `invoice:${invoice.id}:checkout`,
            snapshot: {
              source: "invoice_pay",
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              orderId: invoice.orderId || null,
              purpose: invoicePurpose,
              requestId,
            },
          },
        })
        checkoutSession = { id: preparedCheckout.session.id }
      }
      paymentFlowLog("Payment retry checkout session prepared", { invoiceId: invoice.id, checkoutSessionId: checkoutSession.id, purpose: invoicePurpose, recoveredOrderSession: Boolean(recoveredOrderCheckoutSession?.id) })
      const checkoutPayment = await getOrCreateCheckoutPayment({
        requestId,
        gateway: config.gateway,
        checkoutSessionId: checkoutSession.id,
        gatewayConfig: config,
        customerDetails: {
          customerId,
          customerEmail: invoice.customer.email,
          customerPhone: invoice.customer.phone || "0000000000",
          customerName: invoice.customer.name || "Client",
        },
        orderNote: `Invoice payment ${invoice.invoiceNumber}`,
        returnUrl,
        webhookUrl,
        invoiceNumber: invoice.invoiceNumber,
        paymentData: {
          checkoutSessionId: checkoutSession.id,
          orderId: invoice.orderId || null,
          invoiceId: invoice.id,
          customerId,
          gateway: config.gateway,
          amount: Number(invoice.totalAmount),
          gatewayAmount: Number(invoice.totalAmount),
          currency: invoice.currency,
          status: "created",
          purpose: invoicePurpose,
          idempotencyKey: addonStableKey ? `${addonStableKey}:payment` : `invoice:${invoice.id}:payment`,
        },
        paymentAttemptData: {
          orderId: invoice.orderId || null,
          invoiceId: invoice.id,
          userId: customerId,
          domainId: primaryDomain?.id || null,
          gatewayConfigId: null,
          gateway: config.gateway,
          sourceDomain: approvedDomain,
          approvedDomain,
          approvedPaymentDomain: approvedDomain,
          merchantOrderId: referenceId,
          amount: Number(invoice.totalAmount),
          currency: invoice.currency,
          status: "created",
          mode: "direct",
          returnUrl,
        },
      })
      const payment = checkoutPayment.payment
      const attempt = checkoutPayment.attempt
      const gatewayResponse = record(payment.gatewayResponse)
      const checkoutOptions = record(gatewayResponse.checkout)
      await logRetry({
        message: "pending_invoice_payment_retry_started",
        customerId,
        orderId: invoice.orderId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentId: payment.id,
        metadata: { gateway: config.gateway, paymentAttemptId: attempt?.id || null, gatewayOrderId: payment.gatewayOrderId },
      })
      await updateAdminGatewayStatus(config, { lastPaymentStatus: "pending", lastError: null, lastHealthStatus: "healthy" })
      await recordGatewayAttempt({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        paymentId: payment.id,
        gateway: config.gateway,
        status: "started",
        requestId: referenceId,
        requestPayloadSafe: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: Number(invoice.totalAmount), currency: invoice.currency || "INR" },
        responsePayloadSafe: { gatewayOrderId: payment.gatewayOrderId, hasRedirectUrl: Boolean(attempt?.redirectUrl), hasSessionId: Boolean(payment.gatewaySessionId) },
      })

      return paymentSuccessResponse({
        checkoutSessionId: checkoutSession.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        redirectUrl: attempt?.redirectUrl || null,
        paymentUrl: attempt?.redirectUrl || null,
        statusUrl: `/payment/status?order_id=${encodeURIComponent(payment.gatewayOrderId || referenceId)}`,
        paymentSessionId: payment.gatewaySessionId,
        payment_session_id: payment.gatewaySessionId,
        gatewayOrderId: payment.gatewayOrderId,
        checkoutOptions: checkoutOptions || undefined,
        checkout_options: checkoutOptions || undefined,
        publicKey: checkoutOptions.key || gatewayResponse.keyId || undefined,
        razorpayOrderId: checkoutOptions.order_id || payment.gatewayOrderId || undefined,
        razorpay_order_id: checkoutOptions.order_id || payment.gatewayOrderId || undefined,
        razorpayFlow: gatewayResponse.razorpayFlow || "order",
        paymentId: payment.id,
        paymentAttemptId: attempt?.id || null,
        gateway: config.gateway,
        mode: gatewayMode(config),
        status: checkoutPayment.status || "gateway_started",
        message: checkoutPayment.message || `Opening secure ${config.gateway === "cashfree" ? "Cashfree" : config.gateway === "phonepe" ? "PhonePe" : "Razorpay"} checkout...`,
        reusedExistingPayment: Boolean(checkoutPayment.reused),
      }, {
        requestId,
        code: "payment_initiated",
        message: "Invoice payment initialized.",
        stage: "redirect",
      })
    } catch (error) {
      if (checkoutSession?.id) {
        await prisma.checkoutSession.update({ where: { id: checkoutSession.id }, data: { status: "payment_failed" } }).catch(() => undefined)
      }
      const safe = safeGatewayError(error)
      await updateAdminGatewayStatus(config, { lastPaymentStatus: "failed", lastError: safe.safeErrorMessage, lastHealthStatus: "degraded" })
      await recordGatewayAttempt({
        invoiceId: invoice.id,
        orderId: invoice.orderId,
        gateway: String(config.gateway || "unknown"),
        status: "failed",
        errorCode: safe.errorCode,
        safeErrorMessage: safe.safeErrorMessage,
        requestPayloadSafe: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: Number(invoice.totalAmount), currency: invoice.currency || "INR" },
      })
      await logRetry({
        level: "warn",
        message: "payment_retry_failed",
        customerId,
        orderId: invoice.orderId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        metadata: { gateway: config.gateway, error: error instanceof Error ? error.message : String(error) },
      })
      paymentLog("invoice_payment_gateway_failed", {
        requestId,
        stage: "gateway_init",
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        gateway: config.gateway,
        errorCode: safe.errorCode,
        error: safe.safeErrorMessage,
      })
      if (!config.failsafeEnabled) break
    }
  }

  const error = "No usable payment gateway is available. Please contact support."
  await logRetry({
    level: "warn",
    message: "payment_retry_failed",
    customerId,
    orderId: invoice.orderId,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    metadata: { reason: "no_usable_gateway" },
  })
  return paymentErrorResponse({
    requestId,
    code: "NO_GATEWAY_AVAILABLE",
    message: error,
    httpStatus: 503,
    stage: "gateway_init",
    retryable: true,
  })
}
