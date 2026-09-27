import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { exportPdfTable, exportTabularResponse, exportExcelXml } from "@/lib/admin-export"
import {
  CANCELLED_INVOICE_STATUSES,
  COMPLETED_PAYMENT_STATUSES,
  FAILED_PAYMENT_STATUSES,
  PENDING_INVOICE_STATUSES,
  REFUNDED_PAYMENT_STATUSES,
  WALLET_PAYMENT_PURPOSES,
  activeBillableOrderWhere,
  dateRangeWhere,
  getActiveRecurringRevenueMetrics,
  money,
  paidServiceInvoiceWhere,
  REVENUE_CARD_DEFINITIONS,
} from "@/lib/revenue-analytics"

const HOUR = 3_600_000
const DAY = 86_400_000

// App timezone (IST) - adjust if needed via settings
const APP_TIMEZONE = "Asia/Kolkata"

function rangeWindow(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") || "today"
  const now = new Date()
  const startOfToday = new Date(now.toLocaleString("en-US", { timeZone: APP_TIMEZONE }))
  startOfToday.setHours(0, 0, 0, 0)

  const explicitStart = request.nextUrl.searchParams.get("start")
  const explicitEnd = request.nextUrl.searchParams.get("end")
  if (explicitStart || explicitEnd) {
    return {
      range: "custom",
      start: explicitStart ? new Date(`${explicitStart}T00:00:00${getTzOffset(startOfToday)}`) : startOfToday,
      end: explicitEnd ? new Date(`${explicitEnd}T23:59:59.999${getTzOffset(startOfToday)}`) : now,
      bucket: "day" as const,
    }
  }

  if (range === "24h") return { range, start: new Date(now.getTime() - 23 * HOUR), end: now, bucket: "hour" as const }
  if (range === "yesterday") {
    const start = new Date(startOfToday)
    start.setDate(start.getDate() - 1)
    return { range, start, end: startOfToday, bucket: "day" as const }
  }
  if (range === "7d") return { range, start: new Date(startOfToday.getTime() - 6 * DAY), end: now, bucket: "day" as const }
  if (range === "30d") return { range, start: new Date(startOfToday.getTime() - 29 * DAY), end: now, bucket: "day" as const }
  if (range === "90d") return { range, start: new Date(startOfToday.getTime() - 89 * DAY), end: now, bucket: "day" as const }
  if (range === "1y" || range === "365d") return { range: range === "365d" ? "1y" : range, start: new Date(startOfToday.getFullYear(), startOfToday.getMonth() - 11, 1), end: now, bucket: "month" as const }
  if (range === "lifetime") return { range, start: null, end: null, bucket: "month" as const }
  return { range: "today", start: startOfToday, end: now, bucket: "hour" as const }
}

function getTzOffset(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0")
  return `${sign}${hours}:${minutes}`
}

function dayKey(date: Date) {
  const local = new Date(date.toLocaleString("en-US", { timeZone: APP_TIMEZONE }))
  return local.toISOString().slice(0, 10)
}

