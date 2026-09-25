import { prisma } from "@/lib/db"

export const CHECKOUT_PAYMENT_STATES = {
  CREATED: "created",
  PENDING_PAYMENT: "pending_payment",
  GATEWAY_REDIRECTED: "gateway_redirected",
  PAYMENT_PROCESSING: "payment_processing",
  PAYMENT_SUCCESS: "payment_success",
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_EXPIRED: "payment_expired",
  PAYMENT_CANCELLED: "payment_cancelled",
  PROVISION_QUEUED: "provision_queued",
  PROVISIONING: "provisioning",
  ACTIVE: "active",
} as const

const SUCCESS_PAYMENT_STATUSES = new Set(["completed", "paid", "success"])
const SUCCESS_ATTEMPT_STATUSES = new Set(["success", "completed", "paid"])
const PENDING_PAYMENT_STATUSES = new Set(["created", "pending", "pending_manual", "started", "initiated", "waiting"])
const FAILED_PAYMENT_STATUSES = new Set(["failed", "failure", "payment_failed", "cancelled", "canceled", "expired", "payment_expired"])
const PROVISIONING_BLOCKED_STATUSES = new Set(["QUEUED", "SELECTING_NODE", "CLONING_TEMPLATE", "CLONE_COMPLETE", "RESIZING_DISK", "ASSIGNING_IP", "APPLYING_CLOUD_INIT", "STARTING_VM", "VERIFYING_VM", "UPGRADE_QUEUED"])

function money(value: unknown) {
  const next = Number(value || 0)
  return Number.isFinite(next) ? Number(next.toFixed(2)) : 0
}

function normalizeCurrency(value: unknown) {
  return String(value || "INR").toUpperCase()
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function transactionIdFor(payment: any, attempt?: any | null) {
  return String(
    attempt?.gatewayTransactionId ||
    attempt?.gatewayPaymentId ||
    payment?.gatewayTransactionId ||
    payment?.transactionId ||
    payment?.gatewayPaymentId ||
    "",
  ).trim()
}

function isWalletPayment(payment: any) {
  return String(payment?.gateway || payment?.paymentMethod || "").toLowerCase() === "wallet"
}

function isManualCompletedPayment(payment: any, order: any) {
  const gateway = String(payment?.gateway || payment?.paymentMethod || "").toLowerCase()
  const status = String(payment?.status || "").toLowerCase()
  const invoiceStatus = String(order?.invoices?.status || "").toLowerCase()
  const orderStatus = String(order?.status || "").toLowerCase()
  return gateway === "manual" &&
    SUCCESS_PAYMENT_STATUSES.has(status) &&
    Boolean(payment?.completedAt || payment?.webhookProcessedAt) &&
    ["paid", "active", "completed"].includes(orderStatus) &&
    ["paid", "completed"].includes(invoiceStatus) &&
    amountMatchesOrder(payment, order)
}

function amountMatchesOrder(payment: any, order: any) {
  const paymentAmount = money(payment?.gatewayAmount || payment?.amount)
  const orderAmount = money(order?.payableAmount || order?.finalAmount || order?.totalAmount)
  if (!paymentAmount || !orderAmount) return true
  if (paymentAmount + 0.009 < orderAmount) return false
  return normalizeCurrency(payment?.currency) === normalizeCurrency(order?.currency)
}

function paymentHasBackendSuccess(payment: any, order: any) {
  const paymentStatus = String(payment?.status || "").toLowerCase()
  if (!SUCCESS_PAYMENT_STATUSES.has(paymentStatus)) return false
  const attempts = Array.isArray(payment?.paymentAttempts) ? payment.paymentAttempts : []
  const successAttempt = attempts.find((attempt: any) =>
    SUCCESS_ATTEMPT_STATUSES.has(String(attempt?.status || "").toLowerCase()) && attempt?.webhookVerifiedAt
  )
  const transactionId = transactionIdFor(payment, successAttempt)
  if (successAttempt && transactionId && amountMatchesOrder(payment, order)) return true
  if (isWalletPayment(payment) && payment?.completedAt && transactionId && amountMatchesOrder(payment, order)) return true
  if (isManualCompletedPayment(payment, order)) return true
  return false
}

async function verifiedSiblingPayment(order: any) {
  const metadata = record(order?.metadata)
  const verification = record(metadata.paymentVerification)
  const paymentId = String(verification.paymentId || "").trim()
  const primaryOrderId = String(verification.primaryOrderId || "").trim()
  if (!paymentId || !primaryOrderId) return null

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      checkoutSession: true,
      checkoutIntent: true,
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  }).catch(() => null)
  if (!payment || payment.orderId !== primaryOrderId) return null
  const session = payment.checkoutSession
  const intent = payment.checkoutIntent
  if (session && session.fulfilledOrderId !== primaryOrderId) return null
  if (intent && intent.fulfilledOrderId !== primaryOrderId) return null
  if (!paymentHasBackendSuccess(payment, order)) return null
  return payment
}

