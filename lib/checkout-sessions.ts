import { prisma } from "@/lib/db"
import { createPendingDedicatedServiceForOrder, markDedicatedPaymentConfirmed } from "@/lib/dedicated"
import { finalizePaidOrder } from "@/lib/payment-finalization"
import { enqueueProvisioningJob } from "@/lib/provision"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function orderList(snapshot: Record<string, any>) {
  const orderData = record(snapshot.orderData)
  const bulkOrders = Array.isArray(snapshot.bulkOrders)
    ? snapshot.bulkOrders.map((item) => record(item)).filter((item) => Object.keys(item).length)
    : []
  return bulkOrders.length ? bulkOrders : Object.keys(orderData).length ? [orderData] : []
}

export async function fulfillCheckoutSession(input: {
  checkoutSessionId: string
  paymentId?: string | null
  actor?: string
  manualVerification?: boolean
  autoProvision?: boolean
  transactionId?: string | null
}) {
  const actor = input.actor || "system"
  const session = await prisma.checkoutSession.findUnique({
    where: { id: input.checkoutSessionId },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  })
  if (!session) return { fulfilled: false, reason: "checkout_session_not_found" }

  const paymentId = input.paymentId || session.payments[0]?.id || null
  if (session.fulfilledOrderId) {
    paymentFlowLog("Checkout session already fulfilled", { checkoutSessionId: session.id, orderId: session.fulfilledOrderId, paymentId })
    const finalized = await finalizePaidOrder({
      orderId: session.fulfilledOrderId,
      paymentId,
      actor,
      manualVerification: input.manualVerification,
      autoProvision: input.autoProvision,
      purpose: session.purpose,
      transactionId: input.transactionId || null,
    })
    return { fulfilled: true, orderId: session.fulfilledOrderId, reused: true, finalized }
  }

  const snapshot = record(session.snapshot)
  const ordersInput = orderList(snapshot)
  if (!ordersInput.length) {
    paymentFlowLog("Checkout session snapshot missing", { checkoutSessionId: session.id, referenceId: session.referenceId, invoiceId: session.invoiceId || null, paymentId })
    return { fulfilled: false, reason: "checkout_session_snapshot_missing" }
  }

  paymentFlowLog("Checkout session fulfillment started", { checkoutSessionId: session.id, referenceId: session.referenceId, paymentId, orderCount: ordersInput.length })
  console.info("[CheckoutSession] fulfill start", {
    checkoutSessionId: session.id,
    referenceId: session.referenceId,
    paymentId,
    orderCount: ordersInput.length,
    autoProvision: input.autoProvision !== false,
  })

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.checkoutSession.findUnique({ where: { id: session.id } })
    if (!current) throw new Error("Checkout session disappeared")
    if (current.fulfilledOrderId) return { orderId: current.fulfilledOrderId, orderIds: [current.fulfilledOrderId], reused: true }

    let customConfigId: string | null = null
    const pendingCustomConfig = record(snapshot.pendingCustomConfig)
    if (Object.keys(pendingCustomConfig).length && session.customerId) {
      const created = await tx.customConfig.create({
        data: {
          customerId: session.customerId,
          cpuCores: Number(pendingCustomConfig.cpuCores || 0),
          ramGb: Number(pendingCustomConfig.ramGb || 0),
          disks: (Array.isArray(pendingCustomConfig.disks) ? pendingCustomConfig.disks : []) as any,
          bandwidthTb: Number(pendingCustomConfig.bandwidthTb || 0),
          termMonths: Number(pendingCustomConfig.termMonths || 1),
          monthlyPrice: Number(pendingCustomConfig.monthlyPrice || 0),
          totalPrice: Number(pendingCustomConfig.totalPrice || 0),
          status: "active",
        },
      })
      customConfigId = created.id
    }

    const orders = []
    for (const source of ordersInput) {
      const inputOrder = { ...source }
      if (customConfigId && !inputOrder.customConfigId) inputOrder.customConfigId = customConfigId
      orders.push(await tx.order.create({ data: inputOrder as any }))
    }
    const primaryOrder = orders[0]
    const orderIds = orders.map((order) => order.id)

    const offerCounts = new Map<string, number>()
    for (const created of orders) {
      if (created.offerId) offerCounts.set(created.offerId, (offerCounts.get(created.offerId) || 0) + 1)
    }
    for (const [offerId, count] of offerCounts) {
      await tx.offer.update({ where: { id: offerId }, data: { purchasesCount: { increment: count } } })
    }

    if (paymentId) {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          orderId: primaryOrder.id,
          status: input.manualVerification ? "verification_pending" : "completed",
          completedAt: new Date(),
          webhookProcessedAt: new Date(),
          ...(input.transactionId ? { transactionId: input.transactionId, gatewayTransactionId: input.transactionId } : {}),
        },
      })
      await tx.paymentAttempt.updateMany({
        where: { paymentId },
        data: { orderId: primaryOrder.id, invoiceId: session.invoiceId || undefined },
      })
    }
    if (session.invoiceId) {
      const currentInvoice = await tx.invoice.findUnique({ where: { id: session.invoiceId }, select: { metadata: true } })
      await tx.invoice.update({
        where: { id: session.invoiceId },
        data: {
          orderId: primaryOrder.id,
          metadata: {
            ...record(currentInvoice?.metadata),
            primaryOrderId: primaryOrder.id,
            fulfilledCheckoutSessionId: session.id,
          },
        },
      }).catch((error) => {
        paymentFlowError("Invoice link during checkout fulfillment failed", error, { checkoutSessionId: session.id, invoiceId: session.invoiceId, orderId: primaryOrder.id })
        throw error
      })
    }

    await tx.checkoutSession.update({
      where: { id: current.id },
      data: {
        status: input.manualVerification ? "verification_pending" : "fulfilled",
        fulfilledOrderId: primaryOrder.id,
        paidAt: new Date(),
        fulfilledAt: new Date(),
        reservationReleasedAt: new Date(),
        snapshot: {
          ...snapshot,
          fulfilledOrderIds: orderIds,
          primaryOrderId: primaryOrder.id,
          customConfigId,
        } as any,
      },
    })

    return { orderId: primaryOrder.id, orderIds, reused: false }
  }, { isolationLevel: "Serializable" })

  const orderData = record(snapshot.orderData)
  const dedicated = record(snapshot.dedicatedService)
  if (String(orderData.orderType || "").toLowerCase() === "dedicated" && dedicated.productId) {
    await createPendingDedicatedServiceForOrder({
      orderId: result.orderId,
      customerId: session.customerId,
      productId: String(dedicated.productId),
      osOptionId: dedicated.osOptionId || null,
      hostname: dedicated.hostname || null,
      installationNotes: dedicated.installationNotes || null,
      sshPublicKey: dedicated.sshPublicKey || null,
      ipmiRequired: Boolean(dedicated.ipmiRequired),
      deliverySlaHours: Number(dedicated.deliverySlaHours || 72),
    })
    await markDedicatedPaymentConfirmed(result.orderId, actor)
  }

  const finalized = await finalizePaidOrder({
    orderId: result.orderId,
    paymentId,
    actor,
    manualVerification: input.manualVerification,
    autoProvision: input.autoProvision,
    purpose: session.purpose,
    transactionId: input.transactionId || null,
  })
  if (!(finalized as any).finalized) {
    paymentFlowLog("Checkout session finalization failed", { checkoutSessionId: session.id, orderId: result.orderId, reason: (finalized as any).reason || null })
  }

  console.info("[CheckoutSession] fulfill finalized", {
    checkoutSessionId: session.id,
    orderId: result.orderId,
    orderCount: result.orderIds.length,
    jobId: finalized?.jobId || finalized?.existingJobId || null,
  })

  for (const orderId of result.orderIds.filter((id) => id !== result.orderId)) {
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
            paymentId,
            primaryOrderId: result.orderId,
            checkoutSessionId: session.id,
            transactionId: input.transactionId || null,
            actor,
            verifiedAt: input.manualVerification ? null : new Date().toISOString(),
          },
        },
      },
    }).catch(() => null)
    if (!input.manualVerification && input.autoProvision !== false) {
      try {
        const job = await enqueueProvisioningJob(orderId, actor)
        paymentFlowLog("Provision job queued", { orderId, jobId: job?.id || null, source: "checkout_session_secondary_order" })
      } catch (error) {
        paymentFlowError("Provision job queue failed", error, { orderId, checkoutSessionId: session.id, source: "checkout_session_secondary_order" })
        throw error
      }
    }
  }

  return { fulfilled: true, orderId: result.orderId, orderIds: result.orderIds, reused: result.reused, finalized }
}
