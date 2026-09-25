import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getSessionFromCookies } from "@/lib/server-auth"
import { InvoiceView } from "@/components/invoice/invoice-view"
import { buildInvoiceViewModel, invoiceInclude } from "@/lib/invoices/invoice-view-model"
import { createPanelLog } from "@/lib/panel-log"

export default async function ClientInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies()
  if (!session) redirect("/login")
  if (session.role !== "client") notFound()

  const { id } = await params
  const invoice = await prisma.invoice.findFirst({
    where: { id, customerId: session.id },
    include: invoiceInclude,
  })

  if (!invoice) notFound()
  await createPanelLog({
    category: "Payment",
    message: "invoice_viewed",
    actorType: "customer",
    actorId: session.id,
    actorEmail: String(session.email || ""),
    customerId: session.id,
    orderId: invoice.orderId || null,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, source: "client_invoice_page" },
  }).catch(() => null)
  const viewModel = await buildInvoiceViewModel(invoice)
  return (
    <InvoiceView
      invoice={viewModel}
      downloadUrl={`/api/client/invoices/${invoice.id}/pdf`}
      payUrl={`/api/client/invoices/${invoice.id}/pay`}
      printLogUrl={`/api/client/invoices/${invoice.id}/print`}
    />
  )
}
