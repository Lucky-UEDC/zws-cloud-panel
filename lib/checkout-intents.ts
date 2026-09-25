import { prisma } from "@/lib/db"
import { createPendingDedicatedServiceForOrder, markDedicatedPaymentConfirmed } from "@/lib/dedicated"
import { finalizePaidOrder } from "@/lib/payment-finalization"
import { enqueueProvisioningJob } from "@/lib/provision"

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

export async function fulfillCheckoutIntent(input: {
  checkoutIntentId: string
  paymentId?: string | null
  invoiceId?: string | null
  actor?: string
  manualVerification?: boolean
  autoProvision?: boolean
  transactionId?: string | null
}) {
  const actor = input.actor || "system"
  const intent = await prisma.checkoutIntent.findUnique({
    where: { id: input.checkoutIntentId },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  if (!intent) return { fulfilled: false, reason: "checkout_intent_not_found" }
  if (intent.fulfilledOrderId) {
    const finalized = await finalizePaidOrder({
      orderId: intent.fulfilledOrderId,
      paymentId: input.paymentId || intent.payments[0]?.id || null,
      invoiceId: input.invoiceId || intent.invoiceId || null,
      actor,
      manualVerification: input.manualVerification,
      autoProvision: input.autoProvision,
      purpose: intent.purpose,
      transactionId: input.transactionId || null,
    })
    return { fulfilled: true, orderId: intent.fulfilledOrderId, reused: true, finalized }
  }

  const snapshot = record(intent.snapshot)
  const orderData = record(snapshot.orderData)
  const bulkOrders = Array.isArray(snapshot.bulkOrders)
    ? snapshot.bulkOrders.map((item) => record(item)).filter((item) => Object.keys(item).length)
    : []
  if (!Object.keys(orderData).length && !bulkOrders.length) return { fulfilled: false, reason: "checkout_intent_snapshot_missing" }
  console.info("[CheckoutIntent] fulfill start", {
    checkoutIntentId: intent.id,
    invoiceId: input.invoiceId || intent.invoiceId || null,
    paymentId: input.paymentId || intent.payments[0]?.id || null,
    orderCount: bulkOrders.length || 1,
    autoProvision: input.autoProvision !== false,
  })

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.checkoutIntent.findUnique({ where: { id: intent.id } })
    if (!current) throw new Error("Checkout intent disappeared")
    if (current.fulfilledOrderId) return { orderId: current.fulfilledOrderId, reused: true }

    const orderInputs = bulkOrders.length ? bulkOrders : [orderData]
    const orders = []
    for (const inputOrder of orderInputs) {
      orders.push(await tx.order.create({ data: inputOrder as any }))
    }
    const order = orders[0]
    const offerCounts = new Map<string, number>()
    for (const created of orders) {
      if (created.offerId) offerCounts.set(created.offerId, (offerCounts.get(created.offerId) || 0) + 1)
    }
    for (const [offerId, count] of offerCounts) {
      await tx.offer.update({ where: { id: offerId }, data: { purchasesCount: { increment: count } } })
    }
    const invoiceId = input.invoiceId || current.invoiceId || null
    const paymentId = input.paymentId || intent.payments[0]?.id || null
    const fulfilledOrderIds = orders.map((entry) => entry.id)

    if (invoiceId) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          orderId: order.id,
          status: input.manualVerification ? "verification_pending" : "paid",
          paidAt: new Date(),
          paymentTransactionId: input.transactionId || undefined,
          metadata: {
            fulfilledOrderIds,
            primaryOrderId: order.id,
          },
        },
      })
    }
    if (paymentId) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          orderId: order.id,
          invoiceId,
          status: input.manualVerification ? "verification_pending" : "completed",
          completedAt: new Date(),
          webhookProcessedAt: new Date(),
          ...(input.transactionId ? { transactionId: input.transactionId, gatewayTransactionId: input.transactionId } : {}),
        },
      })
    }

    await tx.checkoutIntent.update({
      where: { id: current.id },
      data: {
        status: input.manualVerification ? "verification_pending" : "fulfilled",
        fulfilledOrderId: order.id,
        fulfilledAt: new Date(),
        snapshot: {
          ...snapshot,
          fulfilledOrderIds,
          primaryOrderId: order.id,
        } as any,
      },
    })

    return { orderId: order.id, orderIds: fulfilledOrderIds, reused: false }
  }, { isolationLevel: "Serializable" })

  const dedicated = record(snapshot.dedicatedService)
  if (String(orderData.orderType || "").toLowerCase() === "dedicated" && dedicated.productId) {
    await createPendingDedicatedServiceForOrder({
      orderId: result.orderId,
      customerId: intent.customerId,
      productId: String(dedicated.productId),
      osOptionId: dedicated.osOptionId || null,
      hostname: dedicated.hostname || null,
      installationNotes: dedicated.installationNotes || null,
      sshPublicKey: dedicated.sshPublicKey || null,
      ipmiRequired: Boolean(dedicated.ipmiRequired),
      deliverySlaHours: Number(dedicated.deliverySlaHours || 72),
    })
  }

  if (String(orderData.orderType || "").toLowerCase() === "dedicated") {
    await markDedicatedPaymentConfirmed(result.orderId, actor)
  }

  const finalized = await finalizePaidOrder({
    orderId: result.orderId,
    paymentId: input.paymentId || intent.payments[0]?.id || null,
    invoiceId: input.invoiceId || intent.invoiceId || null,
    actor,
    manualVerification: input.manualVerification,
    autoProvision: input.autoProvision,
    purpose: intent.purpose,
    transactionId: input.transactionId || null,
  })
  console.info("[CheckoutIntent] fulfill finalized", {
    checkoutIntentId: intent.id,
    orderId: result.orderId,
    orderCount: ((result as any).orderIds || [result.orderId]).length,
    jobId: finalized?.jobId || finalized?.existingJobId || null,
  })
  const extraOrderIds = ((result as any).orderIds || []).filter((orderId: string) => orderId !== result.orderId)
  for (const orderId of extraOrderIds) {
    const existing = await prisma.order.findUnique({ where: { id: orderId }, select: { metadata: true } }).catch(() => null)
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: input.manualVerification ? "verification_pending" : "paid",
        provisioningError: null,
        metadata: {
          ...record(existing?.metadata),
          paymentProcessed: !input.manualVerification,
          paymentProcessedAt: input.manualVerification ? null : new Date().toISOString(),
          paymentVerification: {
            verified: !input.manualVerification,
            paymentId: input.paymentId || intent.payments[0]?.id || null,
            primaryOrderId: result.orderId,
            checkoutIntentId: intent.id,
            transactionId: input.transactionId || null,
            actor,
            verifiedAt: input.manualVerification ? null : new Date().toISOString(),
          },
        },
      },
    }).catch(() => null)
    if (!input.manualVerification && input.autoProvision !== false) {
      await enqueueProvisioningJob(orderId, actor).catch(() => null)
    }
  }

  return { fulfilled: true, orderId: result.orderId, orderIds: (result as any).orderIds || [result.orderId], reused: result.reused, finalized }
}
