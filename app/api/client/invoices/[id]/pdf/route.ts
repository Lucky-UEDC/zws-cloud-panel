import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { renderInvoicePdf } from "@/lib/invoices"
import { createPanelLog } from "@/lib/panel-log"

export const runtime = "nodejs"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const client = await getClientFromRequest(request)
  if (!client?.sub) {
    return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(`/client-area/invoices/${id}`)}`, request.url))
  }

  const allowed = await prisma.invoice.findFirst({ where: { id, customerId: String(client.sub), deletedAt: null }, select: { id: true } })
  if (!allowed) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  const { invoice, buffer } = await renderInvoicePdf(id)
  await createPanelLog({
    category: "Payment",
    message: "invoice_pdf_downloaded",
    actorType: "customer",
    actorId: String(client.sub),
    actorEmail: String(client.email || ""),
    customerId: String(client.sub),
    orderId: invoice.orderId || null,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, source: "client_invoice_pdf" },
  }).catch(() => null)

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  })
}
