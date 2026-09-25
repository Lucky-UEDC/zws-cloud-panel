import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"

export async function GET() {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const deployments = await prisma.vpsInstance.findMany({
      where: { customerId: String(client.sub), deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
      include: { product: true, order: true },
      orderBy: { createdAt: "desc" },
    })

    const products = deployments.map((service) => ({
      id: service.id,
      name: service.name || service.product?.name || "VPS",
      status: service.status,
      plan: service.product?.name || "Custom Plan",
      orderId: service.orderId,
      orderStatus: service.order.status,
    }))

    return NextResponse.json({ products })
  } catch (error) {
    console.error("[CLIENT_PRODUCTS_GET]", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