function bucketKey(date: Date, bucket: "hour" | "day" | "month") {
  const local = new Date(date.toLocaleString("en-US", { timeZone: APP_TIMEZONE }))
  if (bucket === "hour") {
    const rounded = new Date(local)
    rounded.setMinutes(0, 0, 0)
    return rounded.toISOString()
  }
  if (bucket === "month") return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}`
  return dayKey(local)
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

function paidDate(invoice: { paidAt?: Date | null; createdAt: Date; updatedAt: Date }) {
  return invoice.paidAt || invoice.updatedAt || invoice.createdAt
}

/** Prior period comparison window */
function priorPeriodWindow(window: { start: Date | null; end: Date | null; bucket: "hour" | "day" | "month" }) {
  if (!window.start || !window.end) return { start: null, end: null }
  const duration = window.end.getTime() - window.start.getTime()
  return {
    start: new Date(window.start.getTime() - duration),
    end: new Date(window.start.getTime() - 1),
  }
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_CACHE_HEADERS })
  }

  const window = rangeWindow(request)
  const prior = priorPeriodWindow(window)
  const exportFormat = request.nextUrl.searchParams.get("format")
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1))
  const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)))

  // Filters (all applied at DB level where possible)
  const productFilter = request.nextUrl.searchParams.get("product")?.toLowerCase()
  const countryFilter = request.nextUrl.searchParams.get("country")?.toLowerCase()
  const nodeFilter = request.nextUrl.searchParams.get("node")?.toLowerCase()
  const gatewayFilter = request.nextUrl.searchParams.get("gateway")?.toLowerCase()
  const paymentStatusFilter = request.nextUrl.searchParams.get("paymentStatus")?.toLowerCase()
  const orderStatusFilter = request.nextUrl.searchParams.get("orderStatus")?.toLowerCase()

  const invoiceDate = { start: window.start, end: window.end, field: "paidAt" as const }
  const priorInvoiceDate = { start: prior.start, end: prior.end, field: "paidAt" as const }
  const createdDateWhere = dateRangeWhere({ start: window.start, end: window.end, field: "createdAt" })
  const priorCreatedDateWhere = dateRangeWhere({ start: prior.start, end: prior.end, field: "createdAt" })
  const completedDateWhere = dateRangeWhere({ start: window.start, end: window.end, field: "completedAt" })
  const priorCompletedDateWhere = dateRangeWhere({ start: prior.start, end: prior.end, field: "completedAt" })

  // Build filter conditions for invoices
  const invoiceFilters: any = {}
  if (productFilter) {
    invoiceFilters.OR = [
      { order: { product: { name: { contains: productFilter, mode: "insensitive" } } } },
      { order: { offer: { name: { contains: productFilter, mode: "insensitive" } } } },
    ]
  }
  if (countryFilter) {
    invoiceFilters.customer = { country: { contains: countryFilter, mode: "insensitive" } }
  }
  if (nodeFilter) {
    invoiceFilters.order = {
      proxmoxServer: {
        OR: [
          { id: { contains: nodeFilter, mode: "insensitive" } },
          { name: { contains: nodeFilter, mode: "insensitive" } },
          { nodeName: { contains: nodeFilter, mode: "insensitive" } },
        ],
      },
    }
  }

  // Build filter conditions for payments
  const paymentFilters: any = {}
  if (gatewayFilter) {
    paymentFilters.gateway = { contains: gatewayFilter, mode: "insensitive" }
  }
  if (paymentStatusFilter) {
    paymentFilters.status = { contains: paymentStatusFilter, mode: "insensitive" }
  }

  // Build filter conditions for orders
  const orderFilters: any = {}
  if (orderStatusFilter) {
    orderFilters.status = { contains: orderStatusFilter, mode: "insensitive" }
  }

  // Parallel fetch all required data
  const [
    // Current period
    paidInvoices,
    pendingInvoices,
    cancelledInvoices,
    servicePayments,
    walletTopupRows,
    walletRefundRows,
    gatewaySettlementRows,
    failedPayments,
    refundedPayments,
    newOrders,
    recurringRevenue,

    // Prior period (for comparison)
    priorPaidInvoices,
    priorServicePayments,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...paidServiceInvoiceWhere(invoiceDate), ...invoiceFilters },
      include: {
        customer: { select: { id: true, name: true, email: true, country: true } },
        order: {
          include: {
            product: { select: { id: true, name: true } },
            offer: { select: { id: true, name: true } },
            proxmoxServer: { select: { id: true, name: true, nodeName: true } },
          },
        },
        payments: { where: { status: { in: [...COMPLETED_PAYMENT_STATUSES] }, purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] } }, orderBy: { createdAt: "desc" }, take: 3 },
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    }),

    prisma.invoice.findMany({
      where: { deletedAt: null, status: { in: [...PENDING_INVOICE_STATUSES] }, ...createdDateWhere, ...invoiceFilters },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true, createdAt: true },
    }),

    prisma.invoice.findMany({
      where: { deletedAt: null, status: { in: [...CANCELLED_INVOICE_STATUSES] }, ...createdDateWhere, ...invoiceFilters },
      select: { id: true, invoiceNumber: true, totalAmount: true, status: true },
    }),

    prisma.payment.findMany({
      where: {
        status: { in: [...COMPLETED_PAYMENT_STATUSES] },
        purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] },
        invoice: { is: paidServiceInvoiceWhere() },
        ...completedDateWhere,
        ...paymentFilters,
      },
      select: { amount: true, gateway: true, createdAt: true, completedAt: true, invoiceId: true },
      orderBy: { createdAt: "asc" },
    }),

    prisma.walletTransaction.findMany({
      where: { status: "completed", type: "topup", ...createdDateWhere },
      select: { amount: true, gatewayFee: true, createdAt: true },
    }),

    prisma.walletTransaction.findMany({
      where: { status: "completed", type: "refund", ...createdDateWhere },
      select: { amount: true, createdAt: true },
    }).catch(() => []),

    prisma.gatewaySettlement.findMany({
      where: { status: "completed", ...completedDateWhere },
      select: { feeAmount: true, createdAt: true },
    }).catch(() => []),

    prisma.payment.findMany({
      where: { status: { in: [...FAILED_PAYMENT_STATUSES] }, ...createdDateWhere },
      select: { amount: true },
    }),

    prisma.payment.findMany({
      where: { status: { in: [...REFUNDED_PAYMENT_STATUSES] }, ...createdDateWhere },
      select: { amount: true, invoiceId: true },
    }),

    prisma.order.count({ where: { ...activeBillableOrderWhere(createdDateWhere), ...orderFilters } }),

    getActiveRecurringRevenueMetrics(),

    // Prior period
    prisma.invoice.findMany({
      where: { ...paidServiceInvoiceWhere(priorInvoiceDate), ...invoiceFilters },
      select: { totalAmount: true, taxAmount: true, discountAmount: true, createdAt: true, updatedAt: true },
    }).catch(() => []),

    prisma.payment.findMany({
      where: {
        status: { in: [...COMPLETED_PAYMENT_STATUSES] },
        purpose: { notIn: [...WALLET_PAYMENT_PURPOSES] },
        invoice: { is: paidServiceInvoiceWhere() },
        ...priorCompletedDateWhere,
        ...paymentFilters,
      },
      select: { amount: true, gateway: true, completedAt: true },
    }).catch(() => []),
  ])

  // Apply orderStatus filter to paidInvoices in memory (since it's on order.status which is a string)
  const filteredPaidInvoices = paidInvoices.filter((invoice) => {
    if (orderStatusFilter && !String(invoice.order?.status || "").toLowerCase().includes(orderStatusFilter)) return false
    return true
  })

  // Compute current period totals
  const totals = filteredPaidInvoices.reduce((acc, invoice) => {
    const amount = money(invoice.totalAmount)
    const tax = money(invoice.taxAmount || invoice.gstAmount)
    const discount = money(invoice.discountAmount)
    acc.grossRevenue += amount
    acc.gstCollected += tax
    acc.couponDiscounts += discount
    return acc
  }, { grossRevenue: 0, gstCollected: 0, couponDiscounts: 0 })

  const gatewayPayments = money(servicePayments.filter((p) => p.gateway !== "wallet").reduce((sum, p) => sum + money(p.amount), 0))
  const walletPayments = money(servicePayments.filter((p) => p.gateway === "wallet").reduce((sum, p) => sum + money(p.amount), 0))
  const walletTopups = money(walletTopupRows.reduce((sum, row) => sum + money(row.amount), 0))
  const walletTopupGatewayFees = money(walletTopupRows.reduce((sum, row) => sum + money(row.gatewayFee), 0))
  const gatewaySettlementFees = money(gatewaySettlementRows.reduce((sum, row) => sum + money(row.feeAmount), 0))
  const walletRefunds = money(walletRefundRows.reduce((sum, row) => sum + money(row.amount), 0))
  const paymentRefunds = money(refundedPayments.reduce((sum, row) => sum + money(row.amount), 0))
  // Dedup refunds: wallet refunds already include payment refunds (settlement.ts writes both)
  // Use wallet refunds as the authoritative refund amount
  const refunds = walletRefunds
  const netRevenue = money(totals.grossRevenue - totals.gstCollected)

  // Compute prior period totals for comparison
  const priorTotals = priorPaidInvoices.reduce((acc, invoice) => {
    const amount = money(invoice.totalAmount)
    const tax = money(invoice.taxAmount)
    acc.grossRevenue += amount
    acc.gstCollected += tax
    return acc
  }, { grossRevenue: 0, gstCollected: 0 })

  const priorNetRevenue = money(priorTotals.grossRevenue - priorTotals.gstCollected)

  // Series building (backend aggregation)
  const seriesMap = new Map<string, {
    date: string
    label: string
    grossRevenue: number
    netRevenue: number
    gstCollected: number
    discounts: number
    paidInvoices: number
    walletTopups: number
    walletTopupFees: number
    gatewayFees: number
    refunds: number
    collectedRevenue: number
    walletServicePayments: number
    gatewayServicePayments: number
    failedPaymentAmount: number
    failedPaymentCount: number
    pendingInvoiceAmount: number
    growthPercent: number
  }>()

  const emptyBucket = (key: string) => ({
    date: key,
    label: bucketLabel(key, window.bucket),
    grossRevenue: 0,
    netRevenue: 0,
    gstCollected: 0,
    discounts: 0,
    paidInvoices: 0,
    walletTopups: 0,
    walletTopupFees: 0,
    gatewayFees: 0,
    refunds: 0,
    collectedRevenue: 0,
    walletServicePayments: 0,
    gatewayServicePayments: 0,
    failedPaymentAmount: 0,
    failedPaymentCount: 0,
    pendingInvoiceAmount: 0,
    growthPercent: 0,
  })

  for (const key of buildBucketKeys(window.start, window.end, window.bucket)) seriesMap.set(key, emptyBucket(key))

  // Paid invoices
  for (const invoice of filteredPaidInvoices) {
    const amount = money(invoice.totalAmount)
    const tax = money(invoice.taxAmount || invoice.gstAmount)
    const discount = money(invoice.discountAmount)
    const date = paidDate(invoice)
    const seriesKey = bucketKey(date, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.grossRevenue = money(bucket.grossRevenue + amount)
    bucket.netRevenue = money(bucket.netRevenue + amount - tax)
    bucket.gstCollected = money(bucket.gstCollected + tax)
    bucket.discounts = money(bucket.discounts + discount)
    bucket.paidInvoices += 1
    seriesMap.set(seriesKey, bucket)
  }

  // Service payments (collected revenue)
  for (const payment of servicePayments) {
    const amount = money(payment.amount)
    const date = payment.completedAt || payment.createdAt
    const seriesKey = bucketKey(date, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.collectedRevenue = money(bucket.collectedRevenue + amount)
    if (payment.gateway === "wallet") bucket.walletServicePayments = money(bucket.walletServicePayments + amount)
    else bucket.gatewayServicePayments = money(bucket.gatewayServicePayments + amount)
    seriesMap.set(seriesKey, bucket)
  }

  // Wallet top-ups (liability, NOT revenue)
  for (const row of walletTopupRows) {
    const seriesKey = bucketKey(row.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.walletTopups = money(bucket.walletTopups + money(row.amount))
    bucket.walletTopupFees = money(bucket.walletTopupFees + money(row.gatewayFee))
    seriesMap.set(seriesKey, bucket)
  }

  // Gateway settlement fees
  for (const row of gatewaySettlementRows) {
    const seriesKey = bucketKey(row.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.gatewayFees = money(bucket.gatewayFees + money(row.feeAmount))
    seriesMap.set(seriesKey, bucket)
  }

  // Wallet refunds
  for (const row of walletRefundRows) {
    const seriesKey = bucketKey(row.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.refunds = money(bucket.refunds + money(row.amount))
    seriesMap.set(seriesKey, bucket)
  }

  // Pending invoices
  for (const invoice of pendingInvoices) {
    const seriesKey = bucketKey(invoice.createdAt, window.bucket)
    const bucket = seriesMap.get(seriesKey) || emptyBucket(seriesKey)
    bucket.pendingInvoiceAmount = money(bucket.pendingInvoiceAmount + money(invoice.totalAmount))
    seriesMap.set(seriesKey, bucket)
  }

  const series = Array.from(seriesMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // Prior period series for growth
  const priorSeriesMap = new Map<string, number>()
  for (const key of buildBucketKeys(prior.start, prior.end, window.bucket)) priorSeriesMap.set(key, 0)
  for (const invoice of priorPaidInvoices) {
    const amount = money(invoice.totalAmount)
    const date = paidDate(invoice)
    const seriesKey = bucketKey(date, window.bucket)
    priorSeriesMap.set(seriesKey, money((priorSeriesMap.get(seriesKey) || 0) + amount))
  }
  const priorSeries = Array.from(priorSeriesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // Compute growth for each bucket
  for (let index = 0; index < series.length; index += 1) {
    const priorValue = priorSeries[index]?.[1] || 0
    const currentValue = series[index].grossRevenue
    series[index].growthPercent = growthPercent(currentValue, priorValue)
  }

  // Aggregations
  const byDay = new Map<string, number>()
  const byGateway = new Map<string, number>()
  const byProduct = new Map<string, number>()
  const bySource = new Map<string, number>()
  const byCountry = new Map<string, number>()
  const byNode = new Map<string, number>()
  const byCustomer = new Map<string, { customer: string; amount: number }>()

  for (const invoice of filteredPaidInvoices) {
    const amount = money(invoice.totalAmount)
    const date = paidDate(invoice)
    byDay.set(dayKey(date), money((byDay.get(dayKey(date)) || 0) + amount))
    const product = invoice.order?.offer?.name || invoice.order?.product?.name || "Other"
    byProduct.set(product, money((byProduct.get(product) || 0) + amount))
    const metadata = (invoice.order?.metadata as Record<string, unknown> | null) || {}
const analytics = (metadata.analytics as Record<string, unknown> | null) || {}
const source = String(analytics.utmSource || metadata.utmSource || "Direct")
    bySource.set(source, money((bySource.get(source) || 0) + amount))
    const country = String(invoice.customer?.country || "Unknown")
    byCountry.set(country, money((byCountry.get(country) || 0) + amount))
    const node = invoice.order?.proxmoxServer?.nodeName || invoice.order?.proxmoxServer?.name || "Unknown"
    byNode.set(node, money((byNode.get(node) || 0) + amount))
    const key = invoice.customer?.id || "unknown"
    const label = invoice.customer?.name || invoice.customer?.email || "Unknown customer"
    const current = byCustomer.get(key) || { customer: label, amount: 0 }
    current.amount = money(current.amount + amount)
    byCustomer.set(key, current)
  }

  for (const payment of servicePayments) {
    const gateway = payment.gateway || "unknown"
    const amount = money(payment.amount)
    byGateway.set(gateway, money((byGateway.get(gateway) || 0) + amount))
  }

  // Recent payments for table (paginated)
  const recentPaymentsAll = filteredPaidInvoices
    .sort((a, b) => new Date(paidDate(b)).getTime() - new Date(paidDate(a)).getTime())
    .map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customer: invoice.customer?.name || invoice.customer?.email || "Unknown customer",
      product: invoice.order?.offer?.name || invoice.order?.product?.name || "Other",
      node: invoice.order?.proxmoxServer?.name || invoice.order?.proxmoxServer?.nodeName || "-",
      country: invoice.customer?.country || "Unknown",
      gateway: invoice.payments?.[0]?.gateway || "unknown",
      amount: money(invoice.totalAmount),
      netAmount: money(money(invoice.totalAmount) - money(invoice.taxAmount || invoice.gstAmount || 0)),
      tax: money(invoice.taxAmount || invoice.gstAmount || 0),
      discount: money(invoice.discountAmount || 0),
      paidAt: paidDate(invoice).toISOString(),
      orderStatus: invoice.order?.status || "unknown",
      paymentStatus: invoice.payments?.[0]?.status || "unknown",
    }))

  const totalPages = Math.ceil(recentPaymentsAll.length / pageSize)
  const recentPayments = recentPaymentsAll.slice((page - 1) * pageSize, page * pageSize)

  // Export rows (all, not paginated)
  const exportRows = recentPaymentsAll.map((row) => ({
    Invoice: row.invoiceNumber,
    Customer: row.customer,
    Product: row.product,
    Node: row.node,
    Country: row.country,
    Gateway: row.gateway,
    "Gross Amount": row.amount,
    "Net Amount": row.netAmount,
    "Tax/GST": row.tax,
    Discount: row.discount,
    PaidAt: row.paidAt,
    "Order Status": row.orderStatus,
    "Payment Status": row.paymentStatus,
  }))
  const exportHeaders = Object.keys(exportRows[0] || {})

  // Cards with prior-period comparison
  const cards = {
    grossRevenue: { current: money(totals.grossRevenue), prior: money(priorTotals.grossRevenue), change: growthPercent(money(totals.grossRevenue), money(priorTotals.grossRevenue)) },
    netRevenue: { current: netRevenue, prior: priorNetRevenue, change: growthPercent(netRevenue, priorNetRevenue) },
    collectedRevenue: { current: money(servicePayments.reduce((sum, p) => sum + money(p.amount), 0)), prior: money(priorServicePayments.reduce((sum, p) => sum + money(p.amount), 0)), change: 0 },
    gatewayFees: { current: money(walletTopupGatewayFees + gatewaySettlementFees), prior: 0, change: 0 },
    gstCollected: { current: money(totals.gstCollected), prior: money(priorTotals.gstCollected), change: growthPercent(money(totals.gstCollected), money(priorTotals.gstCollected)) },
    refunds: { current: refunds, prior: 0, change: 0 },
    walletTopups: { current: walletTopups, prior: 0, change: 0 },
    walletServicePayments: { current: walletPayments, prior: 0, change: 0 },
    aov: { current: filteredPaidInvoices.length ? money(totals.grossRevenue / filteredPaidInvoices.length) : 0, prior: 0, change: 0 },
    mrr: { current: recurringRevenue.mrr, prior: 0, change: 0 },
    arr: { current: recurringRevenue.arr, prior: 0, change: 0 },
    paidInvoices: { current: filteredPaidInvoices.length, prior: priorPaidInvoices.length, change: growthPercent(filteredPaidInvoices.length, priorPaidInvoices.length) },
    pendingInvoices: { current: pendingInvoices.length, prior: 0, change: 0 },
    failedPayments: { current: failedPayments.length, prior: 0, change: 0 },
    newOrders: { current: newOrders, prior: 0, change: 0 },
  }

  const highestBucket = series.reduce((best, item) => item.grossRevenue > best.grossRevenue ? item : best, series[0] || { label: "No revenue", grossRevenue: 0 })
  const topGateway = Array.from(byGateway.entries()).sort((a, b) => b[1] - a[1])[0]
  const failedPaymentAmount = money(failedPayments.reduce((sum, payment) => sum + money(payment.amount), 0))
  const totalPaymentAttempts = servicePayments.length + failedPayments.length
  const paymentSuccessRate = totalPaymentAttempts ? money((servicePayments.length / totalPaymentAttempts) * 100) : 0

  if (exportFormat === "csv") {
    return exportTabularResponse({ rows: exportRows, headers: exportHeaders, filename: "revenue-report", format: "csv" })
  }
  if (exportFormat === "excel") {
    return exportExcelXml({ rows: exportRows, headers: exportHeaders, filename: "revenue-report" })
  }
  if (exportFormat === "pdf") {
    return exportPdfTable({ title: "Revenue Report", rows: exportRows, headers: exportHeaders, filename: "revenue-report" })
  }

  return NextResponse.json({
    range: window.range,
    start: window.start?.toISOString() || null,
    end: window.end?.toISOString() || null,
    priorPeriod: { start: prior.start?.toISOString() || null, end: prior.end?.toISOString() || null },
    cards,
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
      country: Array.from(byCountry.entries()).map(([country, amount]) => ({ country, amount })).sort((a, b) => b.amount - a.amount),
      node: Array.from(byNode.entries()).map(([node, amount]) => ({ node, amount })).sort((a, b) => b.amount - a.amount),
      topCustomers: Array.from(byCustomer.values()).sort((a, b) => b.amount - a.amount).slice(0, 10),
      walletTopups: walletTopups,
      walletTopupFees: walletTopupGatewayFees,
      gatewayFees: gatewaySettlementFees,
      refunds,
      gstCollected: money(totals.gstCollected),
      discounts: money(totals.couponDiscounts),
      failedPayments: failedPayments.length,
      failedPaymentAmount,
    },
    revenueByDay: Array.from(byDay.entries()).map(([date, amount]) => ({ date, amount })),
    revenueByGateway: Array.from(byGateway.entries()).map(([gateway, amount]) => ({ gateway, amount })),
    revenueByProduct: Array.from(byProduct.entries()).map(([product, amount]) => ({ product, amount })).sort((a, b) => b.amount - a.amount),
    revenueBySource: Array.from(bySource.entries()).map(([source, amount]) => ({ source, amount })).sort((a, b) => b.amount - a.amount),
    revenueByCountry: Array.from(byCountry.entries()).map(([country, amount]) => ({ country, amount })).sort((a, b) => b.amount - a.amount),
    revenueByNode: Array.from(byNode.entries()).map(([node, amount]) => ({ node, amount })).sort((a, b) => b.amount - a.amount),
    recentPaidInvoices: recentPayments,
    pagination: { page, pageSize, total: recentPaymentsAll.length, totalPages },
    failedPaymentsTable: failedPayments.slice(0, 20).map((payment: any, index) => ({ id: index, amount: money(payment.amount), status: "Failed" })),
    topProducts: Array.from(byProduct.entries()).map(([product, amount]) => ({ product, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    topNodes: Array.from(byNode.entries()).map(([node, amount]) => ({ node, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    countryRevenue: Array.from(byCountry.entries()).map(([country, amount]) => ({ country, amount })).sort((a, b) => b.amount - a.amount).slice(0, 10),
    topCustomers: Array.from(byCustomer.values()).sort((a, b) => b.amount - a.amount).slice(0, 10),
    cardDefinitions: REVENUE_CARD_DEFINITIONS,
  }, { headers: NO_CACHE_HEADERS })
}