import fs from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer"
import { renderInvoicePdfTemplate } from "@/components/invoice/invoice-pdf-template"
import { prisma } from "@/lib/db"
import { serializePaymentDetails } from "@/lib/payments/payment-details"
import { getInvoiceViewModelById } from "@/lib/invoices/invoice-view-model"
import { invoiceTaxWriteFields, money } from "@/lib/invoices/tax"
import { getBillingPricingSettings } from "@/lib/settings"

function invoiceNumberFor(orderNumber: string) {
  return `INV-${orderNumber.replace(/[^a-zA-Z0-9-]/g, "").replace(/^-+/, "")}`
}

export function serializeInvoice(invoice: any) {
  const paymentDetails = serializePaymentDetails({ invoice, order: invoice.order })
  const metadata = invoice.metadata && typeof invoice.metadata === "object" && !Array.isArray(invoice.metadata) ? invoice.metadata as Record<string, any> : {}
  const pricingSnapshot = metadata.pricingSnapshot && typeof metadata.pricingSnapshot === "object" && !Array.isArray(metadata.pricingSnapshot)
    ? metadata.pricingSnapshot
    : null
  return {
    ...invoice,
    subtotal: money(invoice.subtotal),
    taxRate: money(invoice.taxRate),
    taxAmount: money(invoice.taxAmount),
    gstPercent: money(invoice.gstPercent ?? invoice.taxRate),
    gstAmount: money(invoice.gstAmount ?? invoice.taxAmount),
    taxLabel: String(invoice.taxLabel || "GST"),
    discountAmount: money(invoice.discountAmount),
    taxableAmount: money(pricingSnapshot?.taxableAmount ?? Math.max(0, money(invoice.subtotal) - money(invoice.discountAmount))),
    totalAmount: money(invoice.totalAmount),
    lineItems: invoice.lineItems || [],
    metadata: invoice.metadata || {},
    paymentDetails,
  }
}

