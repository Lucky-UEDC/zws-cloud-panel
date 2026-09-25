import type { NormalizedPaymentWebhook } from "@/lib/payment-gateways"

export const ENTERPRISE_GATEWAYS = ["razorpay", "phonepe", "cashfree"] as const
export type EnterpriseGateway = typeof ENTERPRISE_GATEWAYS[number]

export type GatewayOperation = "initialize" | "cancel" | "verify" | "refund" | "renewal" | "diagnostic"
export type GatewayAuthorizationState = "none" | "session_created" | "authorized" | "captured" | "failed" | "unknown"

export type GatewayCustomer = {
  id: string
  email?: string | null
  phone: string
  name?: string | null
}

export type GatewayInitializeInput = {
  merchantOrderId: string
  amount: number
  currency: string
  customer: GatewayCustomer
  description: string
  returnUrl: string
  webhookUrl: string
  invoiceId?: string | null
  invoiceNumber?: string | null
  gatewayConfig: any
}

export type GatewaySession = {
  gateway: EnterpriseGateway
  gatewayOrderId: string | null
  gatewayPaymentId: string | null
  gatewayTransactionId: string | null
  gatewaySessionId: string | null
  redirectUrl: string | null
  authorizationState: GatewayAuthorizationState
  raw: Record<string, unknown>
}

export type GatewayVerification = {
  state: GatewayAuthorizationState
  status: string
  amount?: number | null
  currency?: string | null
  gatewayPaymentId?: string | null
  retryable: boolean
  raw: Record<string, unknown>
}

export type GatewayDiagnostic = {
  check: string
  status: "pass" | "warn" | "fail"
  code: string
  message: string
  latencyMs?: number
  metadata?: Record<string, unknown>
}

export type GatewayFailure = Error & {
  code: string
  safeMessage: string
  retryable: boolean
  ambiguous: boolean
  status?: number
}

export function classifyGatewayFailure(error: any): GatewayFailure {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0) || undefined
  const code = String(error?.safeCode || error?.code || `gateway_${status || "error"}`).toLowerCase()
  const message = String(error?.safeMessage || error?.message || "Payment gateway request failed").slice(0, 500)
  const retryable = Boolean(error?.retryable) || status === 408 || status === 409 || status === 425 || status === 429 || Boolean(status && status >= 500)
  const ambiguous = retryable && ["initialize", "timeout", "network", "fetch"].some((hint) => `${code} ${message}`.toLowerCase().includes(hint))
  return Object.assign(new Error(message), { code, safeMessage: message, retryable, ambiguous, status })
}

export interface GatewayDriver {
  readonly name: EnterpriseGateway
  initialize(input: GatewayInitializeInput): Promise<GatewaySession>
  cancel(input: { gatewayConfig: any; gatewayOrderId: string }): Promise<GatewayVerification>
  verify(input: { gatewayConfig: any; gatewayOrderId: string }): Promise<GatewayVerification>
  refund(input: { gatewayConfig: any; gatewayPaymentId: string; merchantRefundId: string; amount: number; currency: string }): Promise<GatewayVerification>
  authorizeRenewal(input: GatewayInitializeInput): Promise<GatewaySession>
  verifyWebhook(input: { rawBody: string; headers: Headers; gatewayConfig: any }): boolean
  normalizeWebhook(rawBody: string): NormalizedPaymentWebhook
  diagnose(input: { gatewayConfig: any; webhookUrl: string; runLiveAuth: boolean }): Promise<GatewayDiagnostic[]>
  classifyError(error: unknown, operation: GatewayOperation): GatewayFailure
}
