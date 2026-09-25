import { prisma } from "@/lib/db"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { validateGatewayRow, type GatewayValidationResult } from "@/lib/payments/gateway-registry"
import {
  activePaymentGatewayCredentials,
  defaultGatewayName,
  isSecretGatewayCredentialField,
  mergeGatewayCredentials,
  normalizePaymentGatewayProvider,
  paymentGatewayUpdateData,
  serializePaymentGateway,
} from "@/lib/payments/payment-gateway-admin"
import { testGatewayRuntimeAuthentication } from "@/lib/payments/gateway-runtime-service"
import type { RuntimePaymentGatewayConfig } from "@/lib/payments/runtime-payment-config"
import { resolveUploadedFile } from "@/lib/uploads"

export type PaymentApiError = {
  ok: false
  code: string
  message: string
  gatewayId?: string
  field?: string
  requestId?: string
  providerResponse?: unknown
}

function apiError(input: Omit<PaymentApiError, "ok">): PaymentApiError {
  return { ok: false, ...input }
}

function normalizeMode(value: unknown) {
  const mode = String(value || "").trim().toLowerCase()
  return mode === "production" || mode === "live" ? "production" : "test"
}

function runtimeConfigFromValidation(row: any, validation: GatewayValidationResult): RuntimePaymentGatewayConfig {
  return {
    id: row.id,
    gateway: validation.provider,
    enabled: validation.enabled,
    priority: validation.priority,
    environment: validation.mode === "production" ? "production" : "sandbox",
    failsafeEnabled: Boolean(row.failsafeEnabled),
    credentials: validation.credentials,
    credentialsPlain: validation.credentials,
    missingFields: [...validation.missingFields, ...validation.webhookMissingFields],
    healthState: validation.ok ? "healthy" : validation.enabled ? "warning" : "disabled",
    webhookUrl: validation.webhookUrl,
    returnUrl: row.callbackUrl || null,
    lastHealthStatus: row.lastHealthStatus || null,
    lastWebhookStatus: row.lastWebhookStatus || null,
    lastPaymentStatus: row.lastPaymentStatus || null,
    lastError: row.lastError || null,
  }
}

export async function validateAdminPaymentGateway(row: any, request: Request, options: { requireAuth?: boolean } = {}) {
  const baseUrl = getBaseUrl(request)
  const validation = validateGatewayRow(row, baseUrl)
  const missingField = validation.missingFields[0] || validation.webhookMissingFields[0] || undefined
  if (!validation.provider) {
    return {
      ok: false as const,
      validation,
      error: apiError({
        code: validation.code,
        message: validation.reason,
        gatewayId: row?.id,
        field: missingField,
      }),
    }
  }
  if (!validation.enabled) {
    return {
      ok: true as const,
      validation,
      auth: null,
      message: "Gateway draft is saved disabled; runtime validation will run when it is enabled.",
    }
  }
  if (!validation.ok) {
    return {
      ok: false as const,
      validation,
      error: apiError({
        code: validation.code,
        message: validation.reason,
        gatewayId: row.id,
        field: missingField,
      }),
    }
  }
  if (!options.requireAuth) {
    return { ok: true as const, validation, auth: null, message: validation.reason }
  }
  const auth = await testGatewayRuntimeAuthentication(runtimeConfigFromValidation(row, validation))
  if (!auth.ok) {
    return {
      ok: false as const,
      validation,
      auth,
      error: apiError({
        code: auth.code || "gateway_auth_failed",
        message: auth.message || "Gateway rejected credentials.",
        gatewayId: row.id,
        providerResponse: auth.checks || null,
      }),
    }
  }
  return { ok: true as const, validation, auth, message: auth.message }
}

const THEME_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const MERCHANT_NAME_MAX_LENGTH = 120

export function validateGatewayBranding(credentials: Record<string, any>) {
  const errors: { field: string; message: string }[] = []
  const merchantName = typeof credentials.merchantName === "string" ? credentials.merchantName.trim() : ""
  if (merchantName && merchantName.length > MERCHANT_NAME_MAX_LENGTH) {
    errors.push({ field: "merchantName", message: `Merchant name must be at most ${MERCHANT_NAME_MAX_LENGTH} characters.` })
  }
  const themeColor = String(credentials.themeColor || "").trim()
  if (themeColor && !THEME_COLOR_PATTERN.test(themeColor)) {
    errors.push({ field: "themeColor", message: "Theme color must be a valid hex color like #00C7E8." })
  }
  const logoUrl = String(credentials.logoUrl || "").trim()
  if (logoUrl) {
    if (!logoUrl.startsWith("/uploads/") || logoUrl.startsWith("/uploads/..") || !resolveUploadedFile(logoUrl)) {
      errors.push({ field: "logoUrl", message: "Logo reference must point to an uploaded logo." })
    }
  }
  return errors
}

export function validateGatewayIntegerField(value: unknown, fallback: number, label: string, errors: { field: string; message: string }[]) {
  const parsed = Number(value)
  if (!Number.isNaN(parsed) && !Number.isInteger(parsed)) {
    errors.push({ field: "priority", message: `${label} must be a whole number.` })
    return null
  }
  return Number.isNaN(parsed) ? fallback : parsed
}

