import type { SendMailInput } from "@/lib/email/send"
import { renderInvoicePdf } from "@/lib/invoices"
import { createPanelLog } from "@/lib/panel-log"

export async function invoicePdfAttachment(invoiceId?: string | null, context: {
  orderId?: string | null
  customerId?: string | null
  templateKey?: string | null
} = {}): Promise<SendMailInput["attachments"]> {
  if (!invoiceId) return []
  try {
    const { invoice, buffer } = await renderInvoicePdf(invoiceId)
    return [{
      filename: `invoice-${invoice.invoiceNumber}.pdf`,
      content: buffer,
      contentType: "application/pdf",
    }]
  } catch (error) {
    await createPanelLog({
      category: "Email",
      level: "warn",
      message: "invoice_pdf_attachment_failed",
      customerId: context.customerId || null,
      orderId: context.orderId || null,
      metadata: {
        invoiceId,
        templateKey: context.templateKey || null,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => null)
    return []
  }
}
