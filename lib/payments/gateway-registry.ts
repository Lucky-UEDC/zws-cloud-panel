import { paymentWebhookUrl } from "@/lib/runtime-site-url"
import { activePaymentGatewayCredentials } from "@/lib/payments/payment-gateway-admin"

export const GATEWAY_PROVIDERS = ["razorpay", "phonepe", "cashfree"] as const
export type GatewayProvider = typeof GATEWAY_PROVIDERS[number]

export type GatewayValidationResult = {
  ok: boolean
  provider: GatewayProvider | ""
  enabled: boolean
  priority: number
  mode: "production" | "sandbox"
  credentials: Record<string, unknown>
  requiredFields: string[]
  missingFields: string[]
  webhookFields: string[]
  webhookMissingFields: string[]
  webhookUrl: string
  webhookUrlValid: boolean
  reason: string
  code: string
}

export type GatewayRuntimeCandidate = GatewayValidationResult & {
  id: string
  name: string
  failsafeEnabled: boolean
  circuitOpen: boolean
  lastHealthStatus?: string | null
  lastWebhookStatus?: string | null
  lastPaymentStatus?: string | null
  lastError?: string | null
}

type ProviderDefinition = {
  provider: GatewayProvider
  requiredFields: readonly string[]
  webhookFields: readonly string[]
  normalize(credentials: Record<string, unknown>): Record<string, unknown>
  publicCredentials(credentials: Record<string, unknown>): Record<string, string>
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

const registry: Record<GatewayProvider, ProviderDefinition> = {
  razorpay: {
    provider: "razorpay",
    requiredFields: ["keyId", "keySecret"],
    webhookFields: ["webhookSecret"],
    normalize(credentials) {
      return {
        ...credentials,
        keyId: firstString(credentials.keyId, credentials.razorpayKeyId, credentials.RAZORPAY_KEY_ID),
        keySecret: firstString(credentials.keySecret, credentials.razorpayKeySecret, credentials.RAZORPAY_KEY_SECRET),
        webhookSecret: firstString(credentials.webhookSecret, credentials.razorpayWebhookSecret, credentials.RAZORPAY_WEBHOOK_SECRET),
      }
    },
    publicCredentials(credentials) {
      return { publicKey: firstString(credentials.keyId) }
    },
  },
  phonepe: {
    provider: "phonepe",
    requiredFields: ["merchantId", "clientId", "clientSecret", "clientVersion"],
    webhookFields: ["webhookUsername", "webhookPassword"],
    normalize(credentials) {
      return {
        ...credentials,
        merchantId: firstString(credentials.merchantId, credentials.PHONEPE_MERCHANT_ID),
        clientId: firstString(credentials.clientId, credentials.PHONEPE_CLIENT_ID),
        clientSecret: firstString(credentials.clientSecret, credentials.PHONEPE_CLIENT_SECRET),
        clientVersion: firstString(credentials.clientVersion, credentials.PHONEPE_CLIENT_VERSION),
        webhookUsername: firstString(credentials.webhookUsername, credentials.PHONEPE_WEBHOOK_USERNAME),
        webhookPassword: firstString(credentials.webhookPassword, credentials.PHONEPE_WEBHOOK_PASSWORD),
      }
    },
    publicCredentials() {
      return {}
    },
  },
  cashfree: {
    provider: "cashfree",
    requiredFields: ["appId", "secretKey"],
    webhookFields: ["webhookSecret"],
    normalize(credentials) {
      return {
        ...credentials,
        appId: firstString(credentials.appId, credentials.clientId, credentials.CASHFREE_APP_ID),
        secretKey: firstString(credentials.secretKey, credentials.clientSecret, credentials.CASHFREE_SECRET_KEY),
        webhookSecret: firstString(credentials.webhookSecret, credentials.CASHFREE_WEBHOOK_SECRET),
      }
    },
    publicCredentials() {
      return {}
    },
  },
}

export function normalizeGatewayProvider(value: unknown): GatewayProvider | "" {
  const provider = String(value || "").trim().toLowerCase()
  return (GATEWAY_PROVIDERS as readonly string[]).includes(provider) ? provider as GatewayProvider : ""
}

export function gatewayProviderDefinition(value: unknown) {
  const provider = normalizeGatewayProvider(value)
  return provider ? registry[provider] : null
}

export function validateGatewayRow(row: any, baseUrl: string): GatewayValidationResult {
  const provider = normalizeGatewayProvider(row?.provider || row?.code)
  if (!provider) {
    return {
      ok: false,
      provider: "",
      enabled: false,
      priority: Number(row?.priority || 100),
      mode: "sandbox",
      credentials: {},
      requiredFields: [],
      missingFields: ["provider"],
      webhookFields: [],
      webhookMissingFields: [],
      webhookUrl: "",
      webhookUrlValid: false,
      reason: "Unsupported payment gateway provider.",
      code: "gateway_provider_unsupported",
    }
  }
  const definition = registry[provider]
  const credentials = definition.normalize(activePaymentGatewayCredentials(row))
  const requiredFields = [...definition.requiredFields]
  const webhookFields = [...definition.webhookFields]
  const missingFields = requiredFields.filter((field) => !firstString(credentials[field]))
  const webhookMissingFields = webhookFields.filter((field) => !firstString(credentials[field]))
  const mode = String(row?.mode || "").toLowerCase() === "production" ? "production" : "sandbox"
  const webhookUrl = paymentWebhookUrl(provider, baseUrl)
  let webhookUrlValid = false
  try {
    webhookUrlValid = new URL(webhookUrl).protocol === "https:"
  } catch {
    webhookUrlValid = false
  }
  const enabled = Boolean(row?.enabled ?? row?.active)
  const ok = enabled && missingFields.length === 0 && webhookMissingFields.length === 0 && webhookUrlValid
  const code = !enabled
    ? "gateway_disabled"
    : missingFields.length
      ? "gateway_credentials_missing"
      : webhookMissingFields.length
        ? "gateway_webhook_credentials_missing"
        : !webhookUrlValid
          ? "gateway_webhook_url_invalid"
          : "gateway_runtime_valid"
  const reason = !enabled
    ? "Gateway is disabled."
    : missingFields.length
      ? `Missing credentials: ${missingFields.join(", ")}.`
      : webhookMissingFields.length
        ? `Missing webhook credentials: ${webhookMissingFields.join(", ")}.`
        : !webhookUrlValid
          ? "Webhook URL must use HTTPS."
          : "Gateway runtime validation passed."
  return {
    ok,
    provider,
    enabled,
    priority: Math.max(1, Number(row?.priority || 100)),
    mode,
    credentials,
    requiredFields,
    missingFields,
    webhookFields,
    webhookMissingFields,
    webhookUrl,
    webhookUrlValid,
    reason,
    code,
  }
}

export function publicGatewayCredentials(provider: GatewayProvider, credentials: Record<string, unknown>) {
  return registry[provider].publicCredentials(credentials)
}
