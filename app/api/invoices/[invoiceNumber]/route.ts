import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceNumber: string }> },
) {
  try {
    const [admin, client] = await Promise.all([
      getAdminFromRequest(request),
      getClientFromRequest(request),
    ])

    if (!admin?.email && !client?.sub) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { invoiceNumber } = await params

    const invoice = await prisma.invoice.findUnique({
      where: { invoiceNumber },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            company: true,
            address: true,
          },
        },
        order: {
          include: {
            product: true,
            customConfig: true,
            operatingSystem: true,
            payments: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    })

    if (!invoice || invoice.deletedAt) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    if (!admin?.email && client?.sub && invoice.customerId !== String(client.sub)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    return NextResponse.json(invoice)
  } catch (error) {
    console.error("Invoice API error:", error)
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 })
  }
}
