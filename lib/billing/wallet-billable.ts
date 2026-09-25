import { prisma } from "@/lib/db"
import { withRedisLock } from "@/lib/redis"
import { createInvoiceForOrder } from "@/lib/invoices"
import { handlePaidInvoice, finalizePaidOrder } from "@/lib/payment-finalization"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { createWalletTransaction } from "@/lib/wallet"
import { createPanelLog } from "@/lib/panel-log"

type WalletBillableInput = {
  customerId: string
  order: any
  invoice?: any
  idempotencyKey: string
  actor?: string
  autoProvision?: boolean
}

type WalletBillableResult = {
  success: boolean
  reason?: string
  reused?: boolean
  paymentId?: string
  invoiceId?: string | null
}

function invoiceIdOf(order: any, invoice: any) {
  return invoice?.id || order?.invoices?.[0]?.id || order?.invoiceId || null
}

export async function payBillableOrderFromWallet(input: WalletBillableInput): Promise<WalletBillableResult> {
  const order = input.order
  if (!order?.id) return { success: false, reason: "order_missing" }
  const customerId = String(input.customerId || "")
  if (!customerId) return { success: false, reason: "customer_missing" }

  const key = String(input.idempotencyKey || `wallet:${order.id}`)
  const actor = input.actor || "backup-billing-recurrence"

  return withRedisLock(`wallet-billable:${order.id}`, 20000, async () => {
    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } }).catch(() => null)
    if (existing && ["completed", "paid", "success"].includes(String(existing.status || "").toLowerCase())) {
      return { success: true, reused: true, paymentId: existing.id, invoiceId: existing.invoiceId || null }
    }

    const amount = Number(order.payableAmount || order.totalAmount || order.finalAmount || 0)
    if (!(amount > 0)) return { success: false, reason: "invalid_amount" }

    const existingInvoiceId = invoiceIdOf(order, input.invoice)
    const settled = await prisma.$transaction(async (tx) => {
      const lockedCustomer = await tx.customer.findUnique({ where: { id: customerId }, select: { walletBalance: true } })
      const balanceBefore = Number(lockedCustomer?.walletBalance || 0)
      if (balanceBefore < amount) {
        throw Object.assign(new Error("Insufficient wallet balance."), { code: "wallet_insufficient" })
      }
      const balanceAfter = Number((balanceBefore - amount).toFixed(2))
      const debited = await tx.customer.updateMany({
        where: { id: customerId, walletBalance: { gte: amount } },
        data: { walletBalance: { decrement: amount } },
      })
      if (debited.count !== 1) {
        throw Object.assign(new Error("Insufficient wallet balance."), { code: "wallet_insufficient" })
      }
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          invoiceId: existingInvoiceId,
          customerId,
          gateway: "wallet",
          amount,
          currency: String(order.currency || "INR"),
          status: "completed",
          paymentMethod: "wallet",
          purpose: "billable_order",
          idempotencyKey: key,
          walletAppliedAmount: amount,
          gatewayAmount: 0,
          completedAt: new Date(),
        },
      })
      const walletTransaction = await tx.walletTransaction.create({
        data: {
          customerId,
          paymentId: payment.id,
          orderId: order.id,
          type: "payment",
          amount,
          currency: String(order.currency || "INR"),
          balanceBefore,
          balanceAfter,
          status: "completed",
          reason: "Paid invoice from wallet",
          note: order.orderNumber ? `Wallet payment for ${order.orderNumber}` : "Wallet payment",
          referenceId: `wallet:${order.id}`,
          gateway: null,
          gatewayFee: null,
          createdByType: "system",
        },
      })
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          transactionId: walletTransaction.id,
          gatewayTransactionId: walletTransaction.id,
          paymentMethodDetails: { walletTransactionId: walletTransaction.id, balanceBefore, balanceAfter },
        },
      })
      if (order.id) {
        await tx.order.update({ where: { id: order.id }, data: { status: "paid" } })
      }
      return { payment: updatedPayment, walletTransaction, balanceBefore, balanceAfter }
    })

    let invoice = await createInvoiceForOrder(order.id, { paymentId: settled.payment.id }).catch((error) => {
      console.error("[wallet-billable] invoice creation failed", { orderId: order.id, message: error?.message })
      return null
    })
    if (!invoice) {
      await createPanelLog({
        category: "Billing",
        level: "error",
        message: "wallet_billable_invoice_creation_failed",
        customerId,
        orderId: order.id,
        paymentId: settled.payment.id,
        metadata: { actor, error: "invoice creation failed" },
      }).catch(() => null)
    }
    const invoiceId = invoice?.id || existingInvoiceId

    await createPanelLog({
      category: "Billing",
      message: "wallet_billable_order_paid",
      customerId,
      orderId: order.id,
      paymentId: settled.payment.id,
      metadata: { actor, amount, invoiceId: invoiceId || null },
    }).catch(() => null)

    await Promise.all([
      sendOrderInvoiceNotification({ templateKey: "order_paid", orderId: order.id, invoiceId: invoiceId || null, metadata: { source: "wallet_payment", actor } }).catch(() => null),
      sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: order.id, invoiceId: invoiceId || null, metadata: { source: "wallet_payment", actor } }).catch(() => null),
    ])

    const autoProvision = input.autoProvision ?? false
    await Promise.all([
      (invoiceId ? handlePaidInvoice(invoiceId, { paymentId: settled.payment.id, actor, autoProvision, purpose: "billable_order", transactionId: settled.payment.gatewayTransactionId || settled.payment.transactionId }) : finalizePaidOrder({ orderId: order.id, paymentId: settled.payment.id, actor, autoProvision, purpose: "billable_order", transactionId: settled.payment.gatewayTransactionId || settled.payment.transactionId })).catch((error) => {
        console.error("[wallet-billable] finalization failed", { orderId: order.id, message: error?.message })
        return null
      }),
    ])

    return { success: true, reused: false, paymentId: settled.payment.id, invoiceId: invoiceId || null }
  })
}