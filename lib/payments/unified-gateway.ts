import crypto from "node:crypto"
import { publicOrigin } from "@/lib/public-url"
import { paymentWebhookUrl } from "@/lib/runtime-site-url"

export const UNIFIED_GATEWAYS = ["razorpay", "phonepe", "cashfree", "wallet", "manual"] as const
export type UnifiedGatewayName = typeof UNIFIED_GATEWAYS[number]
export type UnifiedGatewayHealth = "healthy" | "degraded" | "down" | "unknown"

export type UnifiedGatewayConfig = {
  id?: string
  gateway: string
  enabled?: boolean
  priority?: number | null
  healthStatus?: string | null
  environment?: string | null
}

const TERMINAL_PAYMENT_STATUSES = new Set(["paid", "completed", "success", "succeeded", "captured"])
const BLOCKING_PENDING_STATUSES = new Set(["created", "pending", "initiated", "requires_action", "processing"])

export function normalizeUnifiedGateway(value: unknown): UnifiedGatewayName | null {
  const gateway = String(value || "").toLowerCase()
  return (UNIFIED_GATEWAYS as readonly string[]).includes(gateway) ? gateway as UnifiedGatewayName : null
}

export function mainPaymentOrigin(env: Record<string, string | undefined> = process.env) {
  return publicOrigin(env)
}

export function sameDomainPaymentUrls(gateway: UnifiedGatewayName, merchantOrderId: string, env?: Record<string, string | undefined>) {
  const origin = mainPaymentOrigin(env)
  const encodedOrderId = encodeURIComponent(merchantOrderId)
  return {
    returnUrl: `${origin}/payment/status?order_id=${encodedOrderId}`,
    webhookUrl: paymentWebhookUrl(gateway, origin),
    startUrl: `${origin}/payment/status?order_id=${encodedOrderId}`,
  }
}

function healthRank(status: string | null | undefined) {
  if (status === "healthy") return 0
  if (status === "unknown") return 1
  if (status === "degraded") return 2
  return 3
}

export function orderedGatewayCandidates(
  configs: UnifiedGatewayConfig[],
  preferredGateway?: string | null,
  allowUnhealthy = false,
) {
  const preferred = normalizeUnifiedGateway(preferredGateway)
  return configs
    .filter((config) => Boolean(config.enabled))
    .filter((config) => normalizeUnifiedGateway(config.gateway))
    .filter((config) => allowUnhealthy || !["down", "disabled"].includes(String(config.healthStatus || "").toLowerCase()))
    .sort((a, b) => {
      const aGateway = normalizeUnifiedGateway(a.gateway)
      const bGateway = normalizeUnifiedGateway(b.gateway)
      if (preferred && aGateway === preferred && bGateway !== preferred) return -1
      if (preferred && bGateway === preferred && aGateway !== preferred) return 1
      const priority = Number(a.priority || 100) - Number(b.priority || 100)
      if (priority !== 0) return priority
      return healthRank(a.healthStatus) - healthRank(b.healthStatus)
    })
}

export function idempotencyKeyHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function blocksDuplicatePayment(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return TERMINAL_PAYMENT_STATUSES.has(normalized) || BLOCKING_PENDING_STATUSES.has(normalized)
}

export function canRetryGateway(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return ["failed", "expired", "cancelled", "error", "gateway_error"].includes(normalized)
}
