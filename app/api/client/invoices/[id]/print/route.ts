import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { createPanelLog } from "@/lib/panel-log"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const client = await getClientFromRequest(request)
  if (!client?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const invoice = await prisma.invoice.findFirst({
    where: { id, customerId: String(client.sub), deletedAt: null },
    select: { id: true, invoiceNumber: true, orderId: true, customerId: true },
  })
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  await createPanelLog({
    category: "Payment",
    message: "invoice_print_clicked",
    actorType: "customer",
    actorId: String(client.sub),
    actorEmail: String(client.email || ""),
    customerId: invoice.customerId,
    orderId: invoice.orderId || null,
    metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
  }).catch(() => null)

  return NextResponse.json({ ok: true })
}
