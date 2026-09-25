import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { exportPdfTable, exportTabularResponse } from "@/lib/admin-export"
import {
  CANCELLED_INVOICE_STATUSES,
  COMPLETED_PAYMENT_STATUSES,
  CREDIT_WALLET_TYPES,
  FAILED_PAYMENT_STATUSES,
  PENDING_INVOICE_STATUSES,
  REFUND_WALLET_TYPES,
  REFUNDED_PAYMENT_STATUSES,
  WALLET_PAYMENT_PURPOSES,
  activeBillableOrderWhere,
  dateRangeWhere,
  getActiveRecurringRevenueMetrics,
  money,
  paidServiceInvoiceWhere,
} from "@/lib/revenue-analytics"

const HOUR = 3600000
const DAY = 86400000

function rangeWindow(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") || "today"
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const explicitStart = request.nextUrl.searchParams.get("start")
  const explicitEnd = request.nextUrl.searchParams.get("end")
  if (explicitStart || explicitEnd) {
    return {
      range: "custom",
      start: explicitStart ? new Date(`${explicitStart}T00:00:00`) : startOfToday,
      end: explicitEnd ? new Date(`${explicitEnd}T23:59:59.999`) : now,
      bucket: "day" as const,
    }
  }
  if (range === "24h") return { range, start: new Date(now.getTime() - 23 * HOUR), end: now, bucket: "hour" as const }
  if (range === "custom") {
    const start = request.nextUrl.searchParams.get("start")
    const end = request.nextUrl.searchParams.get("end")
    return {
      range,
      start: start ? new Date(`${start}T00:00:00`) : startOfToday,
      end: end ? new Date(`${end}T23:59:59.999`) : now,
      bucket: "day" as const,
    }
  }
  if (range === "yesterday") {
    const start = new Date(startOfToday)
    start.setDate(start.getDate() - 1)
    return { range, start, end: startOfToday, bucket: "day" as const }
  }
  if (range === "7d") return { range, start: new Date(startOfToday.getTime() - 6 * DAY), end: now, bucket: "day" as const }
  if (range === "30d") return { range, start: new Date(startOfToday.getTime() - 29 * DAY), end: now, bucket: "day" as const }
  if (range === "90d") return { range, start: new Date(startOfToday.getTime() - 89 * DAY), end: now, bucket: "day" as const }
  if (range === "1y" || range === "365d") return { range: range === "365d" ? "1y" : range, start: new Date(now.getFullYear(), now.getMonth() - 11, 1), end: now, bucket: "month" as const }
  if (range === "lifetime") return { range, start: null, end: null, bucket: "month" as const }
  return { range: "today", start: startOfToday, end: now, bucket: "hour" as const }
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function bucketKey(date: Date, bucket: "hour" | "day" | "month") {
  if (bucket === "hour") {
    const rounded = new Date(date)
    rounded.setMinutes(0, 0, 0)
    return rounded.toISOString()
  }
  if (bucket === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
  return dayKey(date)
}

function bucketLabel(key: string, bucket: "hour" | "day" | "month") {
  if (bucket === "hour") return new Date(key).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  if (bucket === "month") {
    const [year, month] = key.split("-").map(Number)
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
  }
  return new Date(`${key}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

function buildBucketKeys(start: Date | null, end: Date | null, bucket: "hour" | "day" | "month") {
  if (!start || !end) return []
  const keys: string[] = []
  const cursor = new Date(start)
  if (bucket === "hour") cursor.setMinutes(0, 0, 0)
  if (bucket === "day") cursor.setHours(0, 0, 0, 0)
  if (bucket === "month") {
    cursor.setDate(1)
    cursor.setHours(0, 0, 0, 0)
  }
  while (cursor <= end) {
    keys.push(bucketKey(cursor, bucket))
    if (bucket === "hour") cursor.setHours(cursor.getHours() + 1)
    else if (bucket === "month") cursor.setMonth(cursor.getMonth() + 1)
    else cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

function growthPercent(current: number, previous: number) {
  if (!previous && !current) return 0
  if (!previous) return 100
  return money(((current - previous) / previous) * 100)
}

function metadataSource(order: any) {
  const metadata = order?.metadata && typeof order.metadata === "object" ? order.metadata as Record<string, any> : {}
  const analytics = metadata.analytics && typeof metadata.analytics === "object" ? metadata.analytics : {}
  return String(analytics.utmSource || metadata.utmSource || metadata.trafficSource || "Direct")
}

function paidDate(invoice: { paidAt?: Date | null; createdAt: Date; updatedAt: Date }) {
  return invoice.paidAt || invoice.updatedAt || invoice.createdAt
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const window = rangeWindow(request)
  const exportFormat = request.nextUrl.searchParams.get("format")
  const productFilter = request.nextUrl.searchParams.get("product")
  const countryFilter = request.nextUrl.searchParams.get("country")
  const nodeFilter = request.nextUrl.searchParams.get("node")
  const invoiceDate = { start: window.start, end: window.end, field: "paidAt" as const }
  const createdDateWhere = dateRangeWhere({ start: window.start, end: window.end, field: "createdAt" })
  const completedDateWhere = dateRangeWhere({ start: window.start, end: window.end, field: "completedAt" })

  const [
    paidInvoices,
    pendingInvoices,
    cancelledInvoices,
    servicePayments,
    walletFlowRows,
    creditRows,
    refundRows,
    failedPayments,
    refundedPayments,
    newOrders,
    recurringRevenue,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: paidServiceInvoiceWhere(invoiceDate),
      include: {
        customer: { select: { id: true, name: true, email: true, country: true } },
        order: { include: { product: { select: { id: true, name: true } }, offer: { select: { id: true, name: true } }, proxmoxServer: { select: { id: true, name: true, nodeName: true } } } },
        payments: { where: { status: { in: [...COMPLETED_PAYMENT_STATUSES] }, purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] } }, orderBy: { createdAt: "desc" }, take: 3 },
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.invoice.findMany({
      where: { deletedAt: null, status: { in: [...PENDING_INVOICE_STATUSES] }, ...createdDateWhere },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true, createdAt: true },
    }),
    prisma.invoice.findMany({
      where: { deletedAt: null, status: { in: [...CANCELLED_INVOICE_STATUSES] }, ...createdDateWhere },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
    }),
    prisma.payment.findMany({
      where: {
        status: { in: [...COMPLETED_PAYMENT_STATUSES] },
        purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] },
        invoice: { is: paidServiceInvoiceWhere() },
        ...completedDateWhere,
      },
      select: { amount: true, gateway: true, createdAt: true, completedAt: true, invoiceId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.walletTransaction.findMany({
      where: { status: "completed", type: { in: ["CREDIT_TOPUP", "topup"] }, ...createdDateWhere },
      select: { amount: true, createdAt: true },
    }),
    prisma.walletTransaction.findMany({
      where: { status: "completed", type: { in: [...CREDIT_WALLET_TYPES] }, ...createdDateWhere },
      select: { amount: true },
    }),
    prisma.walletTransaction.findMany({
      where: { status: "completed", type: { in: [...REFUND_WALLET_TYPES] }, ...createdDateWhere },
      select: { amount: true },
    }),
    prisma.payment.findMany({ where: { status: { in: [...FAILED_PAYMENT_STATUSES] }, ...createdDateWhere }, select: { amount: true } }),
    prisma.payment.findMany({ where: { status: { in: [...REFUNDED_PAYMENT_STATUSES] }, ...createdDateWhere }, select: { amount: true } }),
    prisma.order.count({ where: activeBillableOrderWhere(createdDateWhere) }),
    getActiveRecurringRevenueMetrics(),
  ])
  const filteredPaidInvoices = paidInvoices.filter((invoice) => {
    if (productFilter && ![invoice.order?.product?.id, invoice.order?.offer?.id, invoice.order?.product?.name, invoice.order?.offer?.name].some((value) => String(value || "").toLowerCase().includes(productFilter.toLowerCase()))) return false
    if (nodeFilter && ![invoice.order?.proxmoxServer?.id, invoice.order?.proxmoxServer?.name, invoice.order?.proxmoxServer?.nodeName].some((value) => String(value || "").toLowerCase().includes(nodeFilter.toLowerCase()))) return false
    if (countryFilter && !String((invoice.customer as any)?.country || "").toLowerCase().includes(countryFilter.toLowerCase())) return false
    return true
  })

  const totals = filteredPaidInvoices.reduce((acc, invoice) => {
    acc.grossRevenue += money(invoice.totalAmount)
    acc.gstCollected += money(invoice.taxAmount)
    acc.couponDiscounts += money(invoice.discountAmount)
    return acc
  }, { grossRevenue: 0, gstCollected: 0, couponDiscounts: 0 })
  const gatewayPayments = money(servicePayments.filter((payment) => payment.gateway !== "wallet").reduce((sum, payment) => sum + money(payment.amount), 0))
  const walletPayments = money(servicePayments.filter((payment) => payment.gateway === "wallet").reduce((sum, payment) => sum + money(payment.amount), 0))
  const walletFlow = money(walletFlowRows.reduce((sum, row) => sum + money(row.amount), 0))
  const credits = money(creditRows.reduce((sum, row) => sum + money(row.amount), 0))
  const refunds = money(refundRows.reduce((sum, row) => sum + money(row.amount), 0) + refundedPayments.reduce((sum, row) => sum + money(row.amount), 0))
  const netRevenue = money(totals.grossRevenue - totals.gstCollected)

  const byDay = new Map<string, number>()
  const byGateway = new Map<string, number>()
  const byProduct = new Map<string, number>()
  const bySource = new Map<string, number>()
  const byCustomer = new Map<string, { customer: string; amount: number }>()
  const seriesMap = new Map<string, {
    date: string
    label: string
    grossRevenue: number
    netRevenue: number
    gatewayRevenue: number
    walletRevenue: number
    walletFlow: number
    credits: number
    refunds: number
    discounts: number
    pendingInvoiceAmount: number
    gstCollected: number
    paidInvoices: number
    growthPercent: number
  }>()
  const emptyBucket = (key: string) => ({
    date: key,
    label: bucketLabel(key, window.bucket),
    grossRevenue: 0,
    netRevenue: 0,
    gatewayRevenue: 0,
    walletRevenue: 0,
    walletFlow: 0,
    credits: 0,
    refunds: 0,
    discounts: 0,
    pendingInvoiceAmount: 0,
    gstCollected: 0,
    paidInvoices: 0,
    growthPercent: 0,
  })
  for (const key of buildBucketKeys(window.start, window.end, window.bucket)) seriesMap.set(key, emptyBucket(key))

  for (const invoice of filteredPaidInvoices) {
    const amount = money(invoice.totalAmount)
    const tax = money(invoice.taxAmount)
    const discount = money(invoice.discountAmount)
    const date = paidDate(invoice)
    byDay.set(dayKey(date), money((byDay.get(dayKey(date)) || 0) + amount))
    const product = invoice.order?.offer?.name || invoice.order?.product?.name || "Other"
    byProduct.set(product, money((byProduct.get(product) || 0) + amount))
    const source = metadataSource(invoice.order)
    bySource.set(source, money((bySource.get(source) || 0) + amount))
    const key = invoice.customer?.id || "unknown"
    const label = invoice.customer?.name || invoice.customer?.email || "Unknown customer"
    const current = byCustomer.get(key) || { customer: label, amount: 0 }
    current.amount = money(current.amount + amount)
    byCustomer.set(key, current)
    const seriesKey = bucketKey(date, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.grossRevenue = money(bucket.grossRevenue + amount)
    bucket.netRevenue = money(bucket.netRevenue + amount - tax)
    bucket.gstCollected = money(bucket.gstCollected + tax)
    bucket.discounts = money(bucket.discounts + discount)
    bucket.paidInvoices += 1
    seriesMap.set(seriesKey, bucket)
  }

  for (const payment of servicePayments) {
    const gateway = payment.gateway || "unknown"
    const amount = money(payment.amount)
    byGateway.set(gateway, money((byGateway.get(gateway) || 0) + amount))
    const seriesKey = bucketKey(payment.completedAt || payment.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    if (gateway === "wallet") bucket.walletRevenue = money(bucket.walletRevenue + amount)
    else bucket.gatewayRevenue = money(bucket.gatewayRevenue + amount)
    seriesMap.set(seriesKey, bucket)
  }

  for (const invoice of pendingInvoices) {
    const seriesKey = bucketKey(invoice.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.pendingInvoiceAmount = money(bucket.pendingInvoiceAmount + money(invoice.totalAmount))
    seriesMap.set(seriesKey, bucket)
  }

  for (const row of walletFlowRows) {
    const seriesKey = bucketKey(row.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.walletFlow = money(bucket.walletFlow + money(row.amount))
    seriesMap.set(seriesKey, bucket)
  }

  const series = Array.from(seriesMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  for (let index = 0; index < series.length; index += 1) {
    series[index].growthPercent = growthPercent(series[index].grossRevenue, series[index - 1]?.grossRevenue || 0)
  }
  const highestBucket = series.reduce((best, item) => item.grossRevenue > best.grossRevenue ? item : best, series[0] || { label: "No revenue", grossRevenue: 0 })
  const topGateway = Array.from(byGateway.entries()).sort((a, b) => b[1] - a[1])[0]
  const failedPaymentAmount = money(failedPayments.reduce((sum, payment) => sum + money(payment.amount), 0))
  const totalPaymentAttempts = servicePayments.length + failedPayments.length
  const paymentSuccessRate = totalPaymentAttempts ? money((servicePayments.length / totalPaymentAttempts) * 100) : 0

  const annualRevenue = money(series.reduce((sum, item) => sum + item.grossRevenue, 0))
  const mrr = recurringRevenue.mrr
  const arr = recurringRevenue.arr
  const recentPayments = filteredPaidInvoices.slice(-15).reverse().map((invoice) => ({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customer: invoice.customer?.name || invoice.customer?.email || "Unknown customer",
    product: invoice.order?.offer?.name || invoice.order?.product?.name || "Other",
    node: invoice.order?.proxmoxServer?.name || invoice.order?.proxmoxServer?.nodeName || "-",
    amount: money(invoice.totalAmount),
    paidAt: paidDate(invoice).toISOString(),
  }))
  const exportRows = recentPayments.map((row) => ({
    Invoice: row.invoiceNumber,
    Customer: row.customer,
    Product: row.product,
    Node: row.node,
    Amount: row.amount,
    PaidAt: row.paidAt,
  }))
  const exportHeaders = ["Invoice", "Customer", "Product", "Node", "Amount", "PaidAt"]
  if (exportFormat === "csv" || exportFormat === "excel") {
    return exportTabularResponse({ rows: exportRows, headers: exportHeaders, filename: "revenue-report", format: exportFormat })
  }
  if (exportFormat === "pdf") {
    return exportPdfTable({ title: "Revenue Report", rows: exportRows, headers: exportHeaders, filename: "revenue-report" })
  }

  return NextResponse.json({
    range: window.range,
    start: window.start?.toISOString() || null,
    end: window.end?.toISOString() || null,
    cards: {
      grossRevenue: money(totals.grossRevenue),
      todayRevenue: series.at(-1)?.grossRevenue || 0,
      monthlyRevenue: money(totals.grossRevenue),
      annualRevenue,
      netRevenue,
      gstCollected: money(totals.gstCollected),
      couponDiscounts: money(totals.couponDiscounts),
      discounts: money(totals.couponDiscounts),
      walletPayments,
      gatewayPayments,
      walletFlow,
      credits,
      refunds,
      paidInvoices: filteredPaidInvoices.length,
      paidInvoiceAmount: money(filteredPaidInvoices.reduce((sum, invoice) => sum + money(invoice.totalAmount), 0)),
      pendingInvoices: pendingInvoices.length,
      pendingInvoiceAmount: money(pendingInvoices.reduce((sum, invoice) => sum + money(invoice.totalAmount), 0)),
      cancelledInvoices: cancelledInvoices.length,
      cancelledInvoiceAmount: money(cancelledInvoices.reduce((sum, invoice) => sum + money(invoice.totalAmount), 0)),
      failedPayments: failedPayments.length,
      failedPaymentAmount,
      refundedAmount: refunds,
      newOrders,
      activeServices: recurringRevenue.activeServices,
      activeVpsServices: recurringRevenue.vpsServices,
      activeDedicatedServices: recurringRevenue.dedicatedServices,
      pendingPayments: pendingInvoices.length,
      collectedGst: money(totals.gstCollected),
      mrr,
      arr,
      averageOrderValue: filteredPaidInvoices.length ? money(totals.grossRevenue / filteredPaidInvoices.length) : 0,
    },
    series,
    insights: {
      revenueTrendPercent: growthPercent(series.at(-1)?.grossRevenue || 0, series.at(-2)?.grossRevenue || 0),
      highestSalesDay: highestBucket.label,
      averageOrderValue: filteredPaidInvoices.length ? money(totals.grossRevenue / filteredPaidInvoices.length) : 0,
      topPaymentSource: topGateway ? topGateway[0] : "No service payments",
      paymentSuccessRate,
      liveUpdatedAt: new Date().toISOString(),
    },
    breakdowns: {
      gateway: Array.from(byGateway.entries()).map(([gateway, amount]) => ({ gateway, amount })).sort((a, b) => b.amount - a.amount),
      product: Array.from(byProduct.entries()).map(([product, amount]) => ({ product, amount })).sort((a, b) => b.amount - a.amount),
      source: Array.from(bySource.entries()).map(([source, amount]) => ({ source, amount })).sort((a, b) => b.amount - a.amount),
      topCustomers: Array.from(byCustomer.values()).sort((a, b) => b.amount - a.amount).slice(0, 10),
      walletFlow,
      credits,
      refundedAmount: refunds,
      gstCollected: money(totals.gstCollected),
      couponDiscounts: money(totals.couponDiscounts),
      failedPayments: failedPayments.length,
      failedPaymentAmount,
    },
    revenueByDay: Array.from(byDay.entries()).map(([date, amount]) => ({ date, amount })),
    revenueByGateway: Array.from(byGateway.entries()).map(([gateway, amount]) => ({ gateway, amount })),
    revenueByProduct: Array.from(byProduct.entries()).map(([product, amount]) => ({ product, amount })).sort((a, b) => b.amount - a.amount),
    revenueBySource: Array.from(bySource.entries()).map(([source, amount]) => ({ source, amount })).sort((a, b) => b.amount - a.amount),
    recentPaidInvoices: recentPayments,
    recentPayments,
    failedPaymentsTable: failedPayments.slice(0, 20).map((payment: any, index) => ({ id: index, amount: money(payment.amount), status: "Failed" })),
    topProducts: Array.from(byProduct.entries()).map(([product, amount]) => ({ product, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    topNodes: [],
    countryRevenue: [],
    topCustomers: Array.from(byCustomer.values()).sort((a, b) => b.amount - a.amount).slice(0, 10),
  })
}
