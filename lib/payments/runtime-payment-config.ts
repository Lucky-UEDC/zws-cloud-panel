import { prisma } from "@/lib/db"
import { getBaseUrl, paymentCallbackUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"
import {
  ADMIN_PAYMENT_GATEWAYS,
  ensureAdminPaymentGateways,
} from "@/lib/payments/payment-gateway-admin"
import { validateGatewayRow } from "@/lib/payments/gateway-registry"

export const PAYMENT_GATEWAYS_TAG = "payment-gateways"

export type RuntimePaymentGatewayConfig = {
  id?: string | null
  gateway: string
  enabled: boolean
  priority: number
  environment: string
  failsafeEnabled: boolean
  credentials: Record<string, unknown>
  credentialsPlain?: Record<string, unknown>
  missingFields: string[]
  healthState: "healthy" | "warning" | "error" | "disabled"
  webhookUrl?: string | null
  returnUrl?: string | null
  lastHealthStatus?: string | null
  lastTestAt?: string | null
  lastWebhookStatus?: string | null
  lastPaymentStatus?: string | null
  lastError?: string | null
}

type RuntimePaymentConfigOptions = {
  request?: Request | { headers?: Headers | null } | null
  baseUrl?: string | null
}

function validMode(value: string) {
  return value === "production" || value === "test" || value === "sandbox"
}

function normalizeHealth(status: unknown, enabled: boolean, missingFields: string[]): RuntimePaymentGatewayConfig["healthState"] {
  if (!enabled) return "disabled"
  const text = String(status || "").toLowerCase()
  if (["error", "down", "disabled", "signature_failed"].includes(text)) return "error"
  if (missingFields.length > 0 || text !== "healthy") return "warning"
  return "healthy"
}

async function loadRuntimePaymentGatewayRows() {
  await ensureAdminPaymentGateways()
  return (prisma as any).paymentGateway.findMany({
    where: {
      OR: [
        ...ADMIN_PAYMENT_GATEWAYS.map((code) => ({ code })),
        ...ADMIN_PAYMENT_GATEWAYS.map((provider) => ({ provider })),
      ],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  }).catch(() => [])
}

export async function loadRuntimePaymentConfig(options: RuntimePaymentConfigOptions = {}) {
  const rows = await loadRuntimePaymentGatewayRows()
  return runtimeConfigFromRows(rows, options)
}

function runtimeConfigFromRows(rows: any[], options: RuntimePaymentConfigOptions = {}) {
  const baseUrl = String(options.baseUrl || getBaseUrl(options.request || null)).replace(/\/+$/, "")

  const seen = new Set<string>()
  const gateways: RuntimePaymentGatewayConfig[] = []
  for (const row of rows) {
    const code = String(row.code || row.provider || "").toLowerCase()
    if (!(ADMIN_PAYMENT_GATEWAYS as readonly string[]).includes(code) || seen.has(code)) continue
    seen.add(code)
    const enabled = Boolean(row.enabled ?? row.active)
    const validation = validateGatewayRow(row, baseUrl)
    const missingFields = [...validation.missingFields, ...validation.webhookMissingFields]
    const environment = String(row.mode || row.environment || "test").toLowerCase() === "production" ? "production" : "sandbox"
    const modeOk = validMode(String(row.mode || row.environment || ""))
    const healthState = normalizeHealth(row.lastHealthStatus, enabled && modeOk, missingFields)
    gateways.push({
      gateway: code,
      id: null,
      enabled: enabled && modeOk,
      priority: Number(row.priority || 100),
      environment,
      failsafeEnabled: Boolean(row.failsafeEnabled),
      credentials: validation.credentials,
      credentialsPlain: validation.credentials,
      missingFields: modeOk ? missingFields : [...missingFields, "mode"],
      healthState,
      webhookUrl: paymentWebhookUrl(code, baseUrl),
      returnUrl: paymentCallbackUrl(code, baseUrl),
      lastHealthStatus: row.lastHealthStatus || "unknown",
      lastTestAt: row.lastHealthCheckedAt || null,
      lastWebhookStatus: row.lastWebhookStatus || null,
      lastPaymentStatus: row.lastPaymentStatus || null,
      lastError: row.lastError || null,
    })
  }

  return {
    gateways,
    enabledGateways: gateways
      .filter((gateway) => gateway.enabled)
      .filter((gateway) => gateway.missingFields.length === 0)
      .filter((gateway) => gateway.healthState !== "error"),
    updatedAt: new Date().toISOString(),
    baseUrl,
  }
}

export async function getRuntimePaymentConfig(options: RuntimePaymentConfigOptions = {}) {
  const rows = await loadRuntimePaymentGatewayRows()
  return runtimeConfigFromRows(rows, options)
}

export function revalidatePaymentGateways() {
  // Payment runtime configuration is intentionally read from PostgreSQL on every
  // request. This compatibility hook remains for older callers but has no cache
  // to invalidate.
}
