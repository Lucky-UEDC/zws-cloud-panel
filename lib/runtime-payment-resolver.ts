import { prisma } from "@/lib/db"
import { getBaseUrl, paymentCallbackUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"
import {
  ADMIN_PAYMENT_GATEWAYS,
  activePaymentGatewayCredentials,
  ensureAdminPaymentGateways,
  gatewayMissingCredentialFields,
} from "@/lib/payments/payment-gateway-admin"
import { validateGatewayRow } from "@/lib/payments/gateway-registry"

export type RuntimeGatewayCode = "razorpay" | "cashfree" | "phonepe"

export type RuntimeGatewayValidation = {
  ok: boolean
  gateway: string
  mode: "production" | "sandbox" | "test"
  missingFields: string[]
  webhookMissingFields: string[]
  credentials: Record<string, any>
}

export type UsableRuntimeGateway = RuntimeGatewayValidation & {
  id: string
  code: RuntimeGatewayCode
  gateway: RuntimeGatewayCode
  name: string
  enabled: boolean
  priority: number
  failsafeEnabled: boolean
  environment: "production" | "sandbox"
  paymentGatewayId: string
  credentialsPlain: Record<string, any>
  webhookUrl: string
  returnUrl: string
  lastHealthStatus?: string | null
  lastWebhookStatus?: string | null
  lastPaymentStatus?: string | null
  lastError?: string | null
}

type ResolverOptions = {
  request?: Request | { headers?: Headers | null } | null
  baseUrl?: string | null
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function normalizeGateway(value: unknown): RuntimeGatewayCode | "" {
  const gateway = String(value || "").trim().toLowerCase()
  return (ADMIN_PAYMENT_GATEWAYS as readonly string[]).includes(gateway) ? gateway as RuntimeGatewayCode : ""
}

function normalizeMode(value: unknown): "production" | "sandbox" | "test" {
  const mode = String(value || "").trim().toLowerCase()
  if (mode === "production" || mode === "live") return "production"
  if (mode === "sandbox") return "sandbox"
  return "test"
}

function normalizedCredentials(gateway: string, credentials: Record<string, any>, mode: string) {
  void mode
  if (gateway === "cashfree") {
    return {
      ...credentials,
      appId: firstString(credentials.appId, credentials.clientId, credentials.CASHFREE_APP_ID),
      secretKey: firstString(credentials.secretKey, credentials.clientSecret, credentials.CASHFREE_SECRET_KEY),
      webhookSecret: firstString(credentials.webhookSecret, credentials.CASHFREE_WEBHOOK_SECRET),
    }
  }
  if (gateway === "phonepe") {
    return {
      ...credentials,
      merchantId: firstString(credentials.merchantId, credentials.PHONEPE_MERCHANT_ID),
      clientId: firstString(credentials.clientId, credentials.PHONEPE_CLIENT_ID),
      clientSecret: firstString(credentials.clientSecret, credentials.PHONEPE_CLIENT_SECRET),
      clientVersion: firstString(credentials.clientVersion, credentials.PHONEPE_CLIENT_VERSION),
      webhookUsername: firstString(credentials.webhookUsername, credentials.PHONEPE_WEBHOOK_USERNAME),
      webhookPassword: firstString(credentials.webhookPassword, credentials.PHONEPE_WEBHOOK_PASSWORD),
      webhookSecret: firstString(credentials.webhookSecret, credentials.webhookPassword, credentials.PHONEPE_WEBHOOK_PASSWORD),
    }
  }
  if (gateway === "razorpay") {
    return {
      ...credentials,
      keyId: firstString(credentials.keyId, credentials.razorpayKeyId, credentials.RAZORPAY_KEY_ID),
      keySecret: firstString(credentials.keySecret, credentials.razorpayKeySecret, credentials.RAZORPAY_KEY_SECRET),
      webhookSecret: firstString(credentials.webhookSecret, credentials.razorpayWebhookSecret, credentials.RAZORPAY_WEBHOOK_SECRET),
    }
  }
  return credentials
}

export function validateGatewayRuntime(rowOrGateway: any): RuntimeGatewayValidation {
  const gateway = normalizeGateway(rowOrGateway?.code || rowOrGateway?.provider || rowOrGateway?.gateway || rowOrGateway?.type)
  const mode = normalizeMode(rowOrGateway?.mode || rowOrGateway?.environment)
  const rawCredentials = rowOrGateway?.credentialsPlain && typeof rowOrGateway.credentialsPlain === "object"
    ? rowOrGateway.credentialsPlain
    : activePaymentGatewayCredentials(rowOrGateway || {})
  const credentials = normalizedCredentials(gateway, rawCredentials as Record<string, any>, mode) as Record<string, any>
  const missingFields = gateway === "razorpay"
    ? ["keyId", "keySecret"].filter((key) => !credentials[key])
    : gateway === "cashfree"
    ? ["appId", "secretKey"].filter((key) => !credentials[key])
    : gateway === "phonepe"
      ? ["merchantId", "clientId", "clientSecret", "clientVersion"].filter((key) => !credentials[key])
      : ["gateway"]
  const webhookMissingFields = gateway === "razorpay"
    ? ["webhookSecret"].filter((key) => !credentials[key])
    : gateway === "cashfree"
    ? ["webhookSecret"].filter((key) => !credentials[key] && !credentials.secretKey)
    : gateway === "phonepe"
      ? ["webhookUsername", "webhookPassword"].filter((key) => !credentials[key])
      : []
  const modeValid = ["production", "sandbox", "test"].includes(mode)
  return {
    ok: Boolean(gateway) && modeValid && missingFields.length === 0,
    gateway,
    mode,
    missingFields: modeValid ? missingFields : [...missingFields, "mode"],
    webhookMissingFields,
    credentials,
  }
}

function runtimeBaseUrl(options: ResolverOptions) {
  return String(options.baseUrl || getBaseUrl(options.request || null)).replace(/\/+$/, "")
}

export function runtimeGatewayFromRow(row: any, options: ResolverOptions = {}): UsableRuntimeGateway | null {
  const code = normalizeGateway(row?.code || row?.provider)
  if (!code) return null
  const validation = validateGatewayRuntime(row)
  const baseUrl = runtimeBaseUrl(options)
  const environment = validation.mode === "production" ? "production" : "sandbox"
  return {
    ...validation,
    id: row.id,
    code,
    gateway: code,
    name: row.name || code,
    enabled: Boolean(row.enabled ?? row.active),
    priority: Number(row.priority || 100),
    failsafeEnabled: Boolean(row.failsafeEnabled),
    environment,
    paymentGatewayId: row.id,
    credentialsPlain: validation.credentials,
    webhookUrl: paymentWebhookUrl(code, baseUrl),
    returnUrl: paymentCallbackUrl(code, baseUrl),
    lastHealthStatus: row.lastHealthStatus || null,
    lastWebhookStatus: row.lastWebhookStatus || null,
    lastPaymentStatus: row.lastPaymentStatus || null,
    lastError: row.lastError || null,
  }
}

export async function getPaymentGatewayRows() {
  await ensureAdminPaymentGateways()
  return (prisma as any).paymentGateway.findMany({
    where: {
      OR: [
        ...ADMIN_PAYMENT_GATEWAYS.map((code) => ({ code })),
        ...ADMIN_PAYMENT_GATEWAYS.map((provider) => ({ provider })),
      ],
    },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
  }).catch(() => [])
}

export async function getUsableGateways(options: ResolverOptions = {}) {
  const rows = await getPaymentGatewayRows()
  const baseUrl = runtimeBaseUrl(options)
  const seen = new Set<string>()
  const accepted: UsableRuntimeGateway[] = []
  for (const row of rows) {
    const gateway = runtimeGatewayFromRow(row, options)
    const validation = validateGatewayRow(row, baseUrl)
    const provider = validation.provider || String(row?.provider || row?.code || "unknown")
    const circuitOpen = Boolean(row?.circuitOpenedAt)
    const duplicate = Boolean(gateway && seen.has(gateway.gateway))
    const acceptedCandidate = Boolean(gateway && validation.ok && !circuitOpen && !duplicate)
    if (gateway && !duplicate) seen.add(gateway.gateway)
    const reason = duplicate
      ? "Duplicate provider row rejected."
      : circuitOpen
        ? "Gateway circuit is open."
        : validation.reason
    const logMetadata = {
      gatewayId: row?.id || null,
      provider,
      enabled: validation.enabled,
      priority: validation.priority,
      mode: validation.mode,
      credentialSource: "database",
      credentialsDecrypted: Object.keys(validation.credentials).length > 0,
      publicKeyPresent: Boolean((validation.credentials as any).keyId),
      secretPresent: Boolean((validation.credentials as any).keySecret || (validation.credentials as any).clientSecret || (validation.credentials as any).secretKey),
      webhookStatus: validation.webhookMissingFields.length ? "missing" : "configured",
      webhookUrlValid: validation.webhookUrlValid,
      circuitOpen,
      runtimeOk: acceptedCandidate,
      reason,
      code: circuitOpen ? "gateway_circuit_open" : duplicate ? "gateway_duplicate" : validation.code,
    }
    console.info("[PaymentGatewayRuntime] candidate", logMetadata)
    await prisma.gatewayLog.create({
      data: {
        gateway: provider,
        action: "runtime_validation",
        status: acceptedCandidate ? "accepted" : "rejected",
        safeMessage: reason,
        metadata: logMetadata as any,
      },
    }).catch((error: any) => {
      console.error("[PaymentGatewayRuntime] validation log failed", { gatewayId: row?.id || null, message: error?.message || String(error) })
    })
    if (gateway && acceptedCandidate) accepted.push(gateway)
  }
  return accepted.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}

export function gatewayMissingRuntimeFields(rowOrGateway: any) {
  return validateGatewayRuntime(rowOrGateway).missingFields
}

export function gatewayWebhookMissingRuntimeFields(rowOrGateway: any) {
  return validateGatewayRuntime(rowOrGateway).webhookMissingFields
}
