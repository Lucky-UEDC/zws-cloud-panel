import crypto from 'node:crypto'
import { redactForLog } from '@/lib/log-redaction'

const DEFAULT_CF_API_VERSION = '2023-08-01'

export type CashfreeMode = 'sandbox' | 'production'
export type PaymentMode = 'mock' | 'sandbox' | 'production'

interface CashfreeConfig {
  appId: string
  secretKey: string
  mode: CashfreeMode
  apiVersion: string
}

type CashfreeConfigOverride = Partial<CashfreeConfig>

export class CashfreeGatewayError extends Error {
  statusCode: number
  safeMessage: string
  safeCode: string
  details: Record<string, unknown>

  constructor(opts: {
    message: string
    safeMessage: string
    safeCode: string
    statusCode?: number
    details?: Record<string, unknown>
  }) {
    super(opts.message)
    this.name = 'CashfreeGatewayError'
    this.statusCode = opts.statusCode ?? 502
    this.safeMessage = opts.safeMessage
    this.safeCode = opts.safeCode
    this.details = opts.details ?? {}
  }
}

interface CreateOrderParams {
  orderId: string
  orderAmount: number
  orderCurrency?: string
  customerDetails: {
    customerId: string
    customerEmail: string
    customerPhone: string
    customerName?: string
  }
  orderMeta?: {
    returnUrl?: string
    notifyUrl?: string
    paymentMethods?: string
  }
  orderNote?: string
}

interface CashfreeOrderResponse {
  cfOrderId: string
  orderId: string
  entity: string
  orderCurrency: string
  orderAmount: number
  orderStatus: string
  paymentSessionId: string
  orderExpiryTime: string
  orderNote: string | null
  createdAt: string
  customerDetails: {
    customerId: string
    customerName: string | null
    customerEmail: string
    customerPhone: string
  }
  payments: {
    url: string
  }
}

interface PaymentStatus {
  orderId: string
  cfOrderId: string
  orderStatus: string
  orderAmount: number
  gatewayName: string | null
  paymentTime: string | null
  paymentMethod: string | null
  paymentStatus: string | null
  bankReference: string | null
}

function resolveMode(mode?: string): CashfreeMode {
  const normalized = String(mode || '').toLowerCase()
  if (normalized === 'production') return 'production'
  if (normalized === 'sandbox') return 'sandbox'
  if (normalized === 'test') return 'sandbox'
  return 'sandbox'
}

function resolvePaymentMode(inputMode?: string): PaymentMode {
  const explicit = String(inputMode || '').toLowerCase()
  if (explicit === 'mock') return 'mock'
  if (explicit === 'production') return 'production'
  if (explicit === 'sandbox') return 'sandbox'
  return 'sandbox'
}

function resolveAppUrl() {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
}

function getCashfreeApiBaseUrl(mode: CashfreeMode) {
  return mode === 'production' ? 'https://api.cashfree.com/pg/orders' : 'https://sandbox.cashfree.com/pg/orders'
}

function getConfig(override?: CashfreeConfigOverride): CashfreeConfig {
  const appId = override?.appId || ''
  const secretKey = override?.secretKey || ''
  const mode = resolveMode(override?.mode)

  if (!appId || !secretKey) {
    throw new Error('Cashfree credentials are not configured in admin payment settings.')
  }

  return { appId, secretKey, mode, apiVersion: override?.apiVersion || DEFAULT_CF_API_VERSION }
}

export function getCashfreeRuntimeConfig(override?: CashfreeConfigOverride) {
  const paymentMode = resolvePaymentMode(override?.mode)
  const mode = paymentMode === 'production' ? 'production' : 'sandbox'
  const appId = override?.appId || ''
  const secretKey = override?.secretKey || ''
  const appUrl = resolveAppUrl()

  const missingVars: string[] = []
  if (paymentMode !== 'mock' && !appId) missingVars.push('cashfreeAppId')
  if (paymentMode !== 'mock' && !secretKey) missingVars.push('cashfreeSecretKey')

  return {
    paymentMode,
    mode,
    apiBaseUrl: getCashfreeApiBaseUrl(mode),
    appUrl,
    hasAppId: Boolean(appId),
    hasSecretKey: Boolean(secretKey),
    hasWebhookSecret: false,
    missingVars,
  }
}

