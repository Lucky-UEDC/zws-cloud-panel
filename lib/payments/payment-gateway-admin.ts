import { prisma } from "@/lib/db"
import { decryptGatewayCredentials, encryptGatewayCredentials, maskGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"
import { publicOrigin } from "@/lib/public-url"
import { paymentCallbackUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"

export const ADMIN_PAYMENT_GATEWAYS = ["razorpay", "phonepe", "cashfree"] as const
export type AdminPaymentGatewayCode = typeof ADMIN_PAYMENT_GATEWAYS[number]

export function normalizePaymentGatewayProvider(value: unknown): AdminPaymentGatewayCode | "" {
  const provider = String(value || "").trim().toLowerCase()
  return (ADMIN_PAYMENT_GATEWAYS as readonly string[]).includes(provider) ? provider as AdminPaymentGatewayCode : ""
}

export function defaultGatewayName(provider: string) {
  if (provider === "razorpay") return "Razorpay"
  if (provider === "cashfree") return "Cashfree"
  if (provider === "phonepe") return "PhonePe"
  return provider.charAt(0).toUpperCase() + provider.slice(1)
}

function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isMasked(value: unknown) {
  return typeof value === "string" && /^[•*]+$/.test(value)
}

function normalizeMode(value: unknown) {
  const mode = String(value || "").trim().toLowerCase()
  return mode === "production" || mode === "live" ? "production" : "test"
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function encryptedConfigFromRow(row: any) {
  if (row?.configEncrypted && row?.configIv && row?.configTag) {
    return {
      credentialsEnc: row.configEncrypted,
      credentialsIv: row.configIv,
      credentialsTag: row.configTag,
    }
  }
  const credentials = jsonObject(row?.credentials)
  if (credentials.credentialsEnc && credentials.credentialsIv && credentials.credentialsTag) {
    return {
      credentialsEnc: String(credentials.credentialsEnc),
      credentialsIv: String(credentials.credentialsIv),
      credentialsTag: String(credentials.credentialsTag),
    }
  }
  return null
}

export function decryptPaymentGatewayCredentials(row: any) {
  const encrypted = encryptedConfigFromRow(row)
  if (encrypted) return decryptGatewayCredentials(encrypted)
  return jsonObject(row?.credentials)
}

export function activePaymentGatewayCredentials(row: any) {
  const credentials = decryptPaymentGatewayCredentials(row)
  const mode = normalizeMode(row?.mode || row?.environment)
  const provider = String(row?.code || row?.provider).toLowerCase()
  if (provider === "cashfree") {
    return {
      ...credentials,
      appId: firstString(credentials.appId, credentials.clientId, credentials.CASHFREE_APP_ID),
      secretKey: firstString(credentials.secretKey, credentials.clientSecret, credentials.CASHFREE_SECRET_KEY),
      webhookSecret: firstString(credentials.webhookSecret, credentials.CASHFREE_WEBHOOK_SECRET),
    }
  }
  if (provider === "phonepe") {
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
  if (provider === "razorpay") {
    return {
      ...credentials,
      keyId: firstString(credentials.keyId, credentials.razorpayKeyId, credentials.RAZORPAY_KEY_ID),
      keySecret: firstString(credentials.keySecret, credentials.razorpayKeySecret, credentials.RAZORPAY_KEY_SECRET),
      webhookSecret: firstString(credentials.webhookSecret, credentials.razorpayWebhookSecret, credentials.RAZORPAY_WEBHOOK_SECRET),
    }
  }
  return credentials
}

/**
 * Resolve the enabled payment_gateways row for a gateway code as an in-memory
 * gateway config. Used by webhook verification and server-side reconciliation
 * when a payment attempt has no linked gatewayConfig row yet. Never returns
 * credentials for a different gateway.
 */
export async function fallbackGatewayConfig(gateway: "cashfree" | "phonepe" | "razorpay", host?: string | null) {
  const row = await prisma.paymentGateway.findFirst({
    where: { OR: [{ code: gateway }, { provider: gateway }], enabled: true },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
  }).catch(() => null)
  if (!row) return null
  return {
    id: null,
    gateway,
    enabled: true,
    environment: normalizeMode(row?.mode || row?.environment),
    approvedPaymentDomain: host || null,
    credentialsPlain: activePaymentGatewayCredentials(row),
  }
}

export function mergeGatewayCredentials(existing: any, incoming: unknown) {
  const previous = decryptPaymentGatewayCredentials(existing || {})
  const provider = String(existing?.code || existing?.provider || "").toLowerCase()
  const nonSecret = nonSecretGatewayCredentialFields(provider)
  const next = { ...previous }
  if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
    for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
      if (value == null) continue
      if (nonSecret.includes(key)) {
        next[key] = value
        continue
      }
      if (value === "" || isMasked(value)) continue
      next[key] = value
    }
  }
  return next
}

function encryptGatewayConfig(credentials: Record<string, unknown>) {
  const encrypted = encryptGatewayCredentials(credentials)
  return {
    configEncrypted: encrypted.credentialsEnc,
    configIv: encrypted.credentialsIv,
    configTag: encrypted.credentialsTag,
  }
}

function activeWebhookSecret(credentials: Record<string, unknown>, mode: string) {
  void mode
  return firstString(
    credentials.webhookSecret,
    credentials.webhookPassword,
  )
}

function encryptWebhookSecret(credentials: Record<string, unknown>, mode: string) {
  const secret = activeWebhookSecret(credentials, mode)
  if (!secret) return { webhookSecretEncrypted: null, webhookSecretIv: null, webhookSecretTag: null }
  const encrypted = encryptGatewayCredentials({ webhookSecret: secret })
  return {
    webhookSecretEncrypted: encrypted.credentialsEnc,
    webhookSecretIv: encrypted.credentialsIv,
    webhookSecretTag: encrypted.credentialsTag,
  }
}

export async function getPrimaryDomainForGatewayAdmin() {
  const primary = await getPrimaryPaymentDomain().catch(() => null)
  if (primary) return primary
  return prisma.domainConfig.findFirst({ where: { isActive: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] })
}

export async function ensureAdminPaymentGateways() {
  for (const [index, code] of ADMIN_PAYMENT_GATEWAYS.entries()) {
    await (prisma as any).paymentGateway.upsert({
      where: { provider_environment: { provider: code, environment: "global" } },
      update: {
        code,
      },
      create: {
        name: defaultGatewayName(code),
        provider: code,
        environment: "global",
        active: false,
        primary: false,
        credentials: {},
        code,
        enabled: false,
        mode: "test",
        priority: 10 + index * 10,
        failsafeEnabled: true,
        lastHealthStatus: "unknown",
      },
    }).catch(() => null)
  }
}

function gatewayUrls(row: any, primaryDomain: any, baseUrl?: string | null) {
  const origin = String(baseUrl || primaryDomain?.appBaseUrl || publicOrigin() || "").replace(/\/$/, "")
  const code = String(row.code || row.provider || "").toLowerCase()
  return {
    callbackUrl: origin ? paymentCallbackUrl(code, origin) : "",
    webhookUrl: origin ? paymentWebhookUrl(code, origin) : "",
  }
}

export function serializePaymentGateway(row: any, primaryDomain?: any, baseUrl?: string | null) {
  const code = String(row.code || row.provider || "").toLowerCase()
  const credentials = decryptPaymentGatewayCredentials(row)
  const urls = gatewayUrls(row, primaryDomain, baseUrl)
  const missingFields = gatewayMissingCredentialFields(row)
  const enabled = Boolean(row.enabled ?? row.active)
  const lastHealth = String(row.lastHealthStatus || "").toLowerCase()
  const runtimeReady = enabled && missingFields.length === 0 && !["error", "down", "disabled", "signature_failed"].includes(lastHealth)
  const healthState = !enabled
    ? "disabled"
    : missingFields.length > 0
      ? "warning"
      : ["error", "down", "disabled", "signature_failed"].includes(lastHealth)
        ? "error"
        : ["unknown", "degraded", "warning"].includes(lastHealth)
          ? "warning"
          : "healthy"
  return {
    id: row.id,
    code,
    provider: code,
    name: row.name || defaultGatewayName(code),
    displayName: row.name || defaultGatewayName(code),
    enabled,
    active: enabled,
    mode: normalizeMode(row.mode || row.environment),
    environment: normalizeMode(row.mode || row.environment),
    priority: Number(row.priority || 100),
    failsafeEnabled: Boolean(row.failsafeEnabled),
    failsafe_enabled: Boolean(row.failsafeEnabled),
    credentials: Object.fromEntries(
      Object.keys(credentials).map((key) => [
        key,
        credentials[key] ? (nonSecretGatewayCredentialFields(code)?.includes(key) ? credentials[key] : "••••••••") : "",
      ]),
    ),
    callbackUrl: urls.callbackUrl,
    webhookUrl: urls.webhookUrl,
    missingCredentialFields: missingFields,
    credentialsStatus: missingFields.length ? "incomplete" : "configured",
    runtimeStatus: runtimeReady ? "ready" : enabled ? "unavailable" : "disabled",
    healthState,
    lastHealthStatus: row.lastHealthStatus || "unknown",
    lastTestAt: row.lastHealthCheckedAt || null,
    lastWebhookStatus: row.lastWebhookStatus || null,
    lastPaymentStatus: row.lastPaymentStatus || null,
    lastError: row.lastError || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function gatewayRequiredCredentialFields(gateway: string, mode = "test") {
  void mode
  if (gateway === "razorpay") return ["keyId", "keySecret", "webhookSecret"]
  if (gateway === "cashfree") return ["appId", "secretKey"]
  if (gateway === "phonepe") return ["merchantId", "clientId", "clientSecret", "clientVersion"]
  return []
}

const GATEWAY_BRANDING_FIELDS = ["merchantName", "themeColor", "logo", "logoUrl"]

export function nonSecretGatewayCredentialFields(gateway: string) {
  if (gateway === "razorpay") return ["keyId", ...GATEWAY_BRANDING_FIELDS]
  if (gateway === "cashfree") return ["appId", "apiVersion", "clientVersion", "env", ...GATEWAY_BRANDING_FIELDS]
  if (gateway === "phonepe") return ["merchantId", ...GATEWAY_BRANDING_FIELDS]
  return []
}

export function isSecretGatewayCredentialField(gateway: string, field: string) {
  return !nonSecretGatewayCredentialFields(gateway)?.includes(field)
}

export function gatewayMissingCredentialFields(rowOrGateway: any, maybeCredentials?: Record<string, unknown>, maybeMode?: string) {
  const gateway = typeof rowOrGateway === "string"
    ? rowOrGateway
    : String(rowOrGateway?.code || rowOrGateway?.provider || rowOrGateway?.gateway || "")
  const mode = maybeMode || (typeof rowOrGateway === "string" ? "test" : normalizeMode(rowOrGateway?.mode || rowOrGateway?.environment))
  const credentials = maybeCredentials || activePaymentGatewayCredentials(rowOrGateway)
  return gatewayRequiredCredentialFields(gateway, mode).filter((key) => !credentials[key])
}

export function paymentGatewayToDomainConfig(row: any) {
  const code = String(row.code || row.provider || "").toLowerCase()
  return {
    id: null,
    paymentGatewayId: row.id,
    gateway: code,
    enabled: Boolean(row.enabled ?? row.active),
    priority: Number(row.priority || 100),
    environment: normalizeMode(row.mode || row.environment) === "production" ? "production" : "sandbox",
    displayName: row.name || defaultGatewayName(code),
    failsafeEnabled: Boolean(row.failsafeEnabled),
    credentialsPlain: activePaymentGatewayCredentials(row),
    credentialsEnc: row.configEncrypted || null,
    credentialsIv: row.configIv || null,
    credentialsTag: row.configTag || null,
    webhookUrl: row.webhookUrl || null,
    returnUrl: row.callbackUrl || null,
    extraConfig: {},
    lastHealthStatus: row.lastHealthStatus || "unknown",
  }
}

export async function listEnabledAdminGatewayCandidates() {
  await ensureAdminPaymentGateways()
  const rows = await (prisma as any).paymentGateway.findMany({
    where: {
      OR: [...ADMIN_PAYMENT_GATEWAYS.map((code) => ({ code })), ...ADMIN_PAYMENT_GATEWAYS.map((provider) => ({ provider }))],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  }).catch(() => [])

  const seen = new Set<string>()
  const candidates = []
  for (const row of rows) {
    const code = String(row.code || row.provider || "").toLowerCase()
    if (!(ADMIN_PAYMENT_GATEWAYS as readonly string[]).includes(code) || seen.has(code)) continue
    seen.add(code)
    if (!Boolean(row.enabled ?? row.active)) continue
    if (["down", "disabled"].includes(String(row.lastHealthStatus || "").toLowerCase())) continue
    if (gatewayMissingCredentialFields(row).length > 0) continue
    candidates.push(paymentGatewayToDomainConfig(row))
  }
  return candidates
}

export async function syncPaymentGatewayCompatibility(row: any, incomingCredentials: Record<string, unknown>) {
  void row
  void incomingCredentials
  return null
}

export async function syncPaymentGatewayCompatibilityLegacy(row: any, incomingCredentials: Record<string, unknown>) {
  const domain = await getPrimaryDomainForGatewayAdmin()
  if (!domain) return
  const provider = normalizePaymentGatewayProvider(row.code || row.provider)
  if (!provider) return
  const primaryDomain = normalizePaymentDomain(domain.domain)
  const environment = normalizeMode(row.mode || row.environment) === "production" ? "production" : "sandbox"
  const origin = String(domain.appBaseUrl || publicOrigin() || "").replace(/\/$/, "")
  const webhookUrl = paymentWebhookUrl(provider, origin)
  const returnUrl = `${origin}/payment/status?order_id={order_id}`
  const credentials = Object.keys(incomingCredentials || {}).length ? incomingCredentials : activePaymentGatewayCredentials(row)
  const encrypted = encryptGatewayCredentials(credentials)
  const extraConfig = {
    paymentGatewayId: row.id,
    source: "payment_gateway_admin",
    lastHealthStatus: row.lastHealthStatus || "unknown",
    lastWebhookStatus: row.lastWebhookStatus || null,
    lastPaymentStatus: row.lastPaymentStatus || null,
    lastError: row.lastError || null,
    syncedAt: new Date().toISOString(),
  }
  const gatewayConfig = await prisma.domainGatewayConfig.upsert({
    where: {
      domainId_gateway_environment: {
        domainId: domain.id,
        gateway: provider,
        environment,
      },
    },
    update: {
      enabled: Boolean(row.enabled ?? row.active),
      priority: Number(row.priority || 100),
      displayName: row.name || defaultGatewayName(provider),
      approvedPaymentDomain: primaryDomain,
      webhookUrl,
      returnUrl,
      ...encrypted,
      extraConfig,
    },
    create: {
      domainId: domain.id,
      gateway: provider,
      enabled: Boolean(row.enabled ?? row.active),
      priority: Number(row.priority || 100),
      environment,
      displayName: row.name || defaultGatewayName(provider),
      approvedPaymentDomain: primaryDomain,
      webhookUrl,
      returnUrl,
      ...encrypted,
      extraConfig,
    },
  })
  return { domain, gatewayConfig: { ...gatewayConfig, credentials: maskGatewayCredentials(gatewayConfig) } }
}

export function paymentGatewayUpdateData(input: {
  row?: any | null
  provider: AdminPaymentGatewayCode
  name?: string | null
  mode?: string | null
  enabled?: boolean
  priority?: number
  failsafeEnabled?: boolean
  credentials: Record<string, unknown>
  callbackUrl?: string | null
  webhookUrl?: string | null
}) {
  const mode = normalizeMode(input.mode)
  return {
    name: String(input.name || defaultGatewayName(input.provider)),
    provider: input.provider,
    environment: "global",
    active: Boolean(input.enabled),
    enabled: Boolean(input.enabled),
    primary: Number(input.priority || 100) <= 10,
    mode,
    code: input.provider,
    priority: Number(input.priority || 100),
    failsafeEnabled: Boolean(input.failsafeEnabled),
    callbackUrl: input.callbackUrl ? String(input.callbackUrl) : null,
    webhookUrl: input.webhookUrl ? String(input.webhookUrl) : null,
    credentials: {},
    ...encryptGatewayConfig(input.credentials),
    ...encryptWebhookSecret(input.credentials, mode),
  }
}