export async function saveAdminPaymentGatewayById(input: {
  id: string
  body: Record<string, any>
  request: Request
  primaryDomain?: any
}) {
  const existing = await (prisma as any).paymentGateway.findUnique({ where: { id: input.id } }).catch(() => null)
  if (!existing) {
    return {
      ok: false as const,
      status: 404,
      error: apiError({ code: "gateway_not_found", message: "Payment gateway not found.", gatewayId: input.id }),
    }
  }
  const provider = normalizePaymentGatewayProvider(existing.provider || existing.code)
  if (!provider) {
    return {
      ok: false as const,
      status: 400,
      error: apiError({ code: "gateway_provider_unsupported", message: "Unsupported payment gateway provider.", gatewayId: input.id }),
    }
  }
  const requestedProvider = normalizePaymentGatewayProvider(input.body.provider || input.body.code || provider)
  if (requestedProvider && requestedProvider !== provider) {
    return {
      ok: false as const,
      status: 409,
      error: apiError({
        code: "gateway_provider_immutable",
        message: `Gateway provider is immutable. This row is ${provider}.`,
        gatewayId: input.id,
        field: "provider",
      }),
    }
  }

  const credentials = mergeGatewayCredentials(existing, input.body.credentials)
  const brandingErrors = validateGatewayBranding(input.body.credentials || {})
  if (brandingErrors.length) {
    return {
      ok: false as const,
      status: 400,
      error: apiError({
        code: "gateway_validation_failed",
        message: brandingErrors.map((entry) => entry.message).join(" "),
        field: brandingErrors[0].field,
        gatewayId: input.id,
      }),
    }
  }
  const enabled = Boolean(input.body.enabled ?? input.body.active ?? existing.enabled ?? existing.active)
  const priorityInput = validateGatewayIntegerField(input.body.priority, existing.priority || 100, "Priority", [])
  const priority = Math.max(1, priorityInput ?? existing.priority ?? 100)
  const mode = normalizeMode(input.body.mode || input.body.environment || existing.mode)
  const failsafeEnabled = Boolean(input.body.failsafeEnabled ?? input.body.failsafe_enabled ?? existing.failsafeEnabled)
  const data = paymentGatewayUpdateData({
    row: existing,
    provider,
    name: input.body.name || input.body.displayName || existing.name || defaultGatewayName(provider),
    mode,
    enabled,
    priority,
    failsafeEnabled,
    credentials,
    callbackUrl: null,
    webhookUrl: null,
  })
  const simulated = { ...existing, ...data, provider, code: provider, credentials: {}, enabled, active: enabled, mode, priority, failsafeEnabled }
  const validation = await validateAdminPaymentGateway(simulated, input.request, { requireAuth: enabled })
  if (!validation.ok) {
    await (prisma as any).paymentGateway.update({
      where: { id: input.id },
      data: { lastHealthStatus: "degraded", lastError: validation.error.message, lastHealthCheckedAt: new Date() },
    }).catch(() => null)
    return { ok: false as const, status: 400, error: validation.error, validation: validation.validation }
  }

  const row = await (prisma as any).paymentGateway.update({ where: { id: input.id }, data: {
    ...data,
    lastHealthStatus: enabled ? "healthy" : "disabled",
    lastWebhookStatus: enabled ? "endpoint_configured" : existing.lastWebhookStatus,
    lastError: null,
    consecutiveFailures: 0,
    circuitOpenedAt: null,
    lastHealthCheckedAt: new Date(),
  } })
  return {
    ok: true as const,
    row,
    gateway: serializePaymentGateway(row, input.primaryDomain, getBaseUrl(input.request)),
    validation,
    readiness: credentialsSnapshot(row),
  }
}

export function credentialsSnapshot(row: any) {
  const credentials = activePaymentGatewayCredentials(row)
  return {
    source: "database",
    decrypted: true,
    publicKeyPresent: Boolean(credentials.keyId || credentials.appId || credentials.merchantId),
    secretPresent: Boolean(credentials.keySecret || credentials.secretKey || credentials.clientSecret),
    webhookSecretPresent: Boolean(credentials.webhookSecret || (credentials.webhookUsername && credentials.webhookPassword)),
  }
}

export async function revealAdminGatewayCredential(row: any, field: string) {
  const code = String(row.code || row.provider || "").toLowerCase()
  const credentials = activePaymentGatewayCredentials(row)
  if (!credentials) {
    return { ok: false as const, code: "credentials_unavailable", message: "Gateway credentials are not available to decrypt." }
  }
  if (!Object.prototype.hasOwnProperty.call(credentials, field)) {
    return { ok: false as const, code: "unknown_field", message: `Credential field "${field}" does not exist for ${code}.` }
  }
  const value = String(credentials[field] ?? "")
  if (!value) {
    return { ok: false as const, code: "empty_field", message: `Credential field "${field}" is empty.` }
  }
  return { ok: true as const, code, field, value, secret: isSecretGatewayCredentialField(code, field) }
}
