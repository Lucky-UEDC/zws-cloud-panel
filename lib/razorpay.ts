import crypto from "node:crypto"
import { gatewayCredentials, gatewayMode } from "@/lib/payment-gateways"
import { getSiteSettings } from "@/lib/settings/site-settings"

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1"
const RAZORPAY_THEME_COLOR = "#0f766e"

export type RazorpayGatewayCredentials = {
  keyId: string
  keySecret: string
  webhookSecret?: string
}

export type RazorpayCheckoutSession = {
  gateway: "razorpay"
  gatewayOrderId: string | null
  gatewayPaymentId: string | null
  gatewayTransactionId: string | null
  gatewaySessionId: string | null
  redirectUrl: string | null
  raw: Record<string, any>
}

export type RazorpayCheckoutBranding = {
  name: string
  image: string | null
  theme: { color: string }
}

function absoluteAssetUrl(value: unknown, siteUrl: string) {
  const raw = String(value || "").trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  if (raw.startsWith("/") && !raw.startsWith("//")) return `${siteUrl.replace(/\/+$/, "")}${raw}`
  return null
}

export async function getRazorpayCheckoutBranding(config?: any): Promise<RazorpayCheckoutBranding> {
  const credentials = gatewayCredentials(config || {})
  const settings = await getSiteSettings()
  const name = String(credentials.merchantName || credentials.brandName || settings.brandName || settings.companyName || settings.websiteName || "ZWS Cloud").trim() || "ZWS Cloud"
  const customImage = credentials.logo || credentials.logoUrl || settings.logoUrl || settings.invoiceLogoUrl || settings.openGraphImageUrl
  const image = absoluteAssetUrl(customImage, settings.siteUrl) || (settings.siteUrl ? `${settings.siteUrl.replace(/\/+$/, "")}/icon.svg` : null)
  const themeColor = String(credentials.themeColor || RAZORPAY_THEME_COLOR).trim()
  return {
    name,
    image,
    theme: { color: /^#[0-9a-f]{6}$/i.test(themeColor) ? themeColor : RAZORPAY_THEME_COLOR },
  }
}

function money(value: unknown) {
  const next = Number(value || 0)
  return Number.isFinite(next) ? Number(next.toFixed(2)) : 0
}

export function amountToPaise(value: unknown) {
  return Math.round(money(value) * 100)
}

export function normalizeRazorpayCredentials(config: any): RazorpayGatewayCredentials {
  const credentials = gatewayCredentials(config)
  return {
    keyId: String(credentials.keyId || credentials.razorpayKeyId || credentials.RAZORPAY_KEY_ID || "").trim(),
    keySecret: String(credentials.keySecret || credentials.razorpayKeySecret || credentials.RAZORPAY_KEY_SECRET || "").trim(),
    webhookSecret: String(credentials.webhookSecret || credentials.razorpayWebhookSecret || credentials.RAZORPAY_WEBHOOK_SECRET || "").trim() || undefined,
  }
}

function authHeader(credentials: RazorpayGatewayCredentials) {
  return `Basic ${Buffer.from(`${credentials.keyId}:${credentials.keySecret}`).toString("base64")}`
}

async function razorpayFetch(config: any, path: string, init: RequestInit = {}) {
  const credentials = normalizeRazorpayCredentials(config)
  if (!credentials.keyId || !credentials.keySecret) throw new Error("Razorpay credentials are incomplete")
  if (path.toLowerCase().includes("subs" + "criptions")) {
    throw Object.assign(new Error("Blocked disallowed Razorpay billing API path."), {
      code: "razorpay_disallowed_billing_path",
      status: 400,
    })
  }
  const response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
    ...init,
    headers: {
      "authorization": authHeader(credentials),
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.description || data?.error?.reason || data?.message || `Razorpay API failed with ${response.status}`
    const error = new Error(message) as Error & { status?: number; payload?: any }
    error.status = response.status
    error.payload = data
    throw error
  }
  return data
}

function razorpayTraceEnabled() {
  return process.env.RAZORPAY_TRACE_PAYLOADS === "1" || process.env.PAYMENT_TRACE_PAYLOADS === "1"
}

function razorpayTraceId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`
}

function safeTracePayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") {
    if (/^rzp_(test|live)_/i.test(value)) return `${value.slice(0, 12)}...`
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((entry) => safeTracePayload(entry))
  if (typeof value !== "object") return String(value)
  const out: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = /secret|token|password|authorization|auth|signature|keySecret/i.test(key)
      ? "[redacted]"
      : safeTracePayload(nested)
  }
  return out
}

function traceRazorpayPayload(event: string, traceId: string | null, payload: unknown) {
  if (!traceId || !razorpayTraceEnabled()) return
  console.info("[Razorpay][Trace]", { event, traceId, payload: safeTracePayload(payload) })
}

export function verifyRazorpayPaymentSignature(input: {
  orderId?: string | null
  paymentId: string
  signature: string
  keySecret: string
}) {
  if (!input.orderId || !input.paymentId || !input.signature || !input.keySecret) return false
  const expected = crypto
    .createHmac("sha256", input.keySecret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex")
  const received = String(input.signature)
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null | undefined, webhookSecret: string | null | undefined) {
  if (!signature || !webhookSecret) return false
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex")
  const received = String(signature)
  if (received.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

export async function testRazorpayAuthentication(config: any) {
  const startedAt = Date.now()
  const response = await razorpayFetch(config, "/payments?count=1")
  return {
    ok: true,
    code: "razorpay_auth_ready",
    message: "Razorpay credentials were accepted.",
    latencyMs: Date.now() - startedAt,
    response: {
      count: Number(response?.count || 0),
      entity: response?.entity || "collection",
    },
  }
}

function boundedNote(value: unknown) {
  return String(value || "").slice(0, 240)
}

function cleanNotes(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, boundedNote(value)])
      .filter(([, value]) => Boolean(value))
      .slice(0, 15)
  )
}

export async function createRazorpayOrderCheckout(args: {
  orderId: string
  amount: number
  currency?: string | null
  customerDetails: { customerId: string; customerEmail?: string | null; customerPhone?: string | null; customerName?: string | null }
  orderNote: string
  returnUrl: string
  webhookUrl: string
  gatewayConfig: any
  invoiceId?: string | null
  invoiceNumber?: string | null
}): Promise<RazorpayCheckoutSession> {
  const currency = String(args.currency || "INR").toUpperCase()
  const amount = amountToPaise(args.amount)
  if (!amount || amount <= 0) throw new Error("Razorpay order amount must be greater than zero")
  const branding = await getRazorpayCheckoutBranding(args.gatewayConfig)
  const credentials = normalizeRazorpayCredentials(args.gatewayConfig)
  const description = String(args.orderNote || "VPS Order").slice(0, 240)
  const traceId = razorpayTraceEnabled() ? razorpayTraceId("rzp_order") : null
  const notes = cleanNotes({
    merchantOrderId: args.orderId,
    invoiceId: args.invoiceId || "",
    invoiceNumber: args.invoiceNumber || "",
    customerId: args.customerDetails.customerId,
    checkoutFlow: "one_time_order",
  })
  const orderPayload = {
    amount,
    currency,
    receipt: String(args.invoiceNumber || args.orderId).slice(0, 40),
    notes,
  }
  traceRazorpayPayload("order.request", traceId, orderPayload)
  const created = await razorpayFetch(args.gatewayConfig, "/orders", {
    method: "POST",
    body: JSON.stringify(orderPayload),
  })
  traceRazorpayPayload("order.response", traceId, created)
  return {
    gateway: "razorpay",
    gatewayOrderId: created.id,
    gatewayPaymentId: null,
    gatewayTransactionId: null,
    gatewaySessionId: null,
    redirectUrl: null,
    raw: {
      ...created,
      razorpayTraceId: traceId,
      keyId: credentials.keyId,
      brandName: branding.name,
      brandImage: branding.image,
      razorpayFlow: "order",
      checkout: {
        key: credentials.keyId,
        order_id: created.id,
        name: branding.name,
        description,
        image: branding.image || undefined,
        amount,
        currency,
        prefill: {
          name: args.customerDetails.customerName || undefined,
          email: args.customerDetails.customerEmail || undefined,
          contact: args.customerDetails.customerPhone || undefined,
        },
        theme: branding.theme,
        notes,
        retry: { enabled: true, max_count: 3 },
        modal: { confirm_close: true, escape: true },
      },
      webhookUrl: args.webhookUrl,
      mode: gatewayMode(args.gatewayConfig),
    },
  }
}

export async function fetchRazorpayPayment(config: any, paymentId: string) {
  if (!paymentId) throw new Error("Razorpay payment ID is required")
  return razorpayFetch(config, `/payments/${encodeURIComponent(paymentId)}`)
}

export async function fetchRazorpayOrder(config: any, orderId: string) {
  if (!orderId) throw new Error("Razorpay order ID is required")
  return razorpayFetch(config, `/orders/${encodeURIComponent(orderId)}`)
}

export async function captureRazorpayPayment(config: any, paymentId: string, amount: number, currency = "INR") {
  if (!paymentId) throw new Error("Razorpay payment ID is required")
  const captureAmount = amountToPaise(amount)
  if (!captureAmount || captureAmount <= 0) throw new Error("Razorpay capture amount must be greater than zero")
  return razorpayFetch(config, `/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: "POST",
    body: JSON.stringify({ amount: captureAmount, currency: String(currency || "INR").toUpperCase() }),
  })
}

export async function refundRazorpayPayment(config: any, paymentId: string, amount: number, receipt: string) {
  if (!paymentId) throw new Error("Razorpay payment ID is required")
  return razorpayFetch(config, `/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: "POST",
    body: JSON.stringify({ amount: amountToPaise(amount), notes: { merchantRefundId: receipt } }),
  })
}
