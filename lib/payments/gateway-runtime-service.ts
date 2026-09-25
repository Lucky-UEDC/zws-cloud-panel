import { getRuntimePaymentConfig, loadRuntimePaymentConfig, type RuntimePaymentGatewayConfig } from "@/lib/payments/runtime-payment-config"
import { getGatewayDriver } from "@/lib/payments/gateway-drivers"
import { redactCheckoutValue } from "@/lib/payments/checkout-trace"

export type PublicGatewayRuntime = {
  gateway: string
  enabled: boolean
  priority: number
  environment: string
  mode: string
  healthState: string
  missingFields: string[]
  publicKey?: string | null
  webhookUrl?: string | null
  returnUrl?: string | null
  lastHealthStatus?: string | null
  lastError?: string | null
}

function credentialString(config: RuntimePaymentGatewayConfig | any, ...keys: string[]) {
  const credentials = config?.credentialsPlain || config?.credentials || {}
  for (const key of keys) {
    const value = credentials?.[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

export function publicGatewayRuntime(config: RuntimePaymentGatewayConfig | any): PublicGatewayRuntime {
  const gateway = String(config?.gateway || "").toLowerCase()
  const publicKey = gateway === "razorpay"
    ? credentialString(config, "keyId", "razorpayKeyId")
    : null
  return {
    gateway,
    enabled: Boolean(config?.enabled),
    priority: Number(config?.priority || 100),
    environment: String(config?.environment || config?.mode || "sandbox"),
    mode: String(config?.environment || config?.mode || "sandbox") === "production" ? "production" : "sandbox",
    healthState: String(config?.healthState || config?.lastHealthStatus || "unknown"),
    missingFields: Array.isArray(config?.missingFields) ? config.missingFields : [],
    publicKey,
    webhookUrl: config?.webhookUrl || null,
    returnUrl: config?.returnUrl || null,
    lastHealthStatus: config?.lastHealthStatus || null,
    lastError: config?.lastError || null,
  }
}

export async function getPublicPaymentRuntime(options: { request?: Request | null; baseUrl?: string | null; uncached?: boolean } = {}) {
  const runtime = options.uncached
    ? await loadRuntimePaymentConfig({ request: options.request || undefined, baseUrl: options.baseUrl || undefined })
    : await getRuntimePaymentConfig({ request: options.request || undefined, baseUrl: options.baseUrl || undefined })
  const gateways = runtime.gateways.map(publicGatewayRuntime)
  const enabledGateways = gateways
    .filter((gateway) => gateway.enabled && gateway.missingFields.length === 0)
    .sort((a, b) => a.priority - b.priority || a.gateway.localeCompare(b.gateway))
  return {
    gateways,
    enabledGateways,
    defaultGateway: enabledGateways[0]?.gateway || null,
    updatedAt: runtime.updatedAt,
    baseUrl: runtime.baseUrl,
  }
}

export async function testGatewayRuntimeAuthentication(config: RuntimePaymentGatewayConfig) {
  const gateway = String(config.gateway || "").toLowerCase()
  if (!["razorpay", "phonepe", "cashfree"].includes(gateway)) {
    return { ok: false, code: "unsupported_gateway", message: `Unsupported gateway ${gateway}.` }
  }
  const driver = getGatewayDriver(gateway as any)
  const checks = await driver.diagnose({
    gatewayConfig: config,
    webhookUrl: String(config.webhookUrl || ""),
    runLiveAuth: true,
  })
  const failed = checks.find((check) => check.status === "fail")
  return {
    ok: !failed,
    code: failed?.code || "gateway_auth_ready",
    message: failed?.message || "Gateway runtime authentication checks passed.",
    checks: redactCheckoutValue(checks),
  }
}