export async function createInvoiceForOrder(orderId: string, options: { allowPending?: boolean; paymentId?: string | null } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      product: true,
      offer: true,
      customConfig: true,
      dedicatedService: { include: { dedicatedOsOption: true } },
      operatingSystem: true,
      payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (!order) throw new Error("Order not found for invoice")
  if (!order.customerId || !order.customer) throw new Error("Order customer missing for invoice")
  const paid = ["paid", "active", "payment_verified", "verification_pending", "paid_waiting_installation", "installing", "delivered"].includes(order.status)
  if (!paid && !options.allowPending) {
    throw new Error("Invoice can only be created for a paid order")
  }

  const existing = await prisma.invoice.findFirst({ where: { orderId } })
  if (existing) {
    if (paid && existing.status !== "paid") {
      const existingMetadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown>
        : {}
      return prisma.invoice.update({
        where: { id: existing.id },
        data: {
          status: "paid",
          paidAt: existing.paidAt || new Date(),
          metadata: {
            ...existingMetadata,
            paymentId: options.paymentId || order.payments[0]?.id || existingMetadata.paymentId || null,
            gatewayOrderId: order.payments[0]?.gatewayOrderId || order.paymentAttempts[0]?.gatewayOrderId || order.cashfreeOrderId || existingMetadata.gatewayOrderId || null,
            gatewayPaymentId: order.payments[0]?.gatewayPaymentId || order.paymentAttempts[0]?.gatewayPaymentId || existingMetadata.gatewayPaymentId || null,
          },
          paymentTransactionId: serializePaymentDetails({ payment: order.payments[0], paymentAttempt: order.paymentAttempts[0], order }).transactionId,
        },
      })
    }
    return existing
  }

  const orderMetadata = order.metadata && typeof order.metadata === "object" && !Array.isArray(order.metadata)
    ? order.metadata as Record<string, any>
    : {}
  const pricingSnapshot = orderMetadata.pricingSnapshot && typeof orderMetadata.pricingSnapshot === "object" && !Array.isArray(orderMetadata.pricingSnapshot)
    ? orderMetadata.pricingSnapshot as Record<string, any>
    : null
  const regionalPricing = pricingSnapshot?.regional && typeof pricingSnapshot.regional === "object" ? pricingSnapshot.regional as Record<string, any> : null
  const subtotal = money(pricingSnapshot?.subtotal ?? order.subtotal)
  const orderCurrency = "INR"
  const taxAmount = money(pricingSnapshot?.gst ?? (order as any).taxAmount)
  const discountAmount = money(pricingSnapshot?.discount ?? order.discountAmount)
  const totalAmount = money(pricingSnapshot?.total ?? order.payableAmount ?? order.finalAmount ?? order.totalAmount)
  const taxableAmount = money(pricingSnapshot?.taxableAmount ?? Math.max(0, subtotal - discountAmount))
  const discountPercent = money(pricingSnapshot?.discountPercent ?? (subtotal > 0 ? (discountAmount / subtotal) * 100 : 0))
  const billingSettings = await getBillingPricingSettings().catch(() => null)
  const invoiceDueDays = Number(billingSettings?.invoiceDueDays ?? 7)
  const defaultTaxPercent = Number(billingSettings?.defaultTaxPercent ?? 18)
  const defaultTaxLabel = String(billingSettings?.defaultTaxLabel || "GST")
  const issueDate = new Date()
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + invoiceDueDays)
  const productName = String(orderMetadata.productName || "")
    ? String(orderMetadata.productName)
    : orderMetadata.kind === "disk_upgrade"
      ? `Disk upgrade - ${orderMetadata.diskUpgrade?.vps?.name || "Cloud Instance"}`
      : String(order.orderType || "").toLowerCase() === "dedicated"
        ? `${order.product?.name || "Dedicated Server"} - Bare Metal Server`
        : order.offer?.name || order.product?.name || "Custom Cloud Instance"
  const billingAddressSnapshot = orderMetadata.billingAddress && typeof orderMetadata.billingAddress === "object" && !Array.isArray(orderMetadata.billingAddress)
    ? orderMetadata.billingAddress
    : null

  const lineItems = [
    {
      description: productName,
      quantity: 1,
      unitPrice: subtotal,
      termMonths: order.termMonths,
      total: subtotal,
      osName: order.osName || order.operatingSystem?.name || null,
      selectedPlatform: order.dedicatedService?.selectedOsName || order.dedicatedService?.dedicatedOsOption?.name || null,
      vcpu: order.product?.cpuCores || order.customConfig?.cpuCores || null,
      ramGb: order.product?.ramGb || order.customConfig?.ramGb || null,
      storageGb: order.product?.storageGb || null,
      bandwidthTb: order.product ? Number(order.product.bandwidthTb) : order.customConfig ? Number(order.customConfig.bandwidthTb) : null,
    },
  ]

  return prisma.invoice.create({
    data: {
      invoiceNumber: invoiceNumberFor(order.orderNumber),
      orderId: order.id,
      customerId: order.customerId,
      issueDate,
      dueDate,
      subtotal,
      ...invoiceTaxWriteFields({ taxRate: money(pricingSnapshot?.taxPercent ?? defaultTaxPercent), taxAmount, taxLabel: String(pricingSnapshot?.taxLabel || defaultTaxLabel) }),
      discountAmount,
      totalAmount,
      currency: orderCurrency,
      status: paid ? "paid" : "pending",
      type: "service",
      lineItems,
      paidAt: paid ? new Date() : null,
      billingAddress: billingAddressSnapshot || {
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        addressLine1: order.customer.addressLine1 || "Address not provided",
        addressLine2: order.customer.addressLine2,
        city: order.customer.city || "Unknown",
        state: order.customer.state || "Unknown",
        postalCode: order.customer.postalCode || "000000",
        country: order.customer.country || "India",
        gstin: order.customer.gstin,
        panNumber: order.customer.panNumber,
      },
      metadata: {
        orderNumber: order.orderNumber,
        osName: order.osName || order.operatingSystem?.name || null,
        pricingSnapshot: {
          subtotal,
          discount: discountAmount,
          discountPercent,
          taxableAmount,
          gst: taxAmount,
          taxLabel: String(pricingSnapshot?.taxLabel || "GST"),
          total: totalAmount,
          regional: regionalPricing,
        },
        paymentId: options.paymentId || order.payments[0]?.id || null,
        gatewayOrderId: order.payments[0]?.gatewayOrderId || order.paymentAttempts[0]?.gatewayOrderId || order.cashfreeOrderId || null,
        gatewayPaymentId: order.payments[0]?.gatewayPaymentId || order.paymentAttempts[0]?.gatewayPaymentId || null,
      },
      paymentTransactionId: serializePaymentDetails({ payment: order.payments[0], paymentAttempt: order.paymentAttempts[0], order }).transactionId,
    },
  })
}

export async function repairMissingInvoices() {
  const paidOrders = await prisma.order.findMany({
    where: {
      status: { in: ["paid", "active", "payment_verified", "verification_pending"] },
      invoices: { is: null },
      customerId: { not: null },
    },
    select: { id: true },
  })

  const created = []
  const failed = []
  for (const order of paidOrders) {
    try {
      created.push(await createInvoiceForOrder(order.id))
    } catch (error: any) {
      failed.push({ orderId: order.id, reason: error?.message || "Failed to create invoice" })
    }
  }
  return { checked: paidOrders.length, created: created.length, failed }
}

async function readInvoicePdfCss() {
  return fs.readFile(path.join(process.cwd(), "app", "invoice-pdf.css"), "utf8")
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

async function renderInvoicePdfHtml(invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceViewModelById>>>) {
  const css = await readInvoicePdfCss()
  const markup = renderInvoicePdfTemplate(invoice)
  const baseUrl = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || invoice.company.website || "").trim()
  const baseTag = baseUrl ? `<base href="${escapeHtmlAttribute(baseUrl.replace(/\/?$/, "/"))}" />` : ""

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=794, initial-scale=1" />
    ${baseTag}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;650;700;750&family=Geist+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>${css}</style>
  </head>
  <body>${markup}</body>
</html>`
}

export async function renderInvoicePdf(invoiceId: string): Promise<{ invoice: any; buffer: Buffer }> {
  const invoice = await getInvoiceViewModelById(invoiceId)
  if (!invoice) throw new Error("Invoice not found")

  const html = await renderInvoicePdfHtml(invoice)
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 })
    await page.emulateMediaType("print")
    await page.setContent(html, { waitUntil: "load" })
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => null)
    await page.evaluate(() => document.fonts?.ready)
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    })

    return { invoice, buffer: Buffer.from(pdf) }
  } finally {
    await browser.close()
  }
}
