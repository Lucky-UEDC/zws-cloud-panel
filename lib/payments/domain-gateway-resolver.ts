import type { NextRequest } from "next/server"
import { resolveRequestDomain } from "@/lib/domain/resolve-domain"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { gatewayCredentials } from "@/lib/payment-gateways"
import { getPrimaryPaymentDomain, normalizePaymentDomain } from "@/lib/payments/primary-domain"
import { getRuntimePaymentConfig } from "@/lib/payments/runtime-payment-config"
import { getBaseUrl, paymentWebhookUrl } from "@/lib/runtime-site-url"

export type GatewayName = "razorpay" | "cashfree" | "phonepe" | "manual" | "wallet"
export type GatewayIntent = "any" | "card_upi" | "wallet"
export type FallbackBehavior = "disabled" | "default_init_fails" | "default_unavailable"

export type ResolvedPaymentGateway = {
  domainConfig: any
  gatewayConfig: any
  fallbackGatewayConfig: any | null
  gatewayConfigs?: any[]
  enabledGatewayConfigs?: any[]
  gateway: GatewayName
  mode: "direct" | "bridge" | "embedded"
  sourceDomain: string
  approvedPaymentDomain: string
  approvedDomain: string
  baseUrl: string
  approvedBaseUrl: string
  startUrl: string | null
  returnUrl: string
  webhookUrl: string
  embeddedAllowed: boolean
  redirectFallbackEnabled: boolean
  ok?: true
  domain?: any
  defaultGateway?: GatewayName | null
  selectedGateway?: GatewayName
  fallbackGateway?: GatewayName | null
  fallbackEnabled?: boolean
}

export type GatewayResolutionResult =
  | (ResolvedPaymentGateway & {
      ok: true
      domain: any
      defaultGateway: GatewayName | null
      selectedGateway: GatewayName
      fallbackGateway: GatewayName | null
      fallbackEnabled: boolean
    })
  | {
      ok: false
      code: "NO_GATEWAY_AVAILABLE" | "DOMAIN_GATEWAY_NOT_CONFIGURED"
      error: string
      domain?: any | null
      defaultGateway?: GatewayName | null
      selectedGateway?: null
      fallbackGateway?: GatewayName | null
      fallbackEnabled?: boolean
      sourceDomain?: string | null
    }

export const GATEWAY_PRIORITY: Record<string, number> = {
  razorpay: 0,
  phonepe: 1,
  cashfree: 2,
  manual: 3,
  wallet: 4,
}

export function gatewayPriorityRank(gateway: unknown) {
  return GATEWAY_PRIORITY[String(gateway || "").toLowerCase()] ?? 100
}

