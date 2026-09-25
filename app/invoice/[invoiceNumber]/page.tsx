import { Metadata } from "next"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { getSessionFromCookies } from "@/lib/server-auth"
import { InvoiceView } from "@/components/invoice/invoice-view"
import { buildInvoiceViewModel, invoiceInclude } from "@/lib/invoices/invoice-view-model"
import { SiteShell } from "@/components/layout/site-shell"
import { createPanelLog } from "@/lib/panel-log"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { verifyInvoiceShareToken } from "@/lib/invoices/share-token"

type Props = {
  params: Promise<{ invoiceNumber: string }>
  searchParams?: Promise<{ token?: string }>
}

export async function generateMetadata(_: Props): Promise<Metadata> {
  return buildPageMetadata({
    title: "Invoice",
    description: "View your invoice.",
    path: "/invoice",
    robots: "noindex, nofollow",
  })
}

export default async function InvoicePage({ params, searchParams }: Props) {
  const session = await getSessionFromCookies()

  const { invoiceNumber } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { invoiceNumber },
    include: invoiceInclude,
  })

  if (!invoice) {
    notFound()
  }

  const token = (await searchParams)?.token
  const tokenAccess = verifyInvoiceShareToken(invoice, token)
  if (!session && !tokenAccess) {
    redirect(`/login?returnTo=${encodeURIComponent(`/invoice/${invoiceNumber}`)}`)
  }

  if (session?.role === "client" && invoice.customerId !== session.id) {
    notFound()
  }

  await createPanelLog({
    category: "Payment",
    message: "invoice_viewed",
    actorType: !session ? "customer" : session.role === "client" ? "customer" : "admin",
    actorId: session?.role === "client" ? session.id : null,
    actorEmail: String(session?.email || ""),
    customerId: invoice.customerId,
    orderId: invoice.orderId || null,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, source: "public_invoice_page" },
  }).catch(() => null)
  const viewModel = await buildInvoiceViewModel(invoice)

  return (
    <SiteShell>
      <InvoiceView
        invoice={viewModel}
        downloadUrl={session?.role === "client" ? `/api/client/invoices/${invoice.id}/download` : session?.role ? `/api/admin/invoices/${invoice.id}/download` : "#"}
        payUrl={session?.role === "client" ? `/api/client/invoices/${invoice.id}/pay` : null}
        printLogUrl={session?.role === "client" ? `/api/client/invoices/${invoice.id}/print` : null}
        showActions={Boolean(session)}
      />
    </SiteShell>
  )
}
