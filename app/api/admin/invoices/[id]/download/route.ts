import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { renderInvoicePdf } from "@/lib/invoices"
import { createPanelLog } from "@/lib/panel-log"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const { invoice, buffer } = await renderInvoicePdf(id)
  await createPanelLog({
    category: "Payment",
    message: "invoice_pdf_downloaded",
    actorType: "admin",
    actorId: null,
    actorEmail: String(admin.email || ""),
    customerId: invoice.customer.id,
    orderId: invoice.orderId || null,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, source: "admin_invoice_download" },
  }).catch(() => null)
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`,
    },
  })
}