function normalizeGateway(value?: string | null): GatewayName | null {
  const gateway = String(value || "").toLowerCase()
  return ["razorpay", "cashfree", "phonepe", "manual", "wallet"].includes(gateway) ? gateway as GatewayName : null
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function objectConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function paymentRoutingMetadata(domain: any) {
  const metadata = objectConfig(domain?.metadata)
  return objectConfig(metadata.paymentRouting)
}

export function getFallbackBehavior(domain: any): FallbackBehavior {
  const behavior = String(paymentRoutingMetadata(domain).fallbackBehavior || "default_init_fails")
  if (behavior === "disabled") return "disabled"
  if (behavior === "default_unavailable") return "default_unavailable"
  if (behavior === "default_disabled_or_unavailable") return "default_unavailable"
  return "default_init_fails"
}

function templateUrl(value: string | null | undefined, fallback: string, merchantOrderId?: string | null) {
  const raw = String(value || fallback)
  return merchantOrderId ? raw.replace(/\{order_id\}/g, encodeURIComponent(merchantOrderId)) : raw
}

function activeConfig(configs: any[], gateway?: string | null) {
  if (!gateway) return null
  if (String(gateway).toLowerCase() === "none") return null
  return configs.find((config) => config.enabled && config.gateway === gateway) || null
}

export function gatewayRequiredCredentialFields(gateway: string) {
  if (gateway === "razorpay") return ["keyId", "keySecret", "webhookSecret"]
  if (gateway === "cashfree") return ["appId", "secretKey"]
  if (gateway === "phonepe") return ["merchantId", "clientId", "clientSecret", "clientVersion"]
  return []
}

export function gatewayMissingCredentialFields(config: any) {
  if (!config?.enabled) return gatewayRequiredCredentialFields(String(config?.gateway || ""))
  const credentials = gatewayCredentials(config)
  return gatewayRequiredCredentialFields(String(config.gateway || "")).filter((key) => !credentials[key])
}

export function isDomainGatewayReady(config: any) {
  return Boolean(config?.enabled) && gatewayMissingCredentialFields(config).length === 0
}

function uniqueByGateway(configs: any[]) {
  const seen = new Set<string>()
  const result: any[] = []
  for (const config of configs) {
    const gateway = String(config?.gateway || "").toLowerCase()
    if (!gateway || seen.has(gateway)) continue
    seen.add(gateway)
    result.push(config)
  }
  return result
}

function gatewayPreferenceRank(config: any, resolution: ResolvedPaymentGateway | null, preferredGateway?: string | null) {
  const gateway = String(config?.gateway || "").toLowerCase()
  if (preferredGateway && gateway === String(preferredGateway).toLowerCase()) return -1
  if (gateway === resolution?.defaultGateway) return 0
  if (gateway === resolution?.fallbackGateway) return 1
  return 2
}

export function getGatewayConfigForGateway(resolution: ResolvedPaymentGateway | null, gateway: string) {
  if (!resolution) return null
  const allConfigs = Array.isArray(resolution.gatewayConfigs) ? resolution.gatewayConfigs : []
  return allConfigs.find((config) => config.enabled && config.gateway === gateway)
    || (resolution.gatewayConfig?.gateway === gateway ? resolution.gatewayConfig : null)
    || (resolution.fallbackGatewayConfig?.gateway === gateway ? resolution.fallbackGatewayConfig : null)
}

export function getUsableGatewayCandidates(
  resolution: ResolvedPaymentGateway | null,
  intent: GatewayIntent = "any",
  preferredGateway?: string | null,
) {
  if (!resolution) return []
  const enabled = Array.isArray(resolution.enabledGatewayConfigs) && resolution.enabledGatewayConfigs.length
    ? resolution.enabledGatewayConfigs
    : [resolution.gatewayConfig, resolution.fallbackGatewayConfig].filter(Boolean)
  const gateways = intent === "card_upi"
    ? new Set(["razorpay", "cashfree", "phonepe"])
    : intent === "wallet"
      ? new Set(["wallet"])
      : new Set(["razorpay", "cashfree", "phonepe", "manual", "wallet"])

  return uniqueByGateway(enabled)
    .filter((config) => gateways.has(String(config.gateway || "")))
    .filter(isDomainGatewayReady)
    .sort((a, b) => {
      const configuredPriority = Number(a.priority || 100) - Number(b.priority || 100)
      if (configuredPriority !== 0) return configuredPriority
      return String(a.id || a.gateway).localeCompare(String(b.id || b.gateway))
    })
}

export function getGatewayResolutionMetadata(
  resolution: ResolvedPaymentGateway | null,
  intent: GatewayIntent = "any",
  selectedConfig?: any | null,
) {
  const allConfigs = Array.isArray(resolution?.gatewayConfigs) ? resolution!.gatewayConfigs : []
  const relevant = allConfigs.filter((config) => {
    const gateway = String(config.gateway || "")
    if (intent === "card_upi") return ["razorpay", "cashfree", "phonepe"].includes(gateway)
    if (intent === "wallet") return gateway === "wallet"
    return true
  })
  const missingFields = relevant
    .map((config) => ({ gateway: config.gateway, missingFields: gatewayMissingCredentialFields(config) }))
    .filter((item) => item.missingFields.length > 0)

  return {
    domain: resolution?.sourceDomain || null,
    selectedGateway: selectedConfig?.gateway || resolution?.gateway || null,
    fallbackGateway: resolution?.fallbackGateway || resolution?.fallbackGatewayConfig?.gateway || null,
    gatewayEnabled: Boolean(selectedConfig?.enabled ?? resolution?.gatewayConfig?.enabled),
    missingFields,
  }
}

async function logGatewayResolutionIssue(input: {
  code: string
  domain?: string | null
  defaultGateway?: string | null
  fallbackGateway?: string | null
  message: string
}) {
  await createPanelLog({
    category: "Payment",
    level: "warn",
    message: "payment_gateway_resolution_failed",
    metadata: {
      code: input.code,
      domain: input.domain || null,
      defaultGateway: input.defaultGateway || null,
      fallbackGateway: input.fallbackGateway || null,
      detail: input.message,
    },
  }).catch(() => null)
}

async function resolveDomainGateway(args: {
  request: NextRequest
  preferredGateway?: string | null
  orderId?: string | null
  invoiceId?: string | null
  amount?: number | null
  merchantOrderId?: string | null
}): Promise<GatewayResolutionResult> {
  const resolved = await resolveRequestDomain(args.request)
  const domainConfig = resolved.domainConfig
  const primary = await getPrimaryPaymentDomain()
  const sourceDomain = normalizePaymentDomain(resolved.domain || "")
  const primaryDomain = normalizePaymentDomain(primary?.domain || domainConfig?.domain || "")
  if (!domainConfig) {
    await logGatewayResolutionIssue({
      code: "DOMAIN_GATEWAY_NOT_CONFIGURED",
      domain: resolved.domain,
      message: `No active payment domain config found for ${resolved.domain || "unknown domain"}.`,
    })
    return {
      ok: false,
      code: "DOMAIN_GATEWAY_NOT_CONFIGURED",
      error: `Payment domain is not configured for ${resolved.domain || "this domain"}. Please contact support.`,
      sourceDomain: resolved.domain,
    }
  }
  const runtime = await getRuntimePaymentConfig({ request: args.request })
  const domainGatewayRows = await prisma.domainGatewayConfig.findMany({
    where: { domainId: domainConfig.id },
    orderBy: { priority: "asc" },
  }).catch(() => [])
  const domainByGateway = new Map(domainGatewayRows.map((config) => [String(config.gateway || "").toLowerCase(), config]))
  const allGatewayConfigs = runtime.gateways.map((config) => {
    const domainRow = domainByGateway.get(config.gateway)
    return {
      ...config,
      id: null,
      approvedPaymentDomain: normalizePaymentDomain(domainRow?.approvedPaymentDomain || sourceDomain || primaryDomain || ""),
      displayName: domainRow?.displayName || config.gateway,
      startUrl: domainRow?.startUrl || null,
      extraConfig: domainRow?.extraConfig || {},
    }
  })
  const enabledConfigs = runtime.enabledGateways.map((config) => {
    const domainRow = domainByGateway.get(config.gateway)
    return {
      ...config,
      id: null,
      approvedPaymentDomain: normalizePaymentDomain(domainRow?.approvedPaymentDomain || sourceDomain || primaryDomain || ""),
      displayName: domainRow?.displayName || config.gateway,
      startUrl: domainRow?.startUrl || null,
      extraConfig: domainRow?.extraConfig || {},
    }
  })
  // Automatic routing = configured priority order (lowest number first).
  // Explicit customer selection (preferredGateway) ALWAYS wins over priority:
  // when the customer picked a gateway, that gateway is resolved for the domain
  // config (returnUrl/webhookUrl/mode follow the selection). The automatic
  // default is still recorded separately as `defaultGateway`.
  const prioritySorted = enabledConfigs
    .slice()
    .sort((a, b) => Number(a.priority || 100) - Number(b.priority || 100) || String(a.id || a.gateway).localeCompare(String(b.id || b.gateway)))
  const preferredName = String(args.preferredGateway || "").trim().toLowerCase()
  const preferredConfig = preferredName
    ? prioritySorted.find((config) => String(config.gateway || "").trim().toLowerCase() === preferredName) || null
    : null
  const gatewayConfig = preferredConfig || prioritySorted[0] || null
  const defaultGateway = normalizeGateway(prioritySorted[0]?.gateway || gatewayConfig?.gateway)
  const fallbackGateway = null
  const fallbackEnabled = false
  if (!gatewayConfig) {
    await logGatewayResolutionIssue({
      code: "NO_GATEWAY_AVAILABLE",
      domain: resolved.domain,
      defaultGateway,
      fallbackGateway,
      message: `No enabled gateway config found for ${resolved.domain}. Default: ${defaultGateway || "none"}.`,
    })
    return {
      ok: false,
      code: "NO_GATEWAY_AVAILABLE",
      error: `No enabled payment gateway is available for ${resolved.domain}. Please contact support.`,
      domain: domainConfig,
      defaultGateway,
      selectedGateway: null,
      fallbackGateway,
      fallbackEnabled,
      sourceDomain: resolved.domain,
    }
  }

  const fallbackGatewayConfig = null
  const approvedPaymentDomain = String(sourceDomain || primaryDomain || resolved.domain).toLowerCase()
  const mode = "direct"
  const extra = objectConfig(gatewayConfig.extraConfig)
  const approvedBaseUrl = getBaseUrl(args.request) || primary?.appBaseUrl || resolved.baseUrl
  const defaultReturn = `${approvedBaseUrl}/payment/status?order_id={order_id}`
  const defaultWebhook = paymentWebhookUrl(gatewayConfig.gateway, approvedBaseUrl)

  return {
    ok: true,
    domain: domainConfig,
    domainConfig,
    gatewayConfig,
    fallbackGatewayConfig,
    gatewayConfigs: allGatewayConfigs,
    enabledGatewayConfigs: enabledConfigs,
    gateway: gatewayConfig.gateway as GatewayName,
    defaultGateway,
    selectedGateway: gatewayConfig.gateway as GatewayName,
    fallbackGateway,
    fallbackEnabled,
    mode,
    sourceDomain: resolved.domain,
    approvedPaymentDomain,
    approvedDomain: approvedPaymentDomain,
    baseUrl: resolved.baseUrl,
    approvedBaseUrl,
    startUrl: null,
    returnUrl: templateUrl(gatewayConfig.returnUrl, defaultReturn, args.merchantOrderId),
    webhookUrl: templateUrl(gatewayConfig.webhookUrl, defaultWebhook, args.merchantOrderId),
    embeddedAllowed: Boolean(extra.embeddedAllowed ?? true),
    redirectFallbackEnabled: false,
  }
}

export async function resolveGatewayForPayment(args: {
  request: NextRequest
  preferredGateway?: string | null
  domainId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  amount?: number | null
  merchantOrderId?: string | null
}) {
  return resolveDomainGateway(args)
}

export async function resolvePaymentGateway(args: {
  request: NextRequest
  preferredGateway?: string | null
  orderId?: string | null
  invoiceId?: string | null
  amount?: number | null
  merchantOrderId?: string | null
}): Promise<ResolvedPaymentGateway> {
  const result = await resolveDomainGateway(args)
  if (!result.ok) {
    throw Object.assign(new Error(result.error), {
      code: result.code,
      status: result.code === "NO_GATEWAY_AVAILABLE" ? 503 : 503,
    })
  }
  return result
}

export async function listEnabledGatewaysForRequest(request: NextRequest) {
  const resolved = await resolveRequestDomain(request)
  if (!resolved.domainConfig) return []
  const runtime = await getRuntimePaymentConfig({ request })
  return runtime.enabledGateways
}
