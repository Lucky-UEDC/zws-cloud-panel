import "dotenv/config"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

const apply = process.argv.includes("--apply")

type JsonObject = Record<string, any>
type Failure = { table: string; id: string; currency: string | null; reason: string }

const failures: Failure[] = []
const counts: Record<string, number> = {}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

function money(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null
}

function decimal(value: number) {
  return new Prisma.Decimal(value.toFixed(2))
}

function remember(table: string) {
  counts[table] = (counts[table] || 0) + 1
}

function archive(metadata: unknown, table: string, row: any) {
  const previous = object(metadata)
  return {
    ...previous,
    inrLockdown: {
      rewrittenAt: new Date().toISOString(),
      source: "scripts/lock-inr-financial-data.ts",
      previous: {
        table,
        currency: String(row.currency || ""),
        gateway: row.gateway || null,
        amount: row.amount == null ? null : Number(row.amount),
        totalAmount: row.totalAmount == null ? null : Number(row.totalAmount),
      },
    },
  }
}

function orderBase(order: any) {
  const pricing = object(object(order.metadata).pricingSnapshot)
  const subtotal = money(pricing.baseSubtotalInr)
  const discount = money(pricing.baseDiscountInr)
  const tax = money(pricing.baseTaxInr)
  const total = money(pricing.baseTotalInr)
  if (subtotal == null || discount == null || tax == null || total == null) return null
  const quantity = Math.max(1, Number(order.quantity || 1))
  return { subtotal, discount, tax, total, unitPrice: Number((subtotal / quantity).toFixed(2)) }
}

function invoiceBase(invoice: any) {
  const snapshot = object(object(invoice.metadata).basePricingSnapshot)
  const subtotal = money(snapshot.subtotal)
  const discount = money(snapshot.discountAmount)
  const tax = money(snapshot.taxAmount)
  const total = money(snapshot.payableAmount)
  if (subtotal != null && discount != null && tax != null && total != null) return { subtotal, discount, tax, total }
  const fromOrder = invoice.order ? orderBase(invoice.order) : null
  return fromOrder ? { subtotal: fromOrder.subtotal, discount: fromOrder.discount, tax: fromOrder.tax, total: fromOrder.total } : null
}

function intentBase(intent: any, invoice?: any | null) {
  if (invoice) return invoiceBase(invoice)
  const orderData = object(object(intent.snapshot).orderData)
  const pricing = object(object(orderData.metadata).pricingSnapshot)
  const total = money(pricing.baseTotalInr)
  return total == null ? null : { total }
}

function linkedTotal(row: any) {
  if (row.invoice) return invoiceBase(row.invoice)?.total ?? null
  if (row.order) return orderBase(row.order)?.total ?? null
  if (row.payment?.invoice) return invoiceBase(row.payment.invoice)?.total ?? null
  if (row.payment?.order) return orderBase(row.payment.order)?.total ?? null
  return null
}

async function rewriteOrders() {
  const rows = await prisma.order.findMany({ where: { currency: { not: "INR" } } })
  for (const row of rows) {
    const base = orderBase(row)
    if (!base) {
      failures.push({ table: "orders", id: row.id, currency: row.currency, reason: "missing order metadata.pricingSnapshot base INR totals" })
      continue
    }
    remember("orders")
    if (!apply) continue
    await prisma.order.update({
      where: { id: row.id },
      data: {
        unitPrice: decimal(base.unitPrice),
        subtotal: decimal(base.subtotal),
        discountAmount: decimal(base.discount),
        taxAmount: decimal(base.tax),
        totalAmount: decimal(base.total),
        originalAmount: decimal(base.subtotal + base.tax),
        finalAmount: decimal(base.total),
        payableAmount: decimal(base.total),
        currency: "INR",
        metadata: archive(row.metadata, "orders", row),
      },
    })
  }
}

async function rewriteInvoices() {
  const rows = await prisma.invoice.findMany({
    where: { currency: { not: "INR" } },
    include: { order: true },
  })
  for (const row of rows) {
    const base = invoiceBase(row)
    if (!base) {
      failures.push({ table: "invoices", id: row.id, currency: row.currency, reason: "missing invoice basePricingSnapshot or order INR snapshot" })
      continue
    }
    remember("invoices")
    if (!apply) continue
    await prisma.invoice.update({
      where: { id: row.id },
      data: {
        subtotal: decimal(base.subtotal),
        discountAmount: decimal(base.discount),
        taxAmount: decimal(base.tax),
        gstAmount: decimal(base.tax),
        totalAmount: decimal(base.total),
        currency: "INR",
        metadata: archive(row.metadata, "invoices", row),
      },
    })
  }
}

async function rewritePayments() {
  const rows = await prisma.payment.findMany({
    where: { currency: { not: "INR" } },
    include: { invoice: { include: { order: true } }, order: true },
  })
  for (const row of rows) {
    const total = linkedTotal(row)
    if (total == null) {
      failures.push({ table: "payments", id: row.id, currency: row.currency, reason: "payment has no recoverable INR order or invoice total" })
      continue
    }
    remember("payments")
    if (!apply) continue
    await prisma.payment.update({
      where: { id: row.id },
      data: {
        amount: decimal(total),
        gatewayAmount: decimal(Math.max(0, total - Number(row.walletAppliedAmount || 0))),
        currency: "INR",
        paymentMethodDetails: archive(row.paymentMethodDetails, "payments", row),
      },
    })
  }
}

