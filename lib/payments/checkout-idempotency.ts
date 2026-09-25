import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { createDomainGatewayPaymentSession } from "@/lib/payment-gateways"
import { withRedisLock } from "@/lib/redis"
import { paymentFlowError, paymentFlowLog, taggedPaymentFlowError, taggedPaymentFlowLog } from "@/lib/payment-flow-log"

type CheckoutSessionCreateData = Prisma.CheckoutSessionUncheckedCreateInput
type PaymentCreateData = Prisma.PaymentUncheckedCreateInput
type PaymentAttemptCreateData = Prisma.PaymentAttemptUncheckedCreateInput

const ACTIVE_PAYMENT_STATUSES = ["created", "pending", "pending_manual", "waiting", "started", "initiated", "initializing", "authorized"]
const PAID_PAYMENT_STATUSES = ["completed", "paid", "success", "verification_pending"]

function isPrismaUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function isActivePayment(payment: any) {
  return ACTIVE_PAYMENT_STATUSES.includes(String(payment?.status || "").toLowerCase())
}

function isPaidPayment(payment: any) {
  return PAID_PAYMENT_STATUSES.includes(String(payment?.status || "").toLowerCase())
}

function hasGatewayOrder(payment: any) {
  const response = record(payment?.gatewayResponse)
  const checkout = record(response.checkout)
  return Boolean(String(payment?.gatewayOrderId || checkout.order_id || "").trim()) ||
    (payment?.gateway === "cashfree" && Boolean(payment?.gatewaySessionId))
}

function gatewayFlowTag(gateway: string): "CHECKOUT" | "RAZORPAY" | "PAYMENT" {
  if (gateway === "razorpay") return "RAZORPAY"
  return "PAYMENT"
}

async function advisoryLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
}

async function findCheckoutSession(identity: { idempotencyKey?: string | null; referenceId?: string | null; invoiceId?: string | null }, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  if (identity.invoiceId) {
    const byInvoice = await tx.checkoutSession.findFirst({
      where: { invoiceId: identity.invoiceId, purpose: "order_payment" },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } } },
      orderBy: [{ fulfilledAt: "desc" }, { createdAt: "asc" }],
    }).catch(() => null)
    if (byInvoice) return byInvoice
  }
  if (identity.idempotencyKey) {
    const byIdempotency = await tx.checkoutSession.findUnique({
      where: { idempotencyKey: identity.idempotencyKey },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    }).catch(() => null)
    if (byIdempotency) return byIdempotency
  }
  if (identity.referenceId) {
    return tx.checkoutSession.findUnique({
      where: { referenceId: identity.referenceId },
      include: { payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    }).catch(() => null)
  }
  return null
}

export function checkoutResumeState(session: any) {
  const payment = session?.payments?.[0] || null
  if (session?.fulfilledOrderId || isPaidPayment(payment)) {
    return {
      status: "paid",
      reason: "payment_already_completed",
      message: "Payment already completed. Redirecting...",
      paymentAlreadyCompleted: true,
    }
  }
  if (payment && isActivePayment(payment)) {
    return {
      status: "resuming",
      reason: "resuming_existing_payment",
      message: "Resuming existing payment...",
      reusedExistingPayment: true,
    }
  }
  return {
    status: "resuming",
    reason: "resuming_existing_checkout",
    message: "Your checkout is already active. Redirecting...",
    reusedExistingCheckout: true,
  }
}

