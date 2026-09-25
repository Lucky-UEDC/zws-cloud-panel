import crypto from "node:crypto"

export type PhonePeEnvironment = "sandbox" | "production"

export type PhonePeConfig = {
  merchantId: string
  clientId?: string
  clientSecret?: string
  clientVersion?: string
  environment: PhonePeEnvironment
  webhookUsername?: string
  webhookPassword?: string
  webhookSecret?: string
}

export type PhonePePaymentSession = {
  gatewayOrderId: string
  redirectUrl: string
  raw: any
}

export type PhonePeRefundResult = {
  merchantRefundId: string
  originalMerchantOrderId: string
  refundId: string | null
  amountMinor: number
  state: string | null
  raw: any
}

type PhonePeAuthorization = {
  accessToken: string
  tokenType: string
  expiresAt: number
}

const authorizationCache = new Map<string, PhonePeAuthorization>()
const PHONEPE_TIMEOUT_MS = 15_000
const PHONEPE_MAX_ATTEMPTS = 3

export class PhonePeRequestError extends Error {
  code: string
  status?: number
  retryable: boolean

  constructor(code: string, message: string, options: { status?: number; retryable?: boolean; cause?: unknown } = {}) {
    super(message)
    this.name = "PhonePeRequestError"
    this.code = code
    this.status = options.status
    this.retryable = Boolean(options.retryable)
    if (options.cause !== undefined) this.cause = options.cause
  }
}

async function phonePeFetch(url: string, init: RequestInit, attempts = PHONEPE_MAX_ATTEMPTS) {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), PHONEPE_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (response.status !== 429 && response.status < 500) return response
      lastError = new PhonePeRequestError(
        response.status === 429 ? "PHONEPE_RATE_LIMITED" : "PHONEPE_UPSTREAM_ERROR",
        `PhonePe request failed with ${response.status}`,
        { status: response.status, retryable: true },
      )
      if (attempt === attempts) return response
    } catch (error: any) {
      const timedOut = error?.name === "AbortError"
      lastError = new PhonePeRequestError(
        timedOut ? "PHONEPE_TIMEOUT" : "PHONEPE_NETWORK_ERROR",
        timedOut ? "PhonePe request timed out" : "PhonePe could not be reached",
        { retryable: true, cause: error },
      )
      if (attempt === attempts) throw lastError
    } finally {
      clearTimeout(timeout)
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
  }
  throw lastError
}

function checkoutBaseUrl(env: PhonePeEnvironment) {
  return env === "production" ? "https://api.phonepe.com/apis/pg" : "https://api-preprod.phonepe.com/apis/pg-sandbox"
}

