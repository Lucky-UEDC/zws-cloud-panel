import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromRequest } from "@/lib/server-auth"
import { serializeInvoice } from "@/lib/invoices"

export async function GET(
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
    include: {
      customer: true,
      order: {
        include: {
          product: true,
          customConfig: true,
          operatingSystem: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
          paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, take: 1, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  }

  return NextResponse.json({ invoice: serializeInvoice(invoice) })
}
