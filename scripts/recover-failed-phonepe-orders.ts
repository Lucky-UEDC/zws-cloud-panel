import "dotenv/config"
import { prisma } from "@/lib/db"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"

const since = new Date(Date.now() - 48 * 60 * 60 * 1000)

function paymentLink(invoiceId: string) {
  return `/client-area/billing/invoices/${invoiceId}`
}

async function main() {
  const failed = await prisma.payment.findMany({
    where: {
      gateway: "phonepe",
      status: { in: ["failed", "payment_failed", "gateway_error", "error"] },
      createdAt: { gte: since },
      order: { status: { notIn: ["cancelled", "paid", "completed"] } },
      invoice: { status: { not: "paid" } },
    },
    include: { order: true, invoice: true, customer: true },
    orderBy: { createdAt: "desc" },
  })
  let queued = 0
  let skipped = 0
  let notified = 0
  for (const payment of failed) {
    if (!payment.orderId || !payment.invoiceId || !payment.invoice) {
      skipped += 1
      continue
    }
    const notificationKey = `phonepe-recovery:${payment.orderId}:${payment.invoiceId}`
    const row = await (prisma as any).paymentRetryQueue.upsert({
      where: { notificationKey },
      update: {},
      create: {
        orderId: payment.orderId,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        customerId: payment.customerId,
        gateway: "phonepe",
        reason: "failed_phonepe_recovery_48h",
        status: "notified",
        retryAfter: new Date(),
        notificationKey,
        metadata: {
          message: "Payment Gateway Updated",
          paymentLink: paymentLink(payment.invoiceId),
          sourcePaymentId: payment.id,
        },
      },
    }).catch(() => null)
    if (!row || row.createdAt?.getTime?.() < Date.now() - 10_000) {
      skipped += 1
      continue
    }
    queued += 1
    await sendOrderInvoiceNotification({
      templateKey: "payment_failed",
      orderId: payment.orderId,
      invoiceId: payment.invoiceId,
      paymentUrl: paymentLink(payment.invoiceId),
      metadata: {
        source: "phonepe_recovery_razorpay",
        paymentId: payment.id,
        message: "Payment Gateway Updated",
      },
    }).then(() => {
      notified += 1
    }).catch(() => undefined)
  }
  console.log(JSON.stringify({ scanned: failed.length, queued, notified, skipped }, null, 2))
}

main()
  .catch((error) => {
    console.error("[PhonePeRecovery] failed", { message: error?.message })
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
