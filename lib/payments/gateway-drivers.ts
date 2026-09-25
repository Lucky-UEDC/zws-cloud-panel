import { createPaymentOrder, getPaymentStatus, testCashfreeAuthentication, verifyWebhookSignature } from "@/lib/cashfree"
import { gatewayCredentials, gatewayMode, normalizeCashfreeWebhook, rawBodyHash } from "@/lib/payment-gateways"
import {
  createPhonePePaymentSession,
  getPhonePePaymentStatus,
  initiatePhonePeRefund,
  normalizePhonePeWebhook,
  verifyPhonePeWebhookRawBody,
} from "@/lib/phonepe"
import {
  createRazorpayOrderCheckout,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  refundRazorpayPayment,
  testRazorpayAuthentication,
  verifyRazorpayWebhookSignature,
  normalizeRazorpayCredentials,
} from "@/lib/razorpay"
import {
  classifyGatewayFailure,
  type GatewayDiagnostic,
  type GatewayDriver,
  type GatewayInitializeInput,
  type GatewaySession,
  type GatewayVerification,
} from "@/lib/payments/gateway-driver"

function result(state: GatewayVerification["state"], status: string, raw: any, extra: Partial<GatewayVerification> = {}): GatewayVerification {
  return { state, status, raw: raw && typeof raw === "object" ? raw : {}, retryable: false, ...extra }
}

function diagnostic(check: string, ok: boolean, code: string, message: string, metadata?: Record<string, unknown>): GatewayDiagnostic {
  return { check, status: ok ? "pass" : "fail", code, message, metadata }
}