function authorizationUrl(env: PhonePeEnvironment) {
  return env === "production"
    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token"
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function timingSafeEqual(left: string, right: string) {
  return left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
}

function standardCheckoutMissingFields(config: PhonePeConfig) {
  return (["merchantId", "clientId", "clientSecret", "clientVersion"] as const).filter((field) => !String(config[field] || "").trim())
}

function requireStandardCheckoutCredentials(config: PhonePeConfig) {
  const missing = standardCheckoutMissingFields(config)
  if (missing.length) {
    throw new Error(`PhonePe Standard Checkout credentials missing: ${missing.join(", ")}`)
  }
}

async function getPhonePeAuthorization(config: PhonePeConfig) {
  requireStandardCheckoutCredentials(config)
  const cacheKey = `${config.environment}:${config.merchantId}:${config.clientId}:${config.clientVersion}`
  const cached = authorizationCache.get(cacheKey)
  if (cached && cached.expiresAt * 1000 > Date.now() + 30_000) return cached

  const res = await phonePeFetch(authorizationUrl(config.environment), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: String(config.clientId),
      client_secret: String(config.clientSecret),
      client_version: String(config.clientVersion),
      grant_type: "client_credentials",
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.access_token) {
    throw new PhonePeRequestError("PHONEPE_AUTH_FAILED", data?.message || `PhonePe authorization failed with ${res.status}`, { status: res.status })
  }
  const authorization = {
    accessToken: String(data.access_token),
    tokenType: String(data.token_type || "O-Bearer"),
    expiresAt: Number(data.expires_at || 0),
  }
  if (authorization.expiresAt) authorizationCache.set(cacheKey, authorization)
  return authorization
}

export function verifyPhonePeWebhookRawBody(rawBody: string, authorization: string, config: Pick<PhonePeConfig, "webhookSecret" | "webhookUsername" | "webhookPassword">) {
  const username = String(config.webhookUsername || "").trim()
  const password = String(config.webhookPassword || "").trim()
  const provided = String(authorization || "").trim().replace(/^sha256[=:\s]*/i, "")
  if (username && password && timingSafeEqual(sha256(`${username}:${password}`), provided)) return true

  const secret = config.webhookSecret || password
  if (!secret) return false
  if (!authorization) return false
  const expectedBasic = Buffer.from(secret).toString("base64")
  if (authorization === expectedBasic || authorization === `Basic ${expectedBasic}`) return true
  const expectedHmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  return timingSafeEqual(expectedHmac, provided)
}

export async function createPhonePePaymentSession(args: {
  orderId: string
  amount: number
  customerId: string
  customerPhone: string
  redirectUrl: string
  callbackUrl: string
}, config: PhonePeConfig): Promise<PhonePePaymentSession> {
  requireStandardCheckoutCredentials(config)
  const authorization = await getPhonePeAuthorization(config)
  const path = "/checkout/v2/pay"
  const merchantOrderId = args.orderId
  const payload = {
    merchantOrderId,
    amount: Math.round(args.amount * 100),
    paymentFlow: {
      type: "PG_CHECKOUT",
      merchantUrls: {
        redirectUrl: args.redirectUrl,
      },
    },
    metaInfo: {
      udf1: args.customerId,
    },
  }
  const payloadHash = sha256(JSON.stringify(payload))
  console.info("[PhonePe] init request", {
    orderId: merchantOrderId,
    amountMinor: payload.amount,
    environment: config.environment,
    payloadHash,
    hasRedirectUrl: Boolean(args.redirectUrl),
    hasCallbackUrl: Boolean(args.callbackUrl),
    redirectHost: (() => {
      try {
        return new URL(args.redirectUrl).host
      } catch {
        return "invalid_url"
      }
    })(),
    callbackHost: (() => {
      try {
        return new URL(args.callbackUrl).host
      } catch {
        return "invalid_url"
      }
    })(),
    authMode: "standard_checkout_oauth",
  })
  const res = await phonePeFetch(`${checkoutBaseUrl(config.environment)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `${authorization.tokenType} ${authorization.accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  console.info("[PhonePe] init response", {
    orderId: merchantOrderId,
    payloadHash,
    status: res.status,
    success: res.ok,
    code: data?.code || null,
    providerMessage: data?.message || null,
    hasRedirectUrl: Boolean(data?.redirectUrl),
  })
  if (!res.ok) {
    throw new PhonePeRequestError("PHONEPE_SESSION_FAILED", data?.message || `PhonePe request failed with ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 })
  }
  const redirectUrl = data?.redirectUrl
  if (!redirectUrl) throw new PhonePeRequestError("PHONEPE_REDIRECT_MISSING", "PhonePe did not return a payment URL")
  return { gatewayOrderId: merchantOrderId, redirectUrl, raw: data }
}

export async function getPhonePePaymentStatus(orderId: string, config: PhonePeConfig) {
  requireStandardCheckoutCredentials(config)
  const authorization = await getPhonePeAuthorization(config)
  const path = `/checkout/v2/order/${encodeURIComponent(orderId)}/status?details=false`
  const res = await phonePeFetch(`${checkoutBaseUrl(config.environment)}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `${authorization.tokenType} ${authorization.accessToken}`,
    },
  })
  const data = await res.json().catch(() => ({}))
  console.info("[PhonePe] status response", {
    orderId,
    environment: config.environment,
    status: res.status,
    success: res.ok,
    state: data?.state || data?.orderStatus || data?.status || data?.data?.state || null,
    code: data?.code || null,
  })
  if (!res.ok) {
    throw new PhonePeRequestError("PHONEPE_STATUS_FAILED", data?.message || `PhonePe status failed with ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 })
  }
  return data
}

export async function initiatePhonePeRefund(args: {
  merchantRefundId: string
  originalMerchantOrderId: string
  amountMinor: number
}, config: PhonePeConfig): Promise<PhonePeRefundResult> {
  requireStandardCheckoutCredentials(config)
  const merchantRefundId = String(args.merchantRefundId || "").trim()
  const originalMerchantOrderId = String(args.originalMerchantOrderId || "").trim()
  const amountMinor = Math.round(Number(args.amountMinor || 0))
  if (!merchantRefundId) throw new PhonePeRequestError("PHONEPE_REFUND_ID_REQUIRED", "PhonePe refund requires a merchant refund ID")
  if (!originalMerchantOrderId) throw new PhonePeRequestError("PHONEPE_REFUND_ORDER_REQUIRED", "PhonePe refund requires the original merchant order ID")
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new PhonePeRequestError("PHONEPE_REFUND_AMOUNT_INVALID", "PhonePe refund amount must be a positive minor-unit value")

  const authorization = await getPhonePeAuthorization(config)
  const payload = { merchantRefundId, originalMerchantOrderId, amount: amountMinor }
  const payloadHash = sha256(JSON.stringify(payload))
  console.info("[PhonePe] refund init request", {
    merchantRefundId,
    originalMerchantOrderId,
    amountMinor,
    environment: config.environment,
    payloadHash,
  })
  const res = await phonePeFetch(`${checkoutBaseUrl(config.environment)}/payments/v2/refund`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `${authorization.tokenType} ${authorization.accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  console.info("[PhonePe] refund init response", {
    merchantRefundId,
    originalMerchantOrderId,
    amountMinor,
    environment: config.environment,
    status: res.status,
    success: res.ok,
    state: data?.state || data?.status || null,
    code: data?.code || null,
    hasRefundId: Boolean(data?.refundId),
  })
  if (!res.ok) {
    throw new PhonePeRequestError("PHONEPE_REFUND_FAILED", data?.message || `PhonePe refund failed with ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 })
  }
  return {
    merchantRefundId,
    originalMerchantOrderId,
    refundId: data?.refundId ? String(data.refundId) : null,
    amountMinor: Number(data?.amount || amountMinor),
    state: data?.state || data?.status ? String(data.state || data.status) : null,
    raw: data,
  }
}

export async function getPhonePeRefundStatus(merchantRefundId: string, config: PhonePeConfig): Promise<PhonePeRefundResult> {
  requireStandardCheckoutCredentials(config)
  const refundId = String(merchantRefundId || "").trim()
  if (!refundId) throw new PhonePeRequestError("PHONEPE_REFUND_ID_REQUIRED", "PhonePe refund status requires a merchant refund ID")

  const authorization = await getPhonePeAuthorization(config)
  const res = await phonePeFetch(`${checkoutBaseUrl(config.environment)}/payments/v2/refund/${encodeURIComponent(refundId)}/status`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": `${authorization.tokenType} ${authorization.accessToken}`,
    },
  })
  const data = await res.json().catch(() => ({}))
  console.info("[PhonePe] refund status response", {
    merchantRefundId: refundId,
    environment: config.environment,
    status: res.status,
    success: res.ok,
    state: data?.state || data?.status || null,
    code: data?.code || null,
    hasRefundId: Boolean(data?.refundId),
  })
  if (!res.ok) {
    throw new PhonePeRequestError("PHONEPE_REFUND_STATUS_FAILED", data?.message || `PhonePe refund status failed with ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 })
  }
  return {
    merchantRefundId: refundId,
    originalMerchantOrderId: data?.originalMerchantOrderId ? String(data.originalMerchantOrderId) : "",
    refundId: data?.refundId ? String(data.refundId) : null,
    amountMinor: Number(data?.amount || 0),
    state: data?.state || data?.status ? String(data.state || data.status) : null,
    raw: data,
  }
}

export function normalizePhonePeWebhook(payload: any) {
  const decoded = typeof payload?.response === "string"
    ? JSON.parse(Buffer.from(payload.response, "base64").toString("utf8"))
    : payload
  const data = decoded?.payload || decoded?.data || decoded
  const paymentDetails = Array.isArray(data?.paymentDetails) ? data.paymentDetails : []
  const payment = paymentDetails.find((detail: any) => String(detail?.state || "").toUpperCase() === "COMPLETED") || paymentDetails[0] || {}
  const code = String(decoded?.code || data?.state || "").toUpperCase()
  const status = code.includes("SUCCESS") || code === "COMPLETED"
    ? "success"
    : code.includes("FAIL") || code.includes("ERROR")
      ? "failed"
      : "pending"
  return {
    eventId: String(payment?.transactionId || data?.transactionId || data?.orderId || data?.merchantOrderId || data?.merchantTransactionId || decoded?.eventId || crypto.createHash("sha256").update(JSON.stringify(decoded)).digest("hex")),
    eventType: String(decoded?.event || decoded?.code || decoded?.type || "PHONEPE.WEBHOOK"),
    gatewayOrderId: String(data?.merchantOrderId || data?.merchantTransactionId || ""),
    gatewayPaymentId: payment?.transactionId || data?.transactionId ? String(payment?.transactionId || data.transactionId) : null,
    amount: Number(data?.amount || payment?.amount || 0) / 100,
    status,
    raw: decoded,
  }
}