async function createOrderViaHttp(request: Record<string, unknown>, config: CashfreeConfig) {
  const endpoint = getCashfreeApiBaseUrl(config.mode)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-version': config.apiVersion,
      'x-client-id': config.appId,
      'x-client-secret': config.secretKey,
    },
    body: JSON.stringify(request),
  })

  let body: any = null
  try {
    body = await res.json()
  } catch {
    body = null
  }

  if (!res.ok) {
    const error: any = new Error(`Cashfree HTTP error ${res.status}`)
    error.response = {
      status: res.status,
      data: body,
    }
    throw error
  }

  return body
}

function isWhitelistOrAuthError(message: string, statusCode: number, rawBody: any) {
  const haystack = `${message} ${JSON.stringify(rawBody || {})}`.toLowerCase()
  if (statusCode === 401 || statusCode === 403) return true
  return (
    haystack.includes('whitelist') ||
    haystack.includes('white list') ||
    haystack.includes('domain') && haystack.includes('allow') ||
    haystack.includes('unauthorized') ||
    haystack.includes('authentication failed')
  )
}

export async function createPaymentOrder(
  params: CreateOrderParams,
  override?: CashfreeConfigOverride,
): Promise<CashfreeOrderResponse> {
  const runtime = getCashfreeRuntimeConfig(override)
  if (runtime.missingVars.length > 0) {
    throw new CashfreeGatewayError({
      message: `Cashfree config missing: ${runtime.missingVars.join(', ')}`,
      safeMessage: 'Payment gateway configuration is missing',
      safeCode: 'gateway_config_missing',
      statusCode: 503,
      details: {
        mode: runtime.mode,
        apiBaseUrl: runtime.apiBaseUrl,
        missingVars: runtime.missingVars,
      },
    })
  }

  const config = getConfig(override)
  const appUrl = resolveAppUrl()

  const request = {
    order_id: params.orderId,
    order_amount: params.orderAmount,
    order_currency: params.orderCurrency || 'INR',
    customer_details: {
      customer_id: params.customerDetails.customerId,
      customer_email: params.customerDetails.customerEmail,
      customer_phone: params.customerDetails.customerPhone,
      customer_name: params.customerDetails.customerName || '',
    },
    order_meta: {
      return_url: params.orderMeta?.returnUrl || `${appUrl}/payment/status?order_id={order_id}`,
      notify_url: params.orderMeta?.notifyUrl || `${appUrl}/api/payments/webhook`,
      payment_methods: params.orderMeta?.paymentMethods,
    },
    order_note: params.orderNote || '',
  }

  if (!request.order_id || typeof request.order_id !== 'string') {
    throw new CashfreeGatewayError({
      message: 'Missing order_id',
      safeMessage: 'Payment order request is invalid',
      safeCode: 'gateway_rejected',
      statusCode: 400,
      details: { invalidField: 'order_id' },
    })
  }
  if (!Number.isFinite(Number(request.order_amount)) || Number(request.order_amount) <= 0) {
    throw new CashfreeGatewayError({
      message: 'Invalid order_amount',
      safeMessage: 'Invalid payment amount',
      safeCode: 'invalid_price',
      statusCode: 400,
      details: { invalidField: 'order_amount', orderAmount: request.order_amount },
    })
  }
  if (request.order_currency !== 'INR') {
    throw new CashfreeGatewayError({
      message: 'Invalid order_currency',
      safeMessage: 'Payment order request is invalid',
      safeCode: 'gateway_rejected',
      statusCode: 400,
      details: { invalidField: 'order_currency', orderCurrency: request.order_currency },
    })
  }
  if (!request.customer_details.customer_id || !request.customer_details.customer_email || !request.customer_details.customer_phone) {
    throw new CashfreeGatewayError({
      message: 'Missing customer_details fields',
      safeMessage: 'Payment order request is invalid',
      safeCode: 'gateway_rejected',
      statusCode: 400,
      details: { invalidField: 'customer_details' },
    })
  }

  console.log('[CASHFREE CREATE]', redactForLog({
    paymentMode: runtime.paymentMode,
    envMode: runtime.mode,
    endpoint: runtime.apiBaseUrl,
    orderId: request.order_id,
    amount: request.order_amount,
    customerId: request.customer_details.customer_id,
    customerEmail: request.customer_details.customer_email,
    payload: {
      order_id: request.order_id,
      order_amount: request.order_amount,
      order_currency: request.order_currency,
      customer_details: {
        customer_id: request.customer_details.customer_id,
        customer_email: request.customer_details.customer_email,
        customer_phone: '[provided]',
      },
      order_meta: {
        return_url: request.order_meta.return_url,
        notify_url: request.order_meta.notify_url,
      },
    },
  }))

  let data: any
  try {
    data = await createOrderViaHttp(request as any, config)
  } catch (error: any) {
    const statusCode = Number(error?.response?.status || error?.statusCode || 502)
    const rawBody = error?.response?.data || error?.response || null
    const rawMessage = String(
      rawBody?.message ||
      rawBody?.error_description ||
      rawBody?.error ||
      error?.message ||
      'Cashfree request failed'
    )
    const lowered = rawMessage.toLowerCase()

    let safeMessage = 'Payment gateway rejected request'
    let safeCode = 'gateway_rejected'
    if (isWhitelistOrAuthError(rawMessage, Number.isInteger(statusCode) ? statusCode : 502, rawBody)) {
      safeMessage = 'Payment gateway not ready. Please try again later.'
      safeCode = 'gateway_not_ready'
    } else if (lowered.includes('timeout')) {
      safeMessage = 'Payment gateway timeout. Please try again'
      safeCode = 'gateway_timeout'
    } else if (lowered.includes('invalid') && lowered.includes('amount')) {
      safeMessage = 'Invalid payment amount'
      safeCode = 'invalid_price'
    }

    console.error('[CASHFREE ERROR]', redactForLog({
      paymentMode: runtime.paymentMode,
      envMode: runtime.mode,
      endpoint: runtime.apiBaseUrl,
      status: Number.isInteger(statusCode) ? statusCode : 502,
      body: rawBody,
      message: rawMessage,
    }))

    throw new CashfreeGatewayError({
      message: rawMessage,
      safeMessage,
      safeCode,
      statusCode: Number.isInteger(statusCode) ? statusCode : 502,
      details: {
        mode: runtime.mode,
        apiBaseUrl: runtime.apiBaseUrl,
        statusCode: Number.isInteger(statusCode) ? statusCode : 502,
        responseBody: rawBody,
      },
    })
  }

  return {
    cfOrderId: data.cf_order_id,
    orderId: data.order_id,
    entity: data.entity,
    orderCurrency: data.order_currency,
    orderAmount: Number(data.order_amount || 0),
    orderStatus: data.order_status,
    paymentSessionId: data.payment_session_id,
    orderExpiryTime: data.order_expiry_time,
    orderNote: data.order_note || null,
    createdAt: data.created_at,
    customerDetails: {
      customerId: data.customer_details?.customer_id,
      customerName: data.customer_details?.customer_name || null,
      customerEmail: data.customer_details?.customer_email,
      customerPhone: data.customer_details?.customer_phone,
    },
    payments: {
      url: data.payments?.url || '',
    },
  }
}

