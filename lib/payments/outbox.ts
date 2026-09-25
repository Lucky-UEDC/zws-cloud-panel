import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

export type PaymentOutboxInput = {
  eventType: string
  aggregateType: string
  aggregateId: string
  idempotencyKey: string
  payload: Record<string, unknown>
  availableAt?: Date
}

export async function enqueuePaymentOutbox(tx: any, event: PaymentOutboxInput) {
  return tx.paymentOutboxEvent.upsert({
    where: { idempotencyKey: event.idempotencyKey },
    update: {},
    create: { ...event, availableAt: event.availableAt || new Date() },
  })
}

export async function claimPaymentOutboxBatch(workerId: string, limit = 50) {
  return prisma.$transaction(async (tx) => {
    const rows = await (tx as any).$queryRaw(Prisma.sql`
      SELECT id FROM payment_outbox_events
      WHERE status IN ('pending', 'retry') AND available_at <= NOW()
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED LIMIT ${limit}
    `) as Array<{ id: string }>
    if (!rows.length) return []
    const ids = rows.map((row) => row.id)
    await (tx as any).paymentOutboxEvent.updateMany({ where: { id: { in: ids } }, data: { status: "processing", lockedAt: new Date(), lockedBy: workerId, attempts: { increment: 1 } } })
    return (tx as any).paymentOutboxEvent.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
}

export async function completePaymentOutbox(id: string) {
  return (prisma as any).paymentOutboxEvent.update({ where: { id }, data: { status: "processed", processedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } })
}

export async function retryPaymentOutbox(id: string, attempts: number, error: unknown) {
  const delay = Math.min(6 * 60 * 60_000, 15_000 * 2 ** Math.min(attempts, 10))
  return (prisma as any).paymentOutboxEvent.update({ where: { id }, data: { status: "retry", availableAt: new Date(Date.now() + delay), lockedAt: null, lockedBy: null, lastError: String(error instanceof Error ? error.message : error).slice(0, 500) } })
}
