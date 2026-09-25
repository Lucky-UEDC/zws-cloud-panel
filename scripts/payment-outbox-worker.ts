import "dotenv/config"
import os from "node:os"
import { claimPaymentOutboxBatch, completePaymentOutbox, retryPaymentOutbox } from "@/lib/payments/outbox"
import { postPaymentRevenue } from "@/lib/payments/revenue-engine"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { prisma } from "@/lib/db"
import { paymentFlowError, paymentFlowLog } from "@/lib/payment-flow-log"

const once = process.argv.includes("--once")
const workerId = `${os.hostname()}:${process.pid}`

async function processEvent(event: any) {
  const payload = event.payload || {}
  if (event.eventType === "payment_captured") {
    paymentFlowLog("Payment outbox received", { outboxEventId: event.id, paymentId: payload.paymentId || null, invoiceId: payload.invoiceId || null, orderId: payload.orderId || null })
    await postPaymentRevenue({ paymentId: String(payload.paymentId), amount: Number(payload.amount), taxAmount: Number(payload.taxAmount || 0), currency: String(payload.currency || "INR") })
    if (payload.invoiceId) await sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: payload.orderId || null, invoiceId: payload.invoiceId, paymentUrl: `/client-area/billing/invoices/${payload.invoiceId}`, metadata: { source: "payment_outbox", outboxEventId: event.id } })
  }
  if (event.eventType === "manual_payment_approved" && payload.invoiceId) {
    await sendOrderInvoiceNotification({ templateKey: "invoice_paid", orderId: payload.orderId || null, invoiceId: payload.invoiceId, paymentUrl: `/client-area/billing/invoices/${payload.invoiceId}`, metadata: { source: "manual_payment_outbox", outboxEventId: event.id } })
  }
}

async function tick() {
  const events = await claimPaymentOutboxBatch(workerId, 50)
  for (const event of events) {
    try { await processEvent(event); await completePaymentOutbox(event.id) }
    catch (error) {
      paymentFlowError("Payment outbox event failed", error, { outboxEventId: event.id, eventType: event.eventType, attempts: event.attempts })
      await retryPaymentOutbox(event.id, event.attempts, error)
    }
  }
  return events.length
}

async function main() {
  do { const count = await tick(); if (once) break; await new Promise((resolve) => setTimeout(resolve, count ? 1000 : 5000)) } while (true)
}

main().catch((error) => { console.error("[PaymentOutboxWorker] fatal", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null }); paymentFlowError("Payment outbox worker fatal", error, { workerId }); process.exitCode = 1 }).finally(async () => { if (once) await prisma.$disconnect().catch(() => undefined) })
