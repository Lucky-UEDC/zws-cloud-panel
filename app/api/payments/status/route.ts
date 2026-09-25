import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAdminFromRequest, getClientFromRequest } from '@/lib/server-auth'
import { getCashfreeMode } from '@/lib/cashfree'
import { reconcileCashfreeOrder } from '@/lib/payment-reconciliation'
import { getSetting, type PlatformSettings } from '@/lib/settings'
import { isWalletTopupPurpose } from '@/lib/wallet-topup'
import { paymentStatusForClient } from '@/lib/payment-state'

const PAYMENT_PENDING_TIMEOUT_MS = 15 * 60 * 1000

async function toResponse(order: any, payment: any, invoice: any) {
  const platform = await getSetting<PlatformSettings>("platform_settings").catch(() => ({ environmentMode: "test" }))
  const rawStatus = String(payment?.status || order.status || '').toLowerCase()
  const verifiedAt = payment?.paymentAttempts?.[0]?.webhookVerifiedAt || payment?.completedAt || null
  const verified = ['completed', 'paid', 'success'].includes(rawStatus) && Boolean(verifiedAt || payment?.gateway === "wallet")
  // Legacy contract was: status = verified ? 'paid' : failed ? 'failed' : 'pending'.
  // Public responses now use canonical success/failed/pending states while preserving verified.
  const status = paymentStatusForClient({ rawStatus, verified, createdAt: payment?.createdAt || order.createdAt, expiresAfterMs: PAYMENT_PENDING_TIMEOUT_MS })
  const upgradeVpsId = String(order?.metadata?.upgrade?.vpsInstanceId || "")
  const vpsInstanceId = order.vpsInstance?.id || upgradeVpsId || null
  const dedicatedServiceId = order.dedicatedService?.id || null
  const invoiceId = invoice?.id || null
  const isUpgrade = Boolean(upgradeVpsId)
  const isDedicated = String(order?.orderType || "").toLowerCase() === "dedicated"
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    invoiceId,
    serviceId: vpsInstanceId || dedicatedServiceId || null,
    vpsInstanceId,
    dedicatedServiceId,
    redirectUrl: isUpgrade && vpsInstanceId
      ? `/client-area/vps/${vpsInstanceId}`
      : dedicatedServiceId
        ? `/client-area/dedicated/${dedicatedServiceId}`
        : isDedicated
          ? (invoiceId ? `/client-area/billing/invoices/${invoiceId}` : "/client-area/billing/invoices")
        : verified
          ? `/client-area/deployments/${order.id}`
        : invoiceId
          ? `/client-area/billing/invoices/${invoiceId}`
          : '/client-area/billing/invoices',
    amount: Number(order.totalAmount),
    currency: order.currency || payment?.currency || invoice?.currency || "INR",
    status,
    rawStatus,
    paymentStatus: payment?.status || order.status || null,
    provisioningStatus: order.provisioningStatus || null,
    transactionId: payment?.gatewayTransactionId || payment?.transactionId || payment?.gatewayPaymentId || null,
    verifiedAt,
    paymentMethod: payment?.paymentMethod || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    completedAt: payment?.completedAt || null,
    mode: getCashfreeMode(),
    gateway: payment?.gateway || 'cashfree',
    environmentMode: (platform as any).environmentMode || "test",
    testMode: ((platform as any).environmentMode || "test") !== "production",
    paymentSessionId: payment?.gatewaySessionId || null,
    verified,
    reason: verified ? 'payment_verified' : status === "expired" ? "payment_expired" : status === "failed" ? "payment_failed" : 'payment_pending',
  }
}

