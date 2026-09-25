import crypto from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export const PAYMENT_TERMINAL_STATES = new Set(["captured", "paid", "completed", "refunded", "cancelled", "void"])

export function paymentObligationKey(input: { invoiceId?: string | null; orderId?: string | null; checkoutSessionId?: string | null; purpose?: string | null }) {
  const identity = input.invoiceId || input.orderId || input.checkoutSessionId
  if (!identity) throw new Error("A canonical payment obligation requires an invoice, order, or checkout session")
  return `${String(input.purpose || "order_payment").toLowerCase()}:${identity}`
}

export function hashIdempotencyKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export async function upsertCanonicalTransaction(input: {
  obligationKey: string
  idempotencyKey: string
  merchantOrderId: string
  gateway: string
  gatewayConfigId?: string | null
  paymentId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  customerId?: string | null
  amount: number
  currency: string
}) {
  return prisma.$transaction(async (tx) => {
    const existing = await (tx as any).paymentTransaction.findUnique({ where: { obligationKey: input.obligationKey } })
    if (existing) {
      if (Number(existing.amount) !== Number(input.amount) || String(existing.currency) !== String(input.currency).toUpperCase()) {
        throw Object.assign(new Error("The existing payment obligation amount or currency does not match."), { code: "payment_obligation_mismatch" })
      }
      return { transaction: existing, reused: true }
    }
    const transaction = await (tx as any).paymentTransaction.create({
      data: {
        obligationKey: input.obligationKey,
        idempotencyKeyHash: hashIdempotencyKey(input.idempotencyKey),
        merchantOrderId: input.merchantOrderId,
        gateway: input.gateway,
        gatewayConfigId: input.gatewayConfigId || null,
        paymentId: input.paymentId || null,
        orderId: input.orderId || null,
        invoiceId: input.invoiceId || null,
        customerId: input.customerId || null,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        status: "created",
        authorizationState: "none",
      },
    })
    return { transaction, reused: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export async function transitionCanonicalTransaction(input: {
  id: string
  expectedVersion: number
  status: string
  authorizationState?: string
  gateway?: string
  gatewayConfigId?: string | null
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  gatewayTransactionId?: string | null
  rawGatewayResponse?: unknown
  lastError?: string | null
}) {
  const updated = await (prisma as any).paymentTransaction.updateMany({
    where: { id: input.id, version: input.expectedVersion },
    data: {
      status: input.status,
      ...(input.authorizationState ? { authorizationState: input.authorizationState } : {}),
      ...(input.gateway ? { gateway: input.gateway } : {}),
      ...(input.gatewayConfigId !== undefined ? { gatewayConfigId: input.gatewayConfigId } : {}),
      ...(input.gatewayOrderId !== undefined ? { gatewayOrderId: input.gatewayOrderId } : {}),
      ...(input.gatewayPaymentId !== undefined ? { gatewayPaymentId: input.gatewayPaymentId } : {}),
      ...(input.gatewayTransactionId !== undefined ? { gatewayTransactionId: input.gatewayTransactionId } : {}),
      ...(input.rawGatewayResponse !== undefined ? { rawGatewayResponse: input.rawGatewayResponse as any } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      version: { increment: 1 },
      ...(input.authorizationState === "authorized" || input.authorizationState === "captured" ? { authorizedAt: new Date() } : {}),
    },
  })
  if (updated.count !== 1) throw Object.assign(new Error("Payment transaction changed concurrently; reconcile before retrying."), { code: "payment_version_conflict", retryable: true })
}

export async function enqueuePaymentRetry(input: {
  idempotencyKey: string
  operation: string
  gateway: string
  reason: string
  errorCode?: string | null
  orderId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  customerId?: string | null
  attempts?: number
  metadata?: Record<string, unknown>
}) {
  const attempts = Math.max(0, input.attempts || 0)
  const base = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(attempts, 10))
  const jitter = Math.floor(base * (Math.random() * 0.4 - 0.2))
  return (prisma as any).paymentRetryQueue.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: { status: "pending", reason: input.reason, lastErrorCode: input.errorCode || null, retryAfter: new Date(Date.now() + base + jitter), metadata: input.metadata || {} },
    create: { idempotencyKey: input.idempotencyKey, operation: input.operation, gateway: input.gateway, reason: input.reason, lastErrorCode: input.errorCode || null, orderId: input.orderId || null, invoiceId: input.invoiceId || null, paymentId: input.paymentId || null, customerId: input.customerId || null, retryAfter: new Date(Date.now() + base + jitter), metadata: input.metadata || {} },
  })
}