async function rewriteCheckoutIntents() {
  const rows = await prisma.checkoutIntent.findMany({
    where: { currency: { not: "INR" } },
  })
  for (const row of rows) {
    const invoice = row.invoiceId ? await prisma.invoice.findUnique({ where: { id: row.invoiceId }, include: { order: true } }) : null
    const base = intentBase(row, invoice)
    if (!base) {
      failures.push({ table: "checkout_intents", id: row.id, currency: row.currency, reason: "checkout intent has no recoverable INR snapshot" })
      continue
    }
    remember("checkout_intents")
    if (!apply) continue
    await prisma.checkoutIntent.update({
      where: { id: row.id },
      data: { amount: decimal(base.total), currency: "INR", snapshot: archive(row.snapshot, "checkout_intents", row) },
    })
  }
}

async function rewritePaymentAttempts() {
  const rows = await prisma.paymentAttempt.findMany({
    where: { currency: { not: "INR" } },
    include: {
      invoice: { include: { order: true } },
      order: true,
      payment: { include: { invoice: { include: { order: true } }, order: true } },
    },
  })
  for (const row of rows) {
    const total = linkedTotal(row)
    if (total == null) {
      failures.push({ table: "payment_attempts", id: row.id, currency: row.currency, reason: "attempt has no recoverable INR order, invoice, or payment total" })
      continue
    }
    remember("payment_attempts")
    if (!apply) continue
    await prisma.paymentAttempt.update({
      where: { id: row.id },
      data: { amount: decimal(total), currency: "INR", rawGatewayResponse: archive(row.rawGatewayResponse, "payment_attempts", row) },
    })
  }
}

async function rewritePaymentTransactions() {
  const rows = await prisma.paymentTransaction.findMany({ where: { currency: { not: "INR" } } })
  for (const row of rows) {
    const payment = row.paymentId
      ? await prisma.payment.findUnique({ where: { id: row.paymentId }, include: { invoice: { include: { order: true } }, order: true } })
      : null
    const invoice = !payment && row.invoiceId
      ? await prisma.invoice.findUnique({ where: { id: row.invoiceId }, include: { order: true } })
      : null
    const order = !payment && !invoice && row.orderId ? await prisma.order.findUnique({ where: { id: row.orderId } }) : null
    const total = linkedTotal({ payment, invoice, order })
    if (total == null) {
      failures.push({ table: "payment_transactions", id: row.id, currency: row.currency, reason: "transaction has no recoverable INR order, invoice, or payment total" })
      continue
    }
    remember("payment_transactions")
    if (!apply) continue
    await prisma.paymentTransaction.update({
      where: { id: row.id },
      data: { amount: decimal(total), currency: "INR", rawGatewayResponse: archive(row.rawGatewayResponse, "payment_transactions", row) },
    })
  }
}

async function rewriteAnalyticsConversions() {
  const rows = await prisma.analyticsConversion.findMany({ where: { currency: { not: "INR" } } })
  for (const row of rows) {
    const payment = row.paymentId
      ? await prisma.payment.findUnique({ where: { id: row.paymentId }, include: { invoice: { include: { order: true } }, order: true } })
      : null
    const order = !payment && row.orderId ? await prisma.order.findUnique({ where: { id: row.orderId } }) : null
    const total = row.amount == null ? 0 : linkedTotal({ payment, order })
    if (total == null) {
      failures.push({ table: "analytics_conversions", id: row.id, currency: row.currency, reason: "conversion has no recoverable INR order or payment total" })
      continue
    }
    remember("analytics_conversions")
    if (!apply) continue
    await prisma.analyticsConversion.update({
      where: { id: row.id },
      data: {
        amount: row.amount == null ? null : decimal(total),
        currency: "INR",
        metadata: archive(row.metadata, "analytics_conversions", row),
      },
    })
  }
}

async function lockGatewayConfig() {
  if (!apply) return
  await prisma.countryPricing.updateMany({ where: { currency: { not: "INR" } }, data: { currency: "INR", exchangeOverride: null } })
  await prisma.domainGatewayConfig.updateMany({ where: { gateway: { notIn: ["phonepe", "cashfree"] } }, data: { enabled: false } })
  await (prisma as any).paymentGateway.updateMany({
    where: { AND: [{ code: { notIn: ["phonepe", "cashfree"] } }, { provider: { notIn: ["phonepe", "cashfree"] } }] },
    data: { enabled: false, active: false, primary: false, lastHealthStatus: "disabled", lastError: "Disabled by INR payment lockdown." },
  })
}

async function main() {
  await rewriteOrders()
  await rewriteInvoices()
  await rewritePayments()
  await rewriteCheckoutIntents()
  await rewritePaymentAttempts()
  await rewritePaymentTransactions()
  await rewriteAnalyticsConversions()
  await lockGatewayConfig()
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", recoverableRows: counts, unresolvedRows: failures }, null, 2))
  if (failures.length) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error("[lock-inr-financial-data] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
