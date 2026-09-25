import { prisma } from "@/lib/db"
import { serializePaymentDetails } from "@/lib/payments/payment-details"
import { getPaymentSettings } from "@/lib/settings"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { money } from "@/lib/invoices/tax"
import { formatBandwidthQuota } from "@/lib/bandwidth-format"
import QRCode from "qrcode"

export type InvoiceViewModel = Awaited<ReturnType<typeof buildInvoiceViewModel>>

export const PAYABLE_INVOICE_STATUSES = new Set(["draft", "sent", "pending", "unpaid", "overdue", "failed", "payment_failed"])
export const CLOSED_INVOICE_STATUSES = new Set(["paid", "cancelled", "canceled", "refunded", "void"])

export const invoiceInclude = {
  customer: true,
  order: {
    include: {
      product: true,
      offer: true,
      customConfig: true,
      operatingSystem: true,
      payments: { orderBy: { createdAt: "desc" as const }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" as const }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
  },
  payments: { orderBy: { createdAt: "desc" as const }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" as const }, take: 1 } } },
  paymentAttempts: { orderBy: { createdAt: "desc" as const }, take: 1 },
}

function text(value: unknown): string | null {
  const str = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
  return str || null
}

function addressFromCustomer(customer: any, invoice?: any) {
  const invoiceAddress = invoice?.billingAddress && typeof invoice.billingAddress === "object" && !Array.isArray(invoice.billingAddress)
    ? invoice.billingAddress
    : null
  if (invoiceAddress) {
    return [
      invoiceAddress.addressLine1 || invoiceAddress.line1,
      invoiceAddress.addressLine2 || invoiceAddress.line2,
      invoiceAddress.city,
      invoiceAddress.state,
      invoiceAddress.postalCode || invoiceAddress.pin || invoiceAddress.zip,
      invoiceAddress.country,
    ].map(text).filter(Boolean) as string[]
  }
  const jsonAddress = customer?.address && typeof customer.address === "object" && !Array.isArray(customer.address)
    ? customer.address
    : {}
  return [
    customer?.addressLine1 || jsonAddress.addressLine1 || jsonAddress.line1,
    customer?.addressLine2 || jsonAddress.addressLine2 || jsonAddress.line2,
    customer?.city || jsonAddress.city,
    customer?.state || jsonAddress.state,
    customer?.postalCode || jsonAddress.postalCode || jsonAddress.zip,
    customer?.country || jsonAddress.country,
  ].map(text).filter(Boolean) as string[]
}

function normalizeLineItems(value: unknown, order: any) {
  const items = Array.isArray(value) ? value : []
  if (items.length) {
    return items.map((item: any) => ({
      description: text(item.description) || order?.offer?.name || order?.product?.name || "Cloud Compute Instance",
      quantity: Number(item.quantity || 1),
      unitPrice: money(item.unitPrice),
      termMonths: Number(item.termMonths || order?.termMonths || 1),
      total: money(item.total ?? item.amount ?? item.unitPrice),
      meta: [
        item.osName ? `OS: ${item.osName}` : null,
        item.vcpu ? `${item.vcpu} vCPU` : null,
        item.ramGb ? `${item.ramGb} GB RAM` : null,
        item.storageGb ? `${item.storageGb} GB storage` : null,
        item.bandwidthTb ? `${formatBandwidthQuota(item.bandwidthTb)} bandwidth` : null,
      ].filter(Boolean) as string[],
    }))
  }

  return [{
    description: order?.offer?.name || order?.product?.name || "Cloud Compute Instance",
    quantity: 1,
    unitPrice: money(order?.subtotal || order?.totalAmount),
    termMonths: Number(order?.termMonths || 1),
    total: money(order?.subtotal || order?.totalAmount),
    meta: [
      order?.osName || order?.operatingSystem?.name ? `OS: ${order?.osName || order?.operatingSystem?.name}` : null,
      order?.product?.cpuCores || order?.customConfig?.cpuCores ? `${order?.product?.cpuCores || order?.customConfig?.cpuCores} vCPU` : null,
      order?.product?.ramGb || order?.customConfig?.ramGb ? `${order?.product?.ramGb || order?.customConfig?.ramGb} GB RAM` : null,
      order?.product?.storageGb ? `${order.product.storageGb} GB ${String(order.product.storageType || "storage").toUpperCase()}` : null,
      order?.product?.bandwidthTb || order?.customConfig?.bandwidthTb ? `${formatBandwidthQuota(order?.product?.bandwidthTb || order?.customConfig?.bandwidthTb)} bandwidth` : null,
    ].filter(Boolean) as string[],
  }]
}

function paymentRows(paymentDetails: ReturnType<typeof serializePaymentDetails>, invoice: any) {
  const paid = ["paid", "completed", "success", "successful", "verification_pending"].includes(String(paymentDetails.status || invoice.status || "").toLowerCase())
  const transactionId = paymentDetails.transactionId &&
    paymentDetails.transactionId !== paymentDetails.merchantOrderId &&
    paymentDetails.transactionId !== paymentDetails.gatewayOrderId
    ? paymentDetails.transactionId
    : null
  const rows = [
    ["Gateway", paymentDetails.gateway === "wallet" ? "Wallet" : paymentDetails.gateway],
    ["Payment status", paymentDetails.status || invoice.status],
    ["Transaction ID", transactionId],
    ["Gateway order ID", paymentDetails.gatewayOrderId],
    ["Gateway payment ID", paymentDetails.gatewayPaymentId],
    ["Merchant order ID", paymentDetails.merchantOrderId],
    ["UTR / Bank reference", paymentDetails.utr || paymentDetails.bankReferenceId],
    ["Paid at", paymentDetails.paidAt],
    ["Amount paid", paid || paymentDetails.paidAt ? paymentDetails.amountPaid : null],
    ["Payment method", paymentDetails.paymentMethod],
  ] as const
  return rows
    .map(([label, value]) => ({ label, value }))
    .filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim() !== "")
}

export function canPayInvoiceStatus(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase()
  return PAYABLE_INVOICE_STATUSES.has(normalized) && !CLOSED_INVOICE_STATUSES.has(normalized)
}

function firstEnabledUpiVpa(configs: any[]) {
  for (const config of configs) {
    const extra = config?.extraConfig && typeof config.extraConfig === "object" && !Array.isArray(config.extraConfig)
      ? config.extraConfig as Record<string, unknown>
      : {}
    const value = text(extra.upiVpa || extra.upiId || extra.vpa)
    if (value) return value
  }
  return text(process.env.UPI_PAYMENT_VPA)
}

async function buildUpiQrDataUrl(invoice: any, amount: number, payeeLabel: string) {
  if (String(invoice.currency || "INR").toUpperCase() !== "INR") return null
  const configs = await prisma.domainGatewayConfig.findMany({
    where: { enabled: true },
    select: { extraConfig: true },
  }).catch(() => [])
  const upiVpa = firstEnabledUpiVpa(configs)
  if (!upiVpa) return null
  const payeeName = encodeURIComponent(payeeLabel || "Cloud")
  const note = encodeURIComponent(`Invoice ${invoice.invoiceNumber}`)
  const uri = `upi://pay?pa=${encodeURIComponent(upiVpa)}&pn=${payeeName}&am=${amount.toFixed(2)}&cu=INR&tn=${note}`
  return QRCode.toDataURL(uri, { margin: 1, width: 180 }).catch(() => null)
}

export async function buildInvoiceViewModel(invoice: any) {
  const [site, paymentSettings] = await Promise.all([
    getPublicSiteSettings(),
    getPaymentSettings().catch(() => null),
  ])
  const order = invoice.order
  const payment = invoice.payments?.[0] || order?.payments?.[0] || null
  const paymentAttempt = invoice.paymentAttempts?.[0] || order?.paymentAttempts?.[0] || payment?.paymentAttempts?.[0] || null
  const paymentDetails = serializePaymentDetails({ invoice, payment, paymentAttempt, order })
  const metadata = invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata) ? invoice.metadata : {}
  const pricingSnapshot = (metadata as any).pricingSnapshot && typeof (metadata as any).pricingSnapshot === "object" && !Array.isArray((metadata as any).pricingSnapshot)
    ? (metadata as any).pricingSnapshot
    : null
  const status = String(invoice.status || "draft").toLowerCase()
  const invoiceType = String((metadata as any).invoiceType || "").toLowerCase()
  const invoiceCurrency = "INR"
  const taxLabel = String(invoice.taxLabel || "GST")
  const gstPercent = money(invoice.gstPercent ?? invoice.taxRate)
  const gstAmount = money(invoice.gstAmount ?? invoice.taxAmount)
  const totalAmount = money(invoice.totalAmount)
  const canPay = canPayInvoiceStatus(status)

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    title: invoiceType === "proforma" || status === "pending" ? "Proforma Invoice" : "Tax Invoice",
    status,
    canPay,
    orderId: invoice.orderId || null,
    orderNumber: order?.orderNumber || (metadata as any).orderNumber || null,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt || null,
    currency: invoiceCurrency,
    subtotal: money(invoice.subtotal),
    taxRate: money(invoice.taxRate),
    taxAmount: money(invoice.taxAmount),
    gstPercent,
    gstAmount,
    taxLabel,
    discountAmount: money(invoice.discountAmount),
    discountPercent: money(pricingSnapshot?.discountPercent ?? (money(invoice.subtotal) > 0 ? (money(invoice.discountAmount) / money(invoice.subtotal)) * 100 : 0)),
    taxableAmount: money(pricingSnapshot?.taxableAmount ?? Math.max(0, money(invoice.subtotal) - money(invoice.discountAmount))),
    totalAmount,
    notes: invoice.notes || null,
    company: {
      name: site.brandName,
      legalName: site.legalCompanyName,
      address: site.companyAddress,
      gstin: site.gstNumber,
      vatNumber: site.vatNumber,
      registrationNumber: site.registrationNumber,
      email: site.billingEmail || site.supportEmail,
      supportEmail: site.supportEmail,
      phone: site.companyPhone,
      website: site.siteUrl,
      logoUrl: site.invoiceLogoUrl || site.logoUrl,
      footerDescription: site.footerDescription,
      invoiceFooterText: paymentSettings?.invoiceFooterText || site.footerCopyrightText || site.footerDescription,
    },
    customer: {
      id: invoice.customer.id,
      name: text((metadata as any).billingName || invoice.billingAddress?.name) || invoice.customer.name || "Customer",
      company: invoice.customer.company || null,
      email: text(invoice.billingAddress?.email) || invoice.customer.email,
      phone: text(invoice.billingAddress?.phone) || invoice.customer.phone || null,
      gstin: text(invoice.billingAddress?.gstin) || invoice.customer.gstin || null,
      addressLines: addressFromCustomer(invoice.customer, invoice),
    },
    lineItems: normalizeLineItems(invoice.lineItems, order),
    paymentDetails,
    paymentRows: paymentRows(paymentDetails, invoice),
    upiQrDataUrl: canPay ? await buildUpiQrDataUrl(invoice, totalAmount, site.brandName) : null,
  }
}

export async function getInvoiceViewModelById(id: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceInclude })
  if (!invoice || invoice.deletedAt) return null
  return buildInvoiceViewModel(invoice)
}