export async function getPaymentStatus(orderId: string, override?: CashfreeConfigOverride): Promise<PaymentStatus> {
  const config = getConfig(override)
  const res = await fetch(`${getCashfreeApiBaseUrl(config.mode)}/${encodeURIComponent(orderId)}`, {
    headers: {
      'x-api-version': config.apiVersion,
      'x-client-id': config.appId,
      'x-client-secret': config.secretKey,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error: any = new Error(`Cashfree HTTP error ${res.status}`)
    error.response = { status: res.status, data }
    throw error
  }

  return {
    orderId: data.order_id,
    cfOrderId: data.cf_order_id,
    orderStatus: data.order_status,
    orderAmount: Number(data.order_amount || 0),
    gatewayName: data.gateway_name || null,
    paymentTime: data.payment_time || null,
    paymentMethod: data.payment_method || null,
    paymentStatus: data.payment_status || null,
    bankReference: data.bank_reference || null,
  }
}

export async function testCashfreeAuthentication(config: any) {
  const startedAt = Date.now()
  const source = (config?.credentialsPlain && typeof config.credentialsPlain === "object" && !Array.isArray(config.credentialsPlain)
    ? config.credentialsPlain
    : (config?.credentials && typeof config.credentials === "object" && !Array.isArray(config.credentials))
      ? config.credentials
      : config) as Record<string, any>
  const appId = String(source.appId || source.clientId || source.CASHFREE_APP_ID || "").trim()
  const secretKey = String(source.secretKey || source.clientSecret || source.CASHFREE_SECRET_KEY || "").trim()
  const apiVersion = String(source.apiVersion || DEFAULT_CF_API_VERSION).trim()
  const mode = String(config?.environment || config?.mode || source?.mode || "sandbox").toLowerCase() === "production"
    ? "production" as const
    : "sandbox" as const

  if (!appId || !secretKey) {
    return { ok: false, code: "cashfree_credentials_missing", message: "Cashfree credentials are missing.", latencyMs: Date.now() - startedAt, status: null, response: null }
  }

  const endpoint = `${getCashfreeApiBaseUrl(mode)}/zws-probe-${Date.now().toString(36)}`
  let response: Response
  try {
    response = await fetch(endpoint, {
      headers: {
        "x-api-version": apiVersion,
        "x-client-id": appId,
        "x-client-secret": secretKey,
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error: any) {
    return {
      ok: false,
      code: "cashfree_probe_network_failed",
      message: String(error?.message || error || "Cashfree probe request failed.").slice(0, 500),
      latencyMs: Date.now() - startedAt,
      status: null,
      response: null,
    }
  }
  const body = await response.json().catch(() => null)
  const latencyMs = Date.now() - startedAt
  const sanitized = body && typeof body === "object" ? { code: body.code || null, message: body.message || null } : null

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "cashfree_auth_rejected",
      message: "Cashfree rejected the configured credentials.",
      latencyMs,
      status: response.status,
      response: sanitized,
    }
  }
  if (response.status === 404) {
    return {
      ok: true,
      code: "cashfree_auth_ready",
      message: "Cashfree credentials were accepted.",
      latencyMs,
      status: response.status,
      response: { probe: "order_lookup", expected: "order_not_found" },
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "cashfree_probe_failed",
      message: `Cashfree probe returned HTTP ${response.status}.`,
      latencyMs,
      status: response.status,
      response: sanitized,
    }
  }
  return {
    ok: true,
    code: "cashfree_auth_ready",
    message: "Cashfree credentials were accepted.",
    latencyMs,
    status: response.status,
    response: sanitized,
  }
}

export async function getOrderPayments(orderId: string, override?: CashfreeConfigOverride) {
  const config = getConfig(override)
  const res = await fetch(`${getCashfreeApiBaseUrl(config.mode)}/${encodeURIComponent(orderId)}/payments`, {
    headers: {
      'x-api-version': config.apiVersion,
      'x-client-id': config.appId,
      'x-client-secret': config.secretKey,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error: any = new Error(`Cashfree HTTP error ${res.status}`)
    error.response = { status: res.status, data }
    throw error
  }
  return Array.isArray(data) ? data : data?.data || []
}

/**
 * Cashfree signs payment webhooks with the merchant's API client secret
 * (HMAC-SHA256 over `${x-webhook-timestamp}${rawBody}`, base64) per Cashfree's
 * documented webhook signature verification. A dashboard-configured webhook
 * secret is also accepted when one is stored. Verification fails closed: every
 * candidate must be a real Cashfree credential, and the signature must match
 * at least one of them with a constant-time comparison.
 */
export function verifyWebhookSignature(
  payload: string,
  timestamp: string,
  signature: string,
  webhookSecretOverride?: string | string[],
): boolean {
  const candidates = (Array.isArray(webhookSecretOverride) ? webhookSecretOverride : [webhookSecretOverride])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  if (!candidates.length) {
    throw new Error('Cashfree webhook secret/client secret is not configured in payment gateway settings.')
  }
  const message = `${timestamp}${payload}`
  const incoming = Buffer.from(String(signature || ''), 'utf8')
  return candidates.some((candidate) => {
    const expected = crypto.createHmac('sha256', candidate).update(message).digest('base64')
    const expectedBuffer = Buffer.from(expected, 'utf8')
    return incoming.length === expectedBuffer.length && crypto.timingSafeEqual(incoming, expectedBuffer)
  })
}

/**
 * Cashfree sends `x-webhook-timestamp` as epoch milliseconds; tolerate epoch
 * seconds as well so the freshness check never false-rejects a fresh webhook.
 */
export function parseWebhookTimestampMs(timestamp: string): number | null {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function getCashfreeSdkUrl(modeInput?: string): string {
  const mode = resolvePaymentMode(modeInput) === 'production' ? 'production' : 'sandbox'
  return mode === 'production'
    ? 'https://sdk.cashfree.com/js/v3/cashfree.js'
    : 'https://sdk.cashfree.com/js/v3/cashfree-sandbox.js'
}

export function getCashfreeMode(modeInput?: string): CashfreeMode {
  const mode = resolvePaymentMode(modeInput)
  return mode === 'production' ? 'production' : 'sandbox'
}

export function getPaymentMode(modeInput?: string): PaymentMode {
  return resolvePaymentMode(modeInput)
}
