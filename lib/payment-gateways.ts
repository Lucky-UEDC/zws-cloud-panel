import crypto from "node:crypto"
import { createPaymentOrder, verifyWebhookSignature } from "@/lib/cashfree"
import { createPhonePePaymentSession, normalizePhonePeWebhook, verifyPhonePeWebhookRawBody } from "@/lib/phonepe"
import { verifyRazorpayWebhookSignature, normalizeRazorpayCredentials } from "@/lib/razorpay"
import type { PaymentSettings } from "@/lib/settings"
import { decryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"

export type NormalizedPaymentWebhook = {
  gateway: "cashfree" | "phonepe" | "razorpay"
  eventId: string
  eventType: string
  gatewayOrderId: string
  gatewayPaymentId: string | null
  status: "success" | "failed" | "pending"
  amount: number
  currency?: string | null
  paymentMethod?: string | null
  raw: any
}

export function rawBodyHash(rawBody: string) {
  return crypto.createHash("sha256").update(rawBody).digest("hex")
}

export function normalizeCashfreeWebhook(payload: any): NormalizedPaymentWebhook {
  const order = payload?.data?.order || {}
  const payment = payload?.data?.payment || {}
  const type = String(payload?.type || "")
  const status = type === "PAYMENT_SUCCESS_WEBHOOK"
    ? "success"
    : type === "PAYMENT_FAILED_WEBHOOK"
      ? "failed"
      : "pending"
  return {
    gateway: "cashfree",
    eventId: String(payment.cf_payment_id || order.cf_order_id || order.order_id || rawBodyHash(JSON.stringify(payload))),
    eventType: type,
    gatewayOrderId: String(order.cf_order_id || order.order_id || ""),
    gatewayPaymentId: payment.cf_payment_id ? String(payment.cf_payment_id) : null,
    status,
    amount: Number(payment.payment_amount || order.order_amount || 0),
    paymentMethod: payment.payment_method ? Object.keys(payment.payment_method)[0] || null : null,
    raw: payload,
  }
}

export function verifyCashfreeRawBody(rawBody: string, headers: Headers, settings: PaymentSettings) {
  const signature = headers.get("x-webhook-signature") || ""
  const timestamp = headers.get("x-webhook-timestamp") || ""
  const secret = settings.cashfreeWebhookSecret || settings.cashfreeSecretKey
  if (!secret) return true
  return verifyWebhookSignature(rawBody, timestamp, signature, secret)
}

export function normalizeGatewayWebhook(gateway: "cashfree" | "phonepe", rawBody: string) {
  const payload = JSON.parse(rawBody)
  return gateway === "phonepe"
    ? { gateway: "phonepe" as const, ...normalizePhonePeWebhook(payload) }
    : normalizeCashfreeWebhook(payload)
}

export function verifyGatewayWebhookRawBody(gateway: "cashfree" | "phonepe", rawBody: string, headers: Headers, settings: PaymentSettings) {
  if (gateway === "phonepe") {
    return verifyPhonePeWebhookRawBody(rawBody, headers.get("authorization") || "", {
      webhookUsername: (settings as any).phonepeWebhookUsername || "",
      webhookPassword: (settings as any).phonepeWebhookPassword || settings.phonepeWebhookSecret || "",
    })
  }
  return verifyCashfreeRawBody(rawBody, headers, settings)
}

export function gatewayCredentials(config: any) {
  if (config?.credentialsPlain && typeof config.credentialsPlain === "object" && !Array.isArray(config.credentialsPlain)) {
    return config.credentialsPlain as Record<string, any>
  }
  if (config?.configEncrypted && config?.configIv && config?.configTag) {
    return decryptGatewayCredentials({
      credentialsEnc: config.configEncrypted,
      credentialsIv: config.configIv,
      credentialsTag: config.configTag,
    }) as Record<string, any>
  }
  return decryptGatewayCredentials(config || {}) as Record<string, any>
}

export function gatewayMode(config: any) {
  return String(config?.environment || "sandbox").toLowerCase() === "production" ? "production" : "sandbox"
}

export function verifyDomainGatewayWebhookRawBody(gateway: "cashfree" | "phonepe" | "razorpay", rawBody: string, headers: Headers, gatewayConfig: any) {
  const credentials = gatewayCredentials(gatewayConfig)
  if (gateway === "razorpay") {
    return verifyRazorpayWebhookSignature(rawBody, headers.get("x-razorpay-signature"), normalizeRazorpayCredentials(gatewayConfig).webhookSecret)
  }
  if (gateway === "phonepe") {
    const authHeader = headers.get("authorization") || ""
    const verified = verifyPhonePeWebhookRawBody(rawBody, authHeader, {
      webhookUsername: String(credentials.webhookUsername || ""),
      webhookPassword: String(credentials.webhookPassword || ""),
    })
    if (!verified) {
      console.warn("[Payments][Webhook] PhonePe verification failed", {
        hasAuthorization: Boolean(authHeader),
        hasWebhookUsername: Boolean(String(credentials.webhookUsername || "")),
        hasWebhookPassword: Boolean(String(credentials.webhookPassword || "")),
        gatewayConfigId: gatewayConfig?.id || null,
      })
    }
    return verified
  }
  const secret = String(credentials.webhookSecret || credentials.secretKey || "")
  if (!secret) {
    console.warn("[Payments][Webhook] Cashfree verification failed: missing webhook secret", {
      gatewayConfigId: gatewayConfig?.id || null,
      hasSignature: Boolean(headers.get("x-webhook-signature")),
      hasTimestamp: Boolean(headers.get("x-webhook-timestamp")),
    })
    return false
  }
  const verified = verifyWebhookSignature(
    rawBody,
    headers.get("x-webhook-timestamp") || "",
    headers.get("x-webhook-signature") || "",
    secret,
  )
  if (!verified) {
    console.warn("[Payments][Webhook] Cashfree verification failed: signature mismatch", {
      gatewayConfigId: gatewayConfig?.id || null,
      hasSignature: Boolean(headers.get("x-webhook-signature")),
      hasTimestamp: Boolean(headers.get("x-webhook-timestamp")),
    })
  }
  return verified
}

export function resolveGatewayPriority(settings: PaymentSettings) {
  const priority = settings.gatewayPriority || "phonepe_first"
  if (priority === "manual_only" || settings.defaultGateway === "manual") return ["manual"] as const
  if (priority === "phonepe_only") return ["phonepe"] as const
  if (priority === "cashfree_only") return ["cashfree"] as const
  if (priority === "cashfree_first") return settings.allowFallbackGateway ? ["cashfree", "phonepe"] as const : ["cashfree"] as const
  return settings.allowFallbackGateway ? ["phonepe", "cashfree"] as const : ["phonepe"] as const
}

export async function createGatewayPaymentSession(args: {
  gateway: "cashfree" | "phonepe"
  orderId: string
  amount: number
  customerDetails: { customerId: string; customerEmail: string; customerPhone: string; customerName?: string | null }
  orderNote: string
  appUrl: string
}, settings: PaymentSettings) {
  if (args.gateway === "phonepe") {
    const session = await createPhonePePaymentSession({
      orderId: args.orderId,
      amount: args.amount,
      customerId: args.customerDetails.customerId,
      customerPhone: args.customerDetails.customerPhone,
      redirectUrl: `${args.appUrl}/payment/status?order_id=${encodeURIComponent(args.orderId)}`,
      callbackUrl: settings.phonepeCallbackUrl || settings.phonepeWebhookUrl || `${args.appUrl}/api/payments/webhook?gateway=phonepe`,
    }, {
      merchantId: settings.phonepeMerchantId || "",
      clientId: settings.phonepeClientId || "",
      clientSecret: settings.phonepeClientSecret || "",
      clientVersion: settings.phonepeApiVersion || "",
      webhookSecret: settings.phonepeWebhookSecret || "",
      environment: settings.phonepeEnvironment || "sandbox",
    })
    return {
      gateway: "phonepe" as const,
      gatewayOrderId: session.gatewayOrderId,
      gatewaySessionId: null,
      redirectUrl: session.redirectUrl,
      raw: session.raw,
    }
  }

  const session = await createPaymentOrder({
    orderId: args.orderId,
    orderAmount: args.amount,
    customerDetails: {
      ...args.customerDetails,
      customerName: args.customerDetails.customerName || undefined,
    },
    orderNote: args.orderNote,
    orderMeta: {
      returnUrl: settings.cashfreeCallbackUrl || `${args.appUrl}/payment/status?order_id={order_id}`,
      notifyUrl: settings.cashfreeWebhookUrl || `${args.appUrl}/api/payments/webhook?gateway=cashfree`,
    },
  }, {
    appId: settings.cashfreeAppId || undefined,
    secretKey: settings.cashfreeSecretKey || undefined,
    mode: (settings.paymentMode === "production" || settings.cashfreeEnvironment === "production" ? "production" : "sandbox") as any,
    apiVersion: settings.cashfreeApiVersion || undefined,
  })
  return {
    gateway: "cashfree" as const,
    gatewayOrderId: session.cfOrderId,
    gatewaySessionId: session.paymentSessionId,
    redirectUrl: session.payments.url,
    raw: session,
  }
}

export async function createDomainGatewayPaymentSession(args: {
  gateway: "cashfree" | "phonepe" | "razorpay"
  orderId: string
  amount: number
  currency?: string | null
  customerDetails: { customerId: string; customerEmail?: string; customerPhone: string; customerName?: string | null }
  orderNote: string
  returnUrl: string
  webhookUrl: string
  gatewayConfig: any
  invoiceId?: string | null
  invoiceNumber?: string | null
}) {
  const { getGatewayDriver } = await import("@/lib/payments/gateway-drivers")
  const driver = getGatewayDriver(args.gateway)
  const session = await driver.initialize({
    merchantOrderId: args.orderId,
    amount: args.amount,
    currency: String(args.currency || "INR").toUpperCase(),
    customer: { id: args.customerDetails.customerId, email: args.customerDetails.customerEmail, phone: args.customerDetails.customerPhone, name: args.customerDetails.customerName },
    description: args.orderNote,
    returnUrl: args.returnUrl,
    webhookUrl: args.webhookUrl,
    gatewayConfig: args.gatewayConfig,
    invoiceId: args.invoiceId,
    invoiceNumber: args.invoiceNumber,
  })
  return session
}