export async function getProvisioningPaymentGate(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 3 } },
        take: 5,
      },
      invoices: true,
      provisioningJobs: { where: { type: { in: ["provision", "upgrade"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      vpsInstance: true,
    },
  })
  if (!order) return { ok: false, reason: "order_not_found" as const, order: null, payment: null }

  const latestJob = order.provisioningJobs?.[0] || null
  const hasProvisioningState = PROVISIONING_BLOCKED_STATUSES.has(String(order.provisioningStatus || "").toUpperCase()) || Boolean(latestJob?.id)
  const directPayment = (order.payments || []).find((payment) => paymentHasBackendSuccess(payment, order)) || null
  const siblingPayment = directPayment ? null : await verifiedSiblingPayment(order)
  const payment = directPayment || siblingPayment
  if (!payment) {
    const hasPayment = Boolean(order.payments?.length)
    const latestPaymentStatus = String(order.payments?.[0]?.status || "").toLowerCase()
    const reason = hasPayment && FAILED_PAYMENT_STATUSES.has(latestPaymentStatus)
      ? "payment_failed"
      : hasProvisioningState
        ? "unverified_payment_with_provisioning_state"
        : hasPayment && PENDING_PAYMENT_STATUSES.has(latestPaymentStatus)
          ? "payment_pending"
          : "payment_not_verified"
    return { ok: false, reason, order, payment: null }
  }

  return { ok: true, reason: "payment_verified" as const, order, payment }
}

export async function assertPaymentVerifiedForProvisioning(orderId: string) {
  const gate = await getProvisioningPaymentGate(orderId)
  if (!gate.ok) {
    const message = `Provisioning blocked: ${gate.reason}`
    await prisma.order.update({
      where: { id: orderId },
      data: {
        provisioningError: message,
        metadata: {
          ...record(gate.order?.metadata),
          provisioningBlocked: {
            reason: gate.reason,
            checkedAt: new Date().toISOString(),
          },
        },
      },
    }).catch(() => undefined)
    throw new Error(message)
  }
  return gate
}

export function paymentStatusForClient(input: {
  rawStatus?: string | null
  verified?: boolean
  createdAt?: Date | string | null
  expiresAfterMs?: number
}) {
  const raw = String(input.rawStatus || "").toLowerCase()
  if (input.verified || SUCCESS_PAYMENT_STATUSES.has(raw) || raw === "fulfilled") return "success"
  if (["failed", "failure", "payment_failed"].includes(raw)) return "failed"
  if (["cancelled", "canceled"].includes(raw)) return "cancelled"
  if (["expired", "payment_expired"].includes(raw)) return "expired"
  const createdAt = input.createdAt ? new Date(input.createdAt).getTime() : 0
  if (input.expiresAfterMs && createdAt && Date.now() - createdAt > input.expiresAfterMs) return "expired"
  if (["started", "initiated", "gateway_redirected", "payment_processing"].includes(raw)) return "processing"
  return "pending"
}
