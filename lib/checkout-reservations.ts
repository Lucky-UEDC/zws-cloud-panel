import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"

const EXPIRABLE_STATUSES = ["pending", "pending_payment", "payment_failed", "created"]

export async function releaseExpiredCheckoutReservations(now = new Date()) {
  const abandonedBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const abandoned = await prisma.checkoutSession.findMany({
    where: {
      createdAt: { lt: abandonedBefore },
      invoiceId: null,
      fulfilledOrderId: null,
      paidAt: null,
      payments: { none: {} },
      status: { in: ["pending", "pending_payment", "payment_failed", "created", "reservation_expired", "payment_expired"] },
    },
    select: { id: true, referenceId: true, customerId: true, status: true, createdAt: true },
    take: 250,
  })
  let deleted = 0
  for (const session of abandoned) {
    await prisma.checkoutSession.delete({ where: { id: session.id } }).then(() => { deleted++ }).catch(() => null)
    await createPanelLog({
      category: "Payment",
      level: "info",
      message: "checkout_session_abandoned_deleted",
      customerId: session.customerId,
      metadata: {
        checkoutSessionId: session.id,
        referenceId: session.referenceId,
        previousStatus: session.status,
        createdAt: session.createdAt.toISOString(),
      },
    }).catch(() => null)
  }

  const sessions = await prisma.checkoutSession.findMany({
    where: {
      reservationExpiresAt: { lte: now },
      reservationReleasedAt: null,
      fulfilledOrderId: null,
      paidAt: null,
      status: { in: EXPIRABLE_STATUSES },
    },
    select: { id: true, referenceId: true, customerId: true, invoiceId: true, status: true, reservationExpiresAt: true },
    take: 250,
  })
  let released = 0
  for (const session of sessions) {
    await prisma.$transaction(async (tx) => {
      await tx.checkoutSession.update({
        where: { id: session.id },
        data: {
          status: "reservation_expired",
          reservationReleasedAt: now,
        },
      })
      await tx.payment.updateMany({
        where: {
          checkoutSessionId: session.id,
          status: { in: ["created", "pending", "pending_manual", "waiting", "started", "initializing", "authorized"] },
        },
        data: { status: "expired", errorMessage: "Checkout inventory reservation expired before payment." },
      }).catch(() => null)
      await tx.paymentAttempt.updateMany({
        where: {
          payment: { checkoutSessionId: session.id },
          status: { in: ["created", "pending", "pending_manual", "waiting", "started", "initializing", "authorized"] },
        },
        data: { status: "expired", failureCode: "reservation_expired", failureMessage: "Checkout inventory reservation expired before payment." },
      } as any).catch(() => null)
    })
    released++
    await createPanelLog({
      category: "Payment",
      level: "info",
      message: "checkout_reservation_expired",
      customerId: session.customerId,
      metadata: {
        checkoutSessionId: session.id,
        referenceId: session.referenceId,
        previousStatus: session.status,
        reservationExpiresAt: session.reservationExpiresAt?.toISOString?.() || null,
      },
    }).catch(() => null)
  }
  return { scanned: sessions.length + abandoned.length, released, deleted }
}