function commonDiagnostics(config: any, required: string[], webhookUrl: string) {
  const credentials = gatewayCredentials(config)
  return [
    diagnostic("credentials", required.every((field) => Boolean(String(credentials[field] || "").trim())), "credential_validation", required.every((field) => Boolean(String(credentials[field] || "").trim())) ? "Required credentials are present." : `Missing required credentials: ${required.filter((field) => !String(credentials[field] || "").trim()).join(", ")}.`, { requiredFields: required }),
    diagnostic("environment", ["production", "sandbox", "test"].includes(String(config?.environment || config?.mode || "").toLowerCase()), "environment_validation", `Configured environment: ${String(config?.environment || config?.mode || "unknown")}.`),
    diagnostic("webhook_url", /^https:\/\//i.test(webhookUrl), "webhook_url_validation", /^https:\/\//i.test(webhookUrl) ? "Webhook uses HTTPS." : "Webhook URL must use HTTPS."),
  ]
}

const cashfree: GatewayDriver = {
  name: "cashfree",
  async initialize(input) {
    const c = gatewayCredentials(input.gatewayConfig)
    const raw = await createPaymentOrder({
      orderId: input.merchantOrderId,
      orderAmount: input.amount,
      orderCurrency: input.currency,
      customerDetails: { customerId: input.customer.id, customerEmail: input.customer.email || `${input.customer.id}@zws.local`, customerPhone: input.customer.phone, customerName: input.customer.name || undefined },
      orderNote: input.description,
      orderMeta: { returnUrl: input.returnUrl, notifyUrl: input.webhookUrl },
    }, { appId: String(c.appId || c.clientId || ""), secretKey: String(c.secretKey || ""), mode: gatewayMode(input.gatewayConfig) as any, apiVersion: String(c.apiVersion || "") || undefined })
    return { gateway: "cashfree", gatewayOrderId: raw.cfOrderId, gatewayPaymentId: null, gatewayTransactionId: null, gatewaySessionId: raw.paymentSessionId, redirectUrl: raw.payments.url, authorizationState: "session_created", raw: raw as any }
  },
  async cancel({ gatewayConfig, gatewayOrderId }) {
    const verified = await this.verify({ gatewayConfig, gatewayOrderId })
    return verified.state === "authorized" || verified.state === "captured" ? verified : result("none", "cancel_not_required", verified.raw)
  },
  async verify({ gatewayConfig, gatewayOrderId }) {
    const c = gatewayCredentials(gatewayConfig)
    const raw: any = await getPaymentStatus(gatewayOrderId, { appId: String(c.appId || c.clientId || ""), secretKey: String(c.secretKey || ""), mode: gatewayMode(gatewayConfig) as any, apiVersion: String(c.apiVersion || "") || undefined })
    const status = String(raw.paymentStatus || raw.orderStatus || "unknown").toUpperCase()
    const state = ["SUCCESS", "PAID", "ACTIVE"].includes(status) ? "captured" : ["FAILED", "EXPIRED", "CANCELLED"].includes(status) ? "failed" : "session_created"
    return result(state, status, raw, { amount: Number(raw.orderAmount || 0), currency: "INR", gatewayPaymentId: raw.cfPaymentId || null })
  },
  async refund() { throw Object.assign(new Error("Cashfree refund API is not configured."), { code: "cashfree_refund_not_configured" }) },
  authorizeRenewal(input) { return this.initialize(input) },
  verifyWebhook({ rawBody, headers, gatewayConfig }) {
    const c = gatewayCredentials(gatewayConfig)
    return verifyWebhookSignature(rawBody, headers.get("x-webhook-timestamp") || "", headers.get("x-webhook-signature") || "", String(c.webhookSecret || c.secretKey || ""))
  },
  normalizeWebhook(rawBody) { return normalizeCashfreeWebhook(JSON.parse(rawBody)) },
  async diagnose({ gatewayConfig, webhookUrl, runLiveAuth }) {
    const checks = commonDiagnostics(gatewayConfig, ["appId", "secretKey"], webhookUrl)
    if (runLiveAuth && checks[0].status !== "fail") {
      try {
        const auth = await testCashfreeAuthentication(gatewayConfig)
        checks.push(diagnostic("authentication", Boolean(auth.ok), auth.ok ? "cashfree_auth_ready" : auth.code, auth.message, { latencyMs: auth.latencyMs, status: auth.status, response: auth.response }))
      } catch (error: any) {
        checks.push(diagnostic("authentication", false, "cashfree_auth_rejected", error?.message || "Cashfree rejected the configured credentials.", { status: error?.status || null, providerResponse: error?.payload || null }))
      }
    }
    return checks
  },
  classifyError: (error) => classifyGatewayFailure(error),
}

const phonepe: GatewayDriver = {
  name: "phonepe",
  async initialize(input) {
    const c = gatewayCredentials(input.gatewayConfig)
    const raw = await createPhonePePaymentSession({ orderId: input.merchantOrderId, amount: input.amount, customerId: input.customer.id, customerPhone: input.customer.phone, redirectUrl: input.returnUrl, callbackUrl: input.webhookUrl }, { merchantId: String(c.merchantId || ""), clientId: String(c.clientId || ""), clientSecret: String(c.clientSecret || ""), clientVersion: String(c.clientVersion || ""), environment: gatewayMode(input.gatewayConfig) as any })
    return { gateway: "phonepe", gatewayOrderId: raw.gatewayOrderId, gatewayPaymentId: null, gatewayTransactionId: null, gatewaySessionId: null, redirectUrl: raw.redirectUrl, authorizationState: "session_created", raw: raw.raw }
  },
  async cancel({ gatewayConfig, gatewayOrderId }) {
    const verified = await this.verify({ gatewayConfig, gatewayOrderId })
    return verified.state === "authorized" || verified.state === "captured" ? verified : result("none", "cancel_not_required", verified.raw)
  },
  async verify({ gatewayConfig, gatewayOrderId }) {
    const c = gatewayCredentials(gatewayConfig)
    const raw: any = await getPhonePePaymentStatus(gatewayOrderId, { merchantId: String(c.merchantId || ""), clientId: String(c.clientId || ""), clientSecret: String(c.clientSecret || ""), clientVersion: String(c.clientVersion || ""), environment: gatewayMode(gatewayConfig) as any })
    const status = String(raw.state || raw.orderStatus || raw.status || raw.data?.state || "unknown").toUpperCase()
    const state = status === "COMPLETED" ? "captured" : ["FAILED", "EXPIRED", "CANCELLED"].includes(status) ? "failed" : "session_created"
    return result(state, status, raw, { amount: Number(raw.amount || raw.data?.amount || 0) / 100, currency: String(raw.currency || raw.data?.currency || "INR") })
  },
  async refund({ gatewayConfig, gatewayPaymentId, merchantRefundId, amount }) {
    const c = gatewayCredentials(gatewayConfig)
    const raw: any = await initiatePhonePeRefund({ merchantRefundId, originalMerchantOrderId: gatewayPaymentId, amountMinor: Math.round(amount * 100) }, { merchantId: String(c.merchantId || ""), clientId: String(c.clientId || ""), clientSecret: String(c.clientSecret || ""), clientVersion: String(c.clientVersion || ""), environment: gatewayMode(gatewayConfig) as any })
    return result("none", String(raw.state || raw.status || "pending"), raw, { retryable: false })
  },
  authorizeRenewal(input) { return this.initialize(input) },
  verifyWebhook({ rawBody, headers, gatewayConfig }) { const c = gatewayCredentials(gatewayConfig); return verifyPhonePeWebhookRawBody(rawBody, headers.get("authorization") || "", { webhookUsername: String(c.webhookUsername || ""), webhookPassword: String(c.webhookPassword || "") }) },
  normalizeWebhook(rawBody) { return { gateway: "phonepe", ...normalizePhonePeWebhook(JSON.parse(rawBody)) } as any },
  async diagnose({ gatewayConfig, webhookUrl }) { return commonDiagnostics(gatewayConfig, ["merchantId", "clientId", "clientSecret"], webhookUrl) },
  classifyError: (error) => classifyGatewayFailure(error),
}

const razorpay: GatewayDriver = {
  name: "razorpay",
  async initialize(input) { const raw = await createRazorpayOrderCheckout({ orderId: input.merchantOrderId, amount: input.amount, currency: input.currency, customerDetails: { customerId: input.customer.id, customerEmail: input.customer.email, customerPhone: input.customer.phone, customerName: input.customer.name }, orderNote: input.description, returnUrl: input.returnUrl, webhookUrl: input.webhookUrl, gatewayConfig: input.gatewayConfig, invoiceId: input.invoiceId, invoiceNumber: input.invoiceNumber }); return { ...raw, authorizationState: "session_created" } as GatewaySession },
  async cancel({ gatewayOrderId }) { return result("none", "cancel_not_required", { orderId: gatewayOrderId, reason: "razorpay_one_time_order" }) },
  async verify({ gatewayConfig, gatewayOrderId }) { const raw: any = gatewayOrderId.startsWith("pay_") ? await fetchRazorpayPayment(gatewayConfig, gatewayOrderId) : await fetchRazorpayOrder(gatewayConfig, gatewayOrderId); const status = String(raw.status || "unknown"); const state = status === "captured" || status === "paid" ? "captured" : status === "authorized" ? "authorized" : ["failed", "refunded"].includes(status) ? "failed" : "session_created"; return result(state, status, raw, { amount: Number(raw.amount_paid || raw.amount || 0) / 100, currency: raw.currency || "INR", gatewayPaymentId: raw.entity === "payment" ? raw.id : null }) },
  async refund({ gatewayConfig, gatewayPaymentId, merchantRefundId, amount }) { const raw: any = await refundRazorpayPayment(gatewayConfig, gatewayPaymentId, amount, merchantRefundId); return result("none", String(raw.status || "processed"), raw) },
  authorizeRenewal(input) { return this.initialize(input) },
  verifyWebhook({ rawBody, headers, gatewayConfig }) { return verifyRazorpayWebhookSignature(rawBody, headers.get("x-razorpay-signature"), normalizeRazorpayCredentials(gatewayConfig).webhookSecret) },
  normalizeWebhook(rawBody) { const p: any = JSON.parse(rawBody); const payment = p?.payload?.payment?.entity || {}; const order = p?.payload?.order?.entity || {}; const event = String(p.event || ""); return { gateway: "razorpay", eventId: String(p.id || payment.id || order.id || rawBodyHash(rawBody)), eventType: event, gatewayOrderId: String(order.id || payment.order_id || ""), gatewayPaymentId: payment.id || null, status: event === "payment.captured" || event === "order.paid" ? "success" : event === "payment.failed" ? "failed" : "pending", amount: Number(payment.amount || order.amount_paid || order.amount || 0) / 100, currency: payment.currency || order.currency || "INR", paymentMethod: payment.method || null, raw: p } },
  async diagnose({ gatewayConfig, webhookUrl, runLiveAuth }) {
    const checks = commonDiagnostics(gatewayConfig, ["keyId", "keySecret", "webhookSecret"], webhookUrl)
    if (runLiveAuth && checks.every((check) => check.status !== "fail")) {
      try {
        const auth = await testRazorpayAuthentication(gatewayConfig)
        checks.push(diagnostic("authentication", true, auth.code, auth.message, { latencyMs: auth.latencyMs, response: auth.response }))
      } catch (error: any) {
        checks.push(diagnostic("authentication", false, "razorpay_auth_rejected", error?.message || "Razorpay rejected the configured credentials.", { status: error?.status || null, providerResponse: error?.payload || null }))
      }
    }
    return checks
  },
  classifyError: (error) => classifyGatewayFailure(error),
}

const registry = { razorpay, phonepe, cashfree } satisfies Record<string, GatewayDriver>
export function getGatewayDriver(name: keyof typeof registry): GatewayDriver { return registry[name] }
export function allGatewayDrivers() { return Object.values(registry) }