export async function getOrCreateCheckoutSession(input: {
  data: CheckoutSessionCreateData
  requestId?: string | null
}) {
  const idempotencyKey = String(input.data.idempotencyKey || "").trim() || null
  const referenceId = String(input.data.referenceId || "").trim()
  const invoiceId = String(input.data.invoiceId || "").trim() || null
  const lockKey = `checkout-session:${invoiceId ? `invoice:${invoiceId}` : idempotencyKey || referenceId}`
  return withRedisLock(lockKey, 20_000, async () => {
    try {
      paymentFlowLog("Checkout session transaction started", {
        requestId: input.requestId || null,
        referenceId,
        transaction: "serializable",
        advisoryLockSql: "SELECT pg_advisory_xact_lock(hashtext($1))",
        rawMethod: "$executeRaw",
      })
      const result = await prisma.$transaction(async (tx) => {
        await advisoryLock(tx, lockKey)
        const existing = await findCheckoutSession({ idempotencyKey, referenceId, invoiceId }, tx)
        if (existing) {
          const state = checkoutResumeState(existing)
          paymentFlowLog("Checkout session reused", {
            requestId: input.requestId || null,
            checkoutSessionId: existing.id,
            referenceId: existing.referenceId,
            idempotencyKey,
            reason: state.reason,
          })
          taggedPaymentFlowLog("CHECKOUT", "Checkout session reused", {
            requestId: input.requestId || null,
            checkoutSessionId: existing.id,
            customerId: existing.customerId,
            invoiceId: existing.invoiceId || null,
            orderId: existing.fulfilledOrderId || null,
            reason: state.reason,
          })
          return { session: existing, reused: true, ...state }
        }

        const session = await tx.checkoutSession.upsert({
          where: idempotencyKey ? { idempotencyKey } : { referenceId },
          update: {},
          create: input.data,
        })
        paymentFlowLog("Checkout session created", {
          requestId: input.requestId || null,
          checkoutSessionId: session.id,
          referenceId: session.referenceId,
          idempotencyKey,
        })
        taggedPaymentFlowLog("CHECKOUT", "Checkout session created", {
          requestId: input.requestId || null,
          checkoutSessionId: session.id,
          customerId: session.customerId,
          invoiceId: session.invoiceId || null,
          orderId: session.fulfilledOrderId || null,
        })
        return {
          session: { ...session, payments: [] },
          reused: false,
          status: "prepared",
          reason: "checkout_session_prepared",
          message: "Checkout prepared.",
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      paymentFlowLog("Checkout session transaction committed", {
        requestId: input.requestId || null,
        checkoutSessionId: result.session.id,
        referenceId: result.session.referenceId,
        reused: result.reused,
        transaction: "serializable",
      })
      return result
    } catch (error) {
      if (!isPrismaUniqueError(error)) throw error
      const existing = await findCheckoutSession({ idempotencyKey, referenceId, invoiceId })
      if (!existing) throw error
      const state = checkoutResumeState(existing)
      paymentFlowLog("Checkout session unique conflict reused", {
        requestId: input.requestId || null,
        checkoutSessionId: existing.id,
        referenceId: existing.referenceId,
        idempotencyKey,
        reason: state.reason,
      })
      taggedPaymentFlowLog("CHECKOUT", "Checkout session unique conflict reused", {
        requestId: input.requestId || null,
        checkoutSessionId: existing.id,
        customerId: existing.customerId,
        invoiceId: existing.invoiceId || null,
        orderId: existing.fulfilledOrderId || null,
        reason: state.reason,
      })
      return { session: existing, reused: true, ...state }
    }
  })
}

async function findPaymentByIdentity(input: {
  gateway?: string | null
  paymentIdempotencyKey: string
  checkoutSessionId?: string | null
  merchantOrderId?: string | null
}) {
  const payment = await prisma.payment.findUnique({
    where: { idempotencyKey: input.paymentIdempotencyKey },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
  }).catch(() => null)
  if (payment) return payment
  const gateway = input.gateway ? String(input.gateway).toLowerCase() : ""
  if (input.checkoutSessionId) {
    return prisma.payment.findFirst({
      where: {
        checkoutSessionId: input.checkoutSessionId,
        ...(gateway ? { gateway } : {}),
        status: { in: [...ACTIVE_PAYMENT_STATUSES, ...PAID_PAYMENT_STATUSES] },
      },
      include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    }).catch(() => null)
  }
  if (input.merchantOrderId) {
    const attempt = await prisma.paymentAttempt.findFirst({
      where: {
        merchantOrderId: input.merchantOrderId,
        ...(gateway ? { gateway } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { payment: { include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } } },
    }).catch(() => null)
    return attempt?.payment || null
  }
  return null
}

async function claimPaymentInitialization(paymentId: string, gateway: string) {
  const claim = await prisma.payment.updateMany({
    where: {
      id: paymentId,
      gatewayOrderId: null,
      status: { in: ["created", "pending", "waiting", "started", "initiated"] },
    },
    data: { status: "initializing" },
  })
  return claim.count > 0
}

async function waitForInitializedPayment(paymentId: string) {
  for (let index = 0; index < 20; index++) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    }).catch(() => null)
    if (!payment || payment.gatewayOrderId || isPaidPayment(payment) || String(payment.status).toLowerCase() === "failed") return payment
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return prisma.payment.findUnique({
    where: { id: paymentId },
    include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
  }).catch(() => null)
}

export async function getOrCreateCheckoutPayment(input: {
  gateway: "razorpay" | "cashfree" | "phonepe"
  checkoutSessionId: string
  paymentData: PaymentCreateData
  paymentAttemptData: PaymentAttemptCreateData
  gatewayConfig: any
  customerDetails: { customerId: string; customerEmail?: string | null; customerPhone: string; customerName?: string | null }
  orderNote: string
  returnUrl: string
  webhookUrl: string
  invoiceNumber?: string | null
  requestId?: string | null
}) {
  const paymentIdempotencyKey = String(input.paymentData.idempotencyKey || "").trim()
  const merchantOrderId = String(input.paymentAttemptData.merchantOrderId || "").trim()
  if (!paymentIdempotencyKey) throw new Error("Payment idempotency key is required.")
  if (!merchantOrderId) throw new Error("Payment attempt merchant order id is required.")

  const lockKey = `${input.gateway}-checkout-payment:${input.checkoutSessionId}:${paymentIdempotencyKey}`
  return withRedisLock(lockKey, 20_000, async () => {
    let payment = await findPaymentByIdentity({ gateway: input.gateway, paymentIdempotencyKey, checkoutSessionId: input.checkoutSessionId, merchantOrderId })
    if (!payment) {
      try {
        paymentFlowLog("Checkout payment preparation transaction started", {
          requestId: input.requestId || null,
          checkoutSessionId: input.checkoutSessionId,
          merchantOrderId,
          transaction: "serializable",
        })
        const prepared = await prisma.$transaction(async (tx) => {
          await advisoryLock(tx, lockKey)
          const existing = await tx.payment.findUnique({
            where: { idempotencyKey: paymentIdempotencyKey },
            include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
          }).catch(() => null)
          if (existing) return existing

          const staleActive = await tx.payment.findFirst({
            where: {
              checkoutSessionId: input.checkoutSessionId,
              status: { in: ACTIVE_PAYMENT_STATUSES },
            },
            include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
            orderBy: { createdAt: "desc" },
          })
          if (staleActive) {
            const staleAttempt = staleActive.paymentAttempts?.[0]
            const sameGateway = staleActive.gateway === input.gateway
            const sameOrder = staleAttempt?.merchantOrderId === merchantOrderId
            const resumable = sameGateway && (hasGatewayOrder(staleActive) || sameOrder)
            if (!resumable) {
              paymentFlowLog("Superseding stale active checkout payment before creating a new one", {
                requestId: input.requestId || null,
                checkoutSessionId: input.checkoutSessionId,
                merchantOrderId,
                gateway: input.gateway,
                stalePaymentId: staleActive.id,
                staleGateway: staleActive.gateway || null,
                staleStatus: staleActive.status || null,
              })
              await tx.payment.update({
                where: { id: staleActive.id },
                data: { status: "superseded" },
              })
              await tx.paymentAttempt.updateMany({
                where: { paymentId: staleActive.id, status: { in: ACTIVE_PAYMENT_STATUSES } },
                data: { status: "superseded" },
              })
            } else {
              return staleActive
            }
          }

          const created = await tx.payment.upsert({
            where: { idempotencyKey: paymentIdempotencyKey },
            update: {},
            create: { ...input.paymentData, gateway: input.gateway, status: input.paymentData.status || "created" },
          })
          await tx.paymentAttempt.upsert({
            where: { merchantOrderId },
            update: { paymentId: created.id },
            create: { ...input.paymentAttemptData, paymentId: created.id, gateway: input.gateway, status: input.paymentAttemptData.status || "created" },
          })
          return tx.payment.findUnique({
            where: { id: created.id },
            include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
          }) as any
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
        payment = prepared
        paymentFlowLog("Checkout payment preparation transaction committed", {
          requestId: input.requestId || null,
          checkoutSessionId: input.checkoutSessionId,
          paymentId: prepared?.id || null,
          merchantOrderId,
          transaction: "serializable",
        })
      } catch (error) {
        if (!isPrismaUniqueError(error)) throw error
        payment = await findPaymentByIdentity({ gateway: input.gateway, paymentIdempotencyKey, checkoutSessionId: input.checkoutSessionId, merchantOrderId })
        if (!payment) {
          paymentFlowLog("Checkout payment unique-constraint retry", {
            requestId: input.requestId || null,
            checkoutSessionId: input.checkoutSessionId,
            merchantOrderId,
            gateway: input.gateway,
            reason: "unique-constraint-conflict",
          })
          const retried = await prisma.$transaction(async (tx) => {
            await advisoryLock(tx, lockKey)
            await tx.payment.updateMany({
              where: { checkoutSessionId: input.checkoutSessionId, status: { in: ACTIVE_PAYMENT_STATUSES } },
              data: { status: "superseded" },
            })
            await tx.paymentAttempt.updateMany({
              where: { status: { in: ACTIVE_PAYMENT_STATUSES } },
              data: { status: "superseded" },
            })
            const created = await tx.payment.upsert({
              where: { idempotencyKey: paymentIdempotencyKey },
              update: {},
              create: { ...input.paymentData, gateway: input.gateway, status: input.paymentData.status || "created" },
            })
            await tx.paymentAttempt.upsert({
              where: { merchantOrderId },
              update: { paymentId: created.id },
              create: { ...input.paymentAttemptData, paymentId: created.id, gateway: input.gateway, status: input.paymentAttemptData.status || "created" },
            })
            return tx.payment.findUnique({
              where: { id: created.id },
              include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
            }) as any
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
          payment = retried
        }
      }
    }

    if (!payment) throw new Error("Payment could not be prepared.")
    if (hasGatewayOrder(payment) || isPaidPayment(payment)) {
      return {
        payment,
        attempt: payment.paymentAttempts?.[0] || null,
        reused: true,
        ...checkoutResumeState({ payments: [payment], fulfilledOrderId: null }),
      }
    }

    const claimed = await claimPaymentInitialization(payment.id, input.gateway)
    if (!claimed) {
      const initialized = await waitForInitializedPayment(payment.id)
      if (initialized && (hasGatewayOrder(initialized) || isPaidPayment(initialized))) {
        return {
          payment: initialized,
          attempt: initialized.paymentAttempts?.[0] || null,
          reused: true,
          ...checkoutResumeState({ payments: [initialized], fulfilledOrderId: null }),
        }
      }
      payment = initialized || payment
    }

    let session
    try {
      paymentFlowLog("Gateway order creation started", {
        requestId: input.requestId || null,
        checkoutSessionId: input.checkoutSessionId,
        paymentId: payment.id,
        merchantOrderId,
        gateway: input.gateway,
      })
      session = await createDomainGatewayPaymentSession({
        gateway: input.gateway,
        orderId: merchantOrderId,
        amount: Number(input.paymentData.gatewayAmount || input.paymentData.amount),
        currency: String(input.paymentData.currency || "INR"),
        customerDetails: {
          customerId: input.customerDetails.customerId,
          customerEmail: input.customerDetails.customerEmail || undefined,
          customerPhone: input.customerDetails.customerPhone,
          customerName: input.customerDetails.customerName || undefined,
        },
        orderNote: input.orderNote,
        returnUrl: input.returnUrl,
        webhookUrl: input.webhookUrl,
        gatewayConfig: input.gatewayConfig,
        invoiceNumber: input.invoiceNumber,
        invoiceId: input.paymentData.invoiceId || null,
      })
      paymentFlowLog("Gateway order creation completed", {
        requestId: input.requestId || null,
        checkoutSessionId: input.checkoutSessionId,
        paymentId: payment.id,
        merchantOrderId,
        gateway: input.gateway,
        gatewayOrderId: session.gatewayOrderId || null,
      })
    } catch (error) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => null)
      paymentFlowError("Gateway order initialization failed", error, {
        requestId: input.requestId || null,
        checkoutSessionId: input.checkoutSessionId,
        paymentId: payment.id,
        merchantOrderId,
        gateway: input.gateway,
      })
      taggedPaymentFlowError(gatewayFlowTag(input.gateway), "Gateway order initialization failed", error, {
        requestId: input.requestId || null,
        checkoutSessionId: input.checkoutSessionId,
        paymentId: payment.id,
        orderId: input.paymentData.orderId || null,
        invoiceId: input.paymentData.invoiceId || null,
        customerId: input.paymentData.customerId || null,
        gatewayOrderId: null,
      })
      throw error
    }

    paymentFlowLog("Checkout payment persistence transaction started", {
      requestId: input.requestId || null,
      checkoutSessionId: input.checkoutSessionId,
      paymentId: payment.id,
      merchantOrderId,
      gatewayOrderId: session.gatewayOrderId || null,
      transaction: "serializable",
    })
    const updated = await prisma.$transaction(async (tx) => {
      await advisoryLock(tx, lockKey)
      const current = await tx.payment.findUnique({ where: { id: payment!.id } })
      if (current?.gatewayOrderId && current.gatewayOrderId !== session.gatewayOrderId) {
        return tx.payment.findUnique({
          where: { id: current.id },
          include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
        }) as any
      }
      const saved = await tx.payment.update({
        where: { id: payment!.id },
        data: {
          gatewayOrderId: session.gatewayOrderId,
          gatewayPaymentId: session.gatewayPaymentId,
          transactionId: session.gatewayTransactionId,
          gatewayTransactionId: session.gatewayTransactionId,
          gatewaySessionId: session.gatewaySessionId,
          status: "pending",
          gatewayResponse: session.raw as any,
        },
      })
      await tx.paymentAttempt.upsert({
        where: { merchantOrderId },
        update: {
          paymentId: saved.id,
          gatewayOrderId: session.gatewayOrderId,
          gatewayPaymentId: session.gatewayPaymentId,
          gatewayTransactionId: session.gatewayTransactionId,
          status: "started",
          redirectUrl: session.redirectUrl,
          returnUrl: input.returnUrl,
          rawGatewayResponse: session.raw as any,
        },
        create: {
          ...input.paymentAttemptData,
          paymentId: saved.id,
          gateway: input.gateway,
          gatewayOrderId: session.gatewayOrderId,
          gatewayPaymentId: session.gatewayPaymentId,
          gatewayTransactionId: session.gatewayTransactionId,
          status: "started",
          redirectUrl: session.redirectUrl,
          returnUrl: input.returnUrl,
          rawGatewayResponse: session.raw as any,
        },
      })
      await tx.checkoutSession.update({
        where: { id: input.checkoutSessionId },
        data: { status: "gateway_redirected", gateway: input.gateway, invoiceId: input.paymentData.invoiceId || undefined },
      }).catch(() => null)
      return tx.payment.findUnique({
        where: { id: saved.id },
        include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
      }) as any
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    paymentFlowLog("Checkout payment persistence transaction committed", {
      requestId: input.requestId || null,
      checkoutSessionId: input.checkoutSessionId,
      paymentId: updated?.id || payment.id,
      merchantOrderId,
      gatewayOrderId: session.gatewayOrderId || null,
      transaction: "serializable",
    })

    paymentFlowLog("Gateway checkout payment ready", {
      requestId: input.requestId || null,
      checkoutSessionId: input.checkoutSessionId,
      paymentId: updated?.id || payment.id,
      merchantOrderId,
      gateway: input.gateway,
      gatewayOrderId: session.gatewayOrderId || null,
    })
    taggedPaymentFlowLog(gatewayFlowTag(input.gateway), "Gateway checkout payment ready", {
      requestId: input.requestId || null,
      checkoutSessionId: input.checkoutSessionId,
      paymentId: updated?.id || payment.id,
      orderId: updated?.orderId || input.paymentData.orderId || null,
      invoiceId: updated?.invoiceId || input.paymentData.invoiceId || null,
      customerId: updated?.customerId || input.paymentData.customerId || null,
      gatewayOrderId: session.gatewayOrderId || null,
    })
    return {
      payment: updated,
      attempt: updated?.paymentAttempts?.[0] || null,
      reused: false,
      status: "gateway_started",
      reason: "gateway_initiated",
      message: `Opening secure ${input.gateway === "cashfree" ? "Cashfree" : input.gateway === "phonepe" ? "PhonePe" : "Razorpay"} checkout...`,
    }
  })
}