async function walletTopupResponse(payment: any) {
  const platform = await getSetting<PlatformSettings>("platform_settings").catch(() => ({ environmentMode: "test" }))
  const rawStatus = String(payment.status || payment.invoice?.status || "pending").toLowerCase()
  const verifiedAt = payment.paymentAttempts?.[0]?.webhookVerifiedAt || payment.completedAt || payment.invoice?.paidAt || null
  const verified = ["completed", "paid", "success"].includes(rawStatus) && Boolean(verifiedAt || payment.gateway === "wallet")
  const status = paymentStatusForClient({ rawStatus, verified, createdAt: payment.createdAt, expiresAfterMs: PAYMENT_PENDING_TIMEOUT_MS })
  return {
    orderId: null,
    paymentId: payment.id,
    invoiceId: payment.invoiceId || null,
    orderNumber: payment.topupReference || payment.gatewayOrderId || payment.id,
    invoiceNumber: payment.invoice?.invoiceNumber || null,
    amount: Number(payment.gatewayAmount || payment.amount || 0),
    currency: payment.currency || payment.invoice?.currency || "INR",
    status,
    rawStatus,
    paymentStatus: payment.status || null,
    provisioningStatus: null,
    transactionId: payment.gatewayTransactionId || payment.transactionId || payment.gatewayPaymentId || null,
    verifiedAt,
    purpose: "wallet_topup",
    paymentMethod: payment.paymentMethod || payment.gateway || null,
    completedAt: payment.completedAt || payment.invoice?.paidAt || null,
    mode: getCashfreeMode(),
    gateway: payment.gateway || "cashfree",
    paymentSessionId: payment.gatewaySessionId || null,
    paymentUrl: payment.paymentAttempts?.[0]?.redirectUrl || null,
    redirectUrl: "/client-area/wallet?topup=success",
    environmentMode: (platform as any).environmentMode || "test",
    testMode: ((platform as any).environmentMode || "test") !== "production",
    verified,
    reason: verified ? "wallet_topup_verified" : status === "failed" ? "wallet_topup_failed" : status === "expired" ? "wallet_topup_expired" : "wallet_topup_pending",
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('orderId') || searchParams.get('order_id')
    const forceVerify = searchParams.get("verify") === "1"

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    const [admin, client] = await Promise.all([
      getAdminFromRequest(request),
      getClientFromRequest(request),
    ])

    if (!admin?.email && !client?.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const order = await prisma.order.findFirst({
      where: {
        OR: [
          { id: orderId },
          { orderNumber: orderId },
          { cashfreeOrderId: orderId },
          { payments: { some: { id: orderId } } },
          { payments: { some: { idempotencyKey: orderId } } },
          { payments: { some: { gatewayOrderId: orderId } } },
        ],
      },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            paymentMethod: true,
            completedAt: true,
            createdAt: true,
            customerId: true,
            gateway: true,
            gatewaySessionId: true,
            gatewayPaymentId: true,
            gatewayTransactionId: true,
            transactionId: true,
            currency: true,
            paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { webhookVerifiedAt: true, gatewayTransactionId: true, gatewayPaymentId: true, status: true } },
          },
        },
        invoices: {
          select: { id: true, invoiceNumber: true },
        },
        vpsInstance: { select: { id: true } },
        dedicatedService: { select: { id: true } },
      },
    })

    if (!order) {
      const session = await prisma.checkoutSession.findFirst({
        where: {
          OR: [
            { id: orderId },
            { referenceId: orderId },
            { idempotencyKey: orderId },
            { payments: { some: { id: orderId } } },
            { payments: { some: { gatewayOrderId: orderId } } },
            { payments: { some: { idempotencyKey: orderId } } },
          ],
        },
        include: {
          payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
        },
      }).catch(() => null)
      if (session) {
        const payment = session.payments[0] || null
        const rawStatusBefore = String(payment?.status || session.status || "pending").toLowerCase()
        if (!session.fulfilledOrderId || !["completed", "paid", "success", "fulfilled", "verification_pending"].includes(rawStatusBefore)) {
          await reconcileCashfreeOrder(orderId, admin?.email ? "admin_status_page" : "client_status_page")
        }
        const refreshedSession = await prisma.checkoutSession.findUnique({
          where: { id: session.id },
          include: {
            payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
          },
        }).catch(() => session)
        const currentSession = refreshedSession || session
        if (currentSession.fulfilledOrderId) {
          const fulfilledOrder = await prisma.order.findUnique({
            where: { id: currentSession.fulfilledOrderId },
            include: {
              payments: { orderBy: { createdAt: "desc" }, take: 1 },
              invoices: { select: { id: true, invoiceNumber: true } },
              vpsInstance: { select: { id: true } },
              dedicatedService: { select: { id: true } },
            },
          })
          if (fulfilledOrder) return NextResponse.json(await toResponse(fulfilledOrder, fulfilledOrder.payments[0], fulfilledOrder.invoices || null))
        }
        const refreshedPayment = currentSession.payments[0] || payment
        const rawStatus = String(refreshedPayment?.status || currentSession.status || "pending").toLowerCase()
        const verifiedAt = refreshedPayment?.paymentAttempts?.[0]?.webhookVerifiedAt || refreshedPayment?.completedAt || currentSession.fulfilledAt || currentSession.paidAt || null
        const paid = ["completed", "paid", "success", "fulfilled"].includes(rawStatus) && Boolean(verifiedAt)
        const status = paymentStatusForClient({ rawStatus, verified: paid, createdAt: currentSession.createdAt, expiresAfterMs: PAYMENT_PENDING_TIMEOUT_MS })
        if (status === "expired" && !["payment_expired", "fulfilled", "verification_pending"].includes(String(currentSession.status || "").toLowerCase())) {
          await prisma.checkoutSession.update({ where: { id: currentSession.id }, data: { status: "payment_expired" } }).catch(() => undefined)
          if (refreshedPayment?.id) await prisma.payment.update({ where: { id: refreshedPayment.id }, data: { status: "payment_expired" } }).catch(() => undefined)
        }
        return NextResponse.json({
          orderId: null,
          checkoutSessionId: currentSession.id,
          orderNumber: currentSession.referenceId,
          invoiceId: currentSession.invoiceId,
          amount: Number(currentSession.amount),
          currency: currentSession.currency || refreshedPayment?.currency || "INR",
          status,
          rawStatus,
          paymentStatus: refreshedPayment?.status || currentSession.status || null,
          provisioningStatus: null,
          transactionId: refreshedPayment?.gatewayTransactionId || refreshedPayment?.transactionId || refreshedPayment?.gatewayPaymentId || null,
          verifiedAt,
          paymentMethod: refreshedPayment?.paymentMethod || null,
          invoiceNumber: null,
          completedAt: refreshedPayment?.completedAt || currentSession.fulfilledAt || currentSession.paidAt || null,
          mode: getCashfreeMode(),
          gateway: refreshedPayment?.gateway || currentSession.gateway || "phonepe",
          verified: paid,
          redirectUrl: "/client-area/billing/invoices",
          reason: paid ? "payment_verified" : status === "expired" ? "payment_expired" : status === "failed" ? "payment_failed" : "payment_pending",
        })
      }
      const intent = await prisma.checkoutIntent.findFirst({
        where: {
          OR: [
            { id: orderId },
            { referenceId: orderId },
            { idempotencyKey: orderId },
            { payments: { some: { id: orderId } } },
            { payments: { some: { gatewayOrderId: orderId } } },
            { payments: { some: { idempotencyKey: orderId } } },
          ],
        },
        include: {
          payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
        },
      }).catch(() => null)
      if (intent) {
        const payment = intent.payments[0] || null
        const rawStatusBefore = String(payment?.status || intent.status || "pending").toLowerCase()
        if (!intent.fulfilledOrderId || !["completed", "paid", "success", "fulfilled", "verification_pending"].includes(rawStatusBefore)) {
          await reconcileCashfreeOrder(orderId, admin?.email ? "admin_status_page" : "client_status_page")
        }
        const refreshedIntent = await prisma.checkoutIntent.findUnique({
          where: { id: intent.id },
          include: {
            payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
          },
        }).catch(() => intent)
        const currentIntent = refreshedIntent || intent
        if (intent.fulfilledOrderId) {
          const fulfilledOrder = await prisma.order.findUnique({
            where: { id: currentIntent.fulfilledOrderId || intent.fulfilledOrderId },
            include: {
              payments: { orderBy: { createdAt: "desc" }, take: 1 },
              invoices: { select: { id: true, invoiceNumber: true } },
              vpsInstance: { select: { id: true } },
              dedicatedService: { select: { id: true } },
            },
          })
          if (fulfilledOrder) return NextResponse.json(await toResponse(fulfilledOrder, fulfilledOrder.payments[0], fulfilledOrder.invoices || null))
        }
        if (currentIntent.fulfilledOrderId) {
          const fulfilledOrder = await prisma.order.findUnique({
            where: { id: currentIntent.fulfilledOrderId },
            include: {
              payments: { orderBy: { createdAt: "desc" }, take: 1 },
              invoices: { select: { id: true, invoiceNumber: true } },
              vpsInstance: { select: { id: true } },
              dedicatedService: { select: { id: true } },
            },
          })
          if (fulfilledOrder) return NextResponse.json(await toResponse(fulfilledOrder, fulfilledOrder.payments[0], fulfilledOrder.invoices || null))
        }
        const refreshedPayment = currentIntent.payments[0] || payment
        const rawStatus = String(refreshedPayment?.status || currentIntent.status || "pending").toLowerCase()
        const verifiedAt = refreshedPayment?.paymentAttempts?.[0]?.webhookVerifiedAt || refreshedPayment?.completedAt || currentIntent.fulfilledAt || null
        const paid = ["completed", "paid", "success", "fulfilled"].includes(rawStatus) && Boolean(verifiedAt)
        const status = paymentStatusForClient({ rawStatus, verified: paid, createdAt: currentIntent.createdAt, expiresAfterMs: PAYMENT_PENDING_TIMEOUT_MS })
        if (status === "expired" && !["payment_expired", "fulfilled", "verification_pending"].includes(String(currentIntent.status || "").toLowerCase())) {
          await prisma.checkoutIntent.update({ where: { id: currentIntent.id }, data: { status: "payment_expired" } }).catch(() => undefined)
          if (refreshedPayment?.id) await prisma.payment.update({ where: { id: refreshedPayment.id }, data: { status: "payment_expired" } }).catch(() => undefined)
        }
        return NextResponse.json({
          orderId: null,
          checkoutIntentId: currentIntent.id,
          orderNumber: currentIntent.referenceId,
          invoiceId: currentIntent.invoiceId,
          amount: Number(currentIntent.amount),
          currency: currentIntent.currency || refreshedPayment?.currency || "INR",
          status,
          rawStatus,
          paymentStatus: refreshedPayment?.status || currentIntent.status || null,
          provisioningStatus: null,
          transactionId: refreshedPayment?.gatewayTransactionId || refreshedPayment?.transactionId || refreshedPayment?.gatewayPaymentId || null,
          verifiedAt,
          paymentMethod: refreshedPayment?.paymentMethod || null,
          invoiceNumber: null,
          completedAt: refreshedPayment?.completedAt || currentIntent.fulfilledAt || null,
          mode: getCashfreeMode(),
          gateway: refreshedPayment?.gateway || currentIntent.gateway || "cashfree",
          verified: paid,
          redirectUrl: currentIntent.invoiceId ? `/client-area/billing/invoices/${currentIntent.invoiceId}` : "/client-area/billing/invoices",
          reason: paid ? "payment_verified" : status === "expired" ? "payment_expired" : status === "failed" ? "payment_failed" : "payment_pending",
        })
      }
      const payment = await prisma.payment.findUnique({
        where: { idempotencyKey: orderId },
        include: {
          invoice: true,
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
          order: {
            include: {
              invoices: { select: { id: true, invoiceNumber: true } },
              vpsInstance: { select: { id: true } },
              dedicatedService: { select: { id: true } },
            },
          },
        },
      }).catch(() => null)
      if (payment && isWalletTopupPurpose(payment.purpose)) {
        if (!admin?.email && client?.sub && payment.customerId !== String(client.sub)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
        return NextResponse.json(await walletTopupResponse(payment))
      }
      if (payment?.order) return NextResponse.json(await toResponse(payment.order, payment, payment.order.invoices || null))

      const walletTopupPayment = await prisma.payment.findFirst({
        where: {
          purpose: { in: ["wallet_topup", "topup"] },
          OR: [
            { id: orderId },
            { gatewayOrderId: orderId },
            { topupReference: orderId },
            { idempotencyKey: orderId },
            { paymentAttempts: { some: { merchantOrderId: orderId } } },
          ],
        },
        include: {
          invoice: true,
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
      }).catch(() => null)
      if (walletTopupPayment) {
        if (!admin?.email && client?.sub && walletTopupPayment.customerId !== String(client.sub)) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 })
        }
        const localStatus = String(walletTopupPayment.status || "").toLowerCase()
        if (forceVerify || !["completed", "paid", "verification_pending", "failed"].includes(localStatus)) {
          await reconcileCashfreeOrder(orderId, admin?.email ? "admin_status_page" : "client_status_page")
        }
        const refreshed = await prisma.payment.findUnique({
          where: { id: walletTopupPayment.id },
          include: {
            invoice: true,
            paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        }).catch(() => walletTopupPayment)
        return NextResponse.json(await walletTopupResponse(refreshed || walletTopupPayment))
      }

      const attempt = await prisma.paymentAttempt.findUnique({ where: { merchantOrderId: orderId } }).catch(() => null)
      if (attempt) {
        const verified = Boolean(attempt.webhookVerifiedAt && attempt.status === "success")
        const status = paymentStatusForClient({ rawStatus: attempt.status, verified, createdAt: attempt.createdAt, expiresAfterMs: PAYMENT_PENDING_TIMEOUT_MS })
        return NextResponse.json({
          orderId: attempt.id,
          orderNumber: attempt.merchantOrderId,
          amount: Number(attempt.amount),
          currency: attempt.currency || "INR",
          status,
          paymentStatus: attempt.status || null,
          provisioningStatus: null,
          transactionId: attempt.gatewayTransactionId || attempt.gatewayPaymentId || null,
          verifiedAt: attempt.webhookVerifiedAt || null,
          paymentMethod: attempt.gateway,
          invoiceNumber: null,
          completedAt: attempt.webhookVerifiedAt || null,
          mode: attempt.mode,
          gateway: attempt.gateway,
          environmentMode: "production",
          testMode: false,
          verified,
          reason: verified ? "payment_verified" : status === "expired" ? "payment_expired" : status === "failed" ? "payment_failed" : "payment_pending",
        })
      }
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!admin?.email && client?.sub && order.customerId !== String(client.sub)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const localStatus = String(order.payments?.[0]?.status || order.status || '').toLowerCase()
    if (forceVerify || !['completed', 'paid', 'verification_pending', 'paid_waiting_installation', 'installing', 'delivered'].includes(localStatus)) {
      await reconcileCashfreeOrder(orderId, admin?.email ? 'admin_status_page' : 'client_status_page')
    }

    const refreshedOrder = await prisma.order.findFirst({
      where: {
        OR: [
          { id: orderId },
          { orderNumber: orderId },
          { cashfreeOrderId: orderId },
          { payments: { some: { id: orderId } } },
          { payments: { some: { idempotencyKey: orderId } } },
          { payments: { some: { gatewayOrderId: orderId } } },
        ],
      },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            status: true,
            paymentMethod: true,
            completedAt: true,
            createdAt: true,
            customerId: true,
            gateway: true,
            gatewaySessionId: true,
            gatewayPaymentId: true,
            gatewayTransactionId: true,
            transactionId: true,
            currency: true,
            paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { webhookVerifiedAt: true, gatewayTransactionId: true, gatewayPaymentId: true, status: true } },
          },
        },
        invoices: { select: { id: true, invoiceNumber: true } },
        vpsInstance: { select: { id: true } },
        dedicatedService: { select: { id: true } },
      },
    })

    const payment = refreshedOrder?.payments?.[0] || order.payments?.[0]
    const invoice = refreshedOrder?.invoices || order.invoices || null
    return NextResponse.json(await toResponse(refreshedOrder || order, payment, invoice))
  } catch (error) {
    console.error('Payment status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
