import { prisma } from "@/lib/db"
import { sendTemplateEmail } from "@/lib/email/send-mail"
import { invoicePdfAttachment } from "@/lib/email/invoice-attachments"
import { createPanelLog } from "@/lib/panel-log"
import { getSiteUrl } from "@/lib/settings/site-settings"

const BILLING_PDF_TEMPLATES = new Set([
  "order_created",
  "order_pending_payment",
  "order_paid",
  "payment_success",
  "invoice_created",
  "invoice_paid",
  "renewal_invoice",
  "payment_failed",
])

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n.toFixed(2) : "0.00"
}

export async function sendOrderInvoiceEmail(input: {
  templateKey: string
  orderId?: string | null
  invoiceId?: string | null
  paymentUrl?: string | null
  metadata?: Record<string, unknown>
}) {
  const invoice = input.invoiceId
    ? await prisma.invoice.findUnique({ where: { id: input.invoiceId }, include: { customer: true, order: { include: { customer: true, product: true, offer: true } } } }).catch(() => null)
    : null
  const order = input.orderId
    ? await prisma.order.findUnique({
        where: { id: input.orderId },
        include: {
          customer: true,
          product: true,
          offer: true,
          invoices: true,
        },
      })
    : invoice?.order || null
  const customer = order?.customer || invoice?.customer
  if (!customer?.email) return null

  const resolvedInvoice = invoice || (order as any)?.invoices || null
  const siteUrl = await getSiteUrl()
  const invoiceId = resolvedInvoice?.id || null
  const attachments = (BILLING_PDF_TEMPLATES.has(input.templateKey)
    ? await invoicePdfAttachment(invoiceId, { orderId: order?.id || null, customerId: customer.id, templateKey: input.templateKey })
    : []) || []
  const invoiceUrl = invoiceId ? `/client-area/billing/invoices/${invoiceId}` : "/client-area/billing"
  const paymentUrl = input.paymentUrl || invoiceUrl

  const result = await sendTemplateEmail({
    templateKey: input.templateKey,
    to: customer.email,
    variables: {
      userName: customer.name || "there",
      email: customer.email,
      orderId: order?.orderNumber || resolvedInvoice?.invoiceNumber || "",
      invoiceNumber: resolvedInvoice?.invoiceNumber || "",
      dueDate: resolvedInvoice?.dueDate ? new Date(resolvedInvoice.dueDate).toLocaleDateString("en-IN") : "",
      amount: money(resolvedInvoice?.totalAmount ?? order?.payableAmount ?? order?.finalAmount ?? order?.totalAmount),
      currency: order?.currency || resolvedInvoice?.currency || "INR",
      productName: order?.offer?.name || order?.product?.name || "Cloud Compute Instance",
      serviceName: order?.hostname || order?.serviceId || order?.orderNumber || resolvedInvoice?.invoiceNumber || "Cloud service",
      paymentUrl: paymentUrl.startsWith("http") ? paymentUrl : `${siteUrl}${paymentUrl}`,
    },
    attachments,
    customerId: customer.id,
    orderId: order?.id || null,
    invoiceId,
    metadata: input.metadata,
  })
  await createPanelLog({
    category: "Email",
    level: result.success ? "info" : "warn",
    message: result.success ? "invoice_email_sent" : "invoice_email_failed",
    customerId: customer.id,
    orderId: order?.id || null,
    metadata: {
      templateKey: input.templateKey,
      recipient: customer.email,
      invoiceId,
      status: result.status,
      attachmentCount: attachments.length,
      error: "error" in result ? result.error : "message" in result ? result.message : null,
      ...(input.metadata || {}),
    },
  }).catch(() => null)
  return result
}
