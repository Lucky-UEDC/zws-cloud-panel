import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getGatewayDriver } from "@/lib/payments/gateway-drivers"
import { finalizeSuccessfulPayment } from "@/lib/payment-finalization"

const STOP_INVOICE_STATUSES = new Set(["paid", "cancelled", "canceled", "void", "refunded"])

export async function processPaymentRetryBatch(limit = 50) {
  const jobs = await prisma.$transaction(async (tx) => {
    const ids = await (tx as any).$queryRaw(Prisma.sql`SELECT id FROM payment_retry_queue WHERE status = 'pending' AND held_at IS NULL AND (retry_after IS NULL OR retry_after <= NOW()) ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT ${limit}`) as Array<{ id: string }>
    if (!ids.length) return []
    await (tx as any).paymentRetryQueue.updateMany({ where: { id: { in: ids.map((row) => row.id) } }, data: { status: "processing", lastAttemptAt: new Date(), attempts: { increment: 1 } } })
    return (tx as any).paymentRetryQueue.findMany({ where: { id: { in: ids.map((row) => row.id) } } })
  })
  const results = []
  for (const job of jobs) results.push(await processOne(job))
  return results
}

async function processOne(job: any) {
  const invoice = job.invoiceId ? await prisma.invoice.findUnique({ where: { id: job.invoiceId } }).catch(() => null) : null
  if (invoice && STOP_INVOICE_STATUSES.has(String(invoice.status).toLowerCase())) {
    await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "stopped", lastErrorCode: `invoice_${String(invoice.status).toLowerCase()}` } })
    return { id: job.id, status: "stopped" }
  }
  const attempt = await prisma.paymentAttempt.findFirst({ where: { ...(job.paymentId ? { paymentId: job.paymentId } : {}), ...(job.invoiceId ? { invoiceId: job.invoiceId } : {}), gateway: job.gateway }, include: { gatewayConfig: true }, orderBy: { createdAt: "desc" } })
  if (!attempt?.gatewayOrderId || !attempt.gatewayConfig) {
    await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "held", heldAt: new Date(), heldBy: "system", lastErrorCode: "retry_context_missing" } })
    return { id: job.id, status: "held" }
  }
  const driver = getGatewayDriver(job.gateway)
  try {
    const verification = await driver.verify({ gatewayConfig: attempt.gatewayConfig, gatewayOrderId: attempt.gatewayOrderId })
    if (verification.state === "captured") {
      const finalized = await finalizeSuccessfulPayment(attempt.id, { actor: "worker:payment-retry", amount: verification.amount, currency: verification.currency, gatewayOrderId: attempt.gatewayOrderId, gatewayPaymentId: verification.gatewayPaymentId, gatewayResponse: verification.raw })
      if (!finalized.finalized) throw Object.assign(new Error(String(finalized.reason || "Finalization failed")), { retryable: true, code: finalized.reason })
      await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "completed", lastErrorCode: null } })
      return { id: job.id, status: "completed" }
    }
    if (verification.state === "failed") {
      await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "held", heldAt: new Date(), heldBy: "system", lastErrorCode: `gateway_${verification.status}` } })
      return { id: job.id, status: "held" }
    }
    const delay = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(job.attempts, 10))
    await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "pending", retryAfter: new Date(Date.now() + delay), lastErrorCode: `gateway_${verification.status}` } })
    return { id: job.id, status: "pending" }
  } catch (error) {
    const failure = driver.classifyError(error, "verify")
    if (!failure.retryable) {
      await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "held", heldAt: new Date(), heldBy: "system", lastErrorCode: failure.code, reason: failure.safeMessage } })
      return { id: job.id, status: "held" }
    }
    const delay = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(job.attempts, 10))
    await (prisma as any).paymentRetryQueue.update({ where: { id: job.id }, data: { status: "pending", retryAfter: new Date(Date.now() + delay), lastErrorCode: failure.code, reason: failure.safeMessage } })
    return { id: job.id, status: "pending" }
  }
}
