import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

export async function GET() {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const services = await prisma.dedicatedService.findMany({
    where: { customerId, order: { deletedAt: null } },
    include: {
      product: { select: { name: true, cpuCores: true, ramGb: true, storageGb: true, storageType: true, bandwidthTb: true } },
      dedicatedOsOption: true,
      order: { include: { invoices: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({
    success: true,
    services: services.map((service) => ({
      id: service.id,
      serviceNumber: service.serviceNumber,
      orderNumber: service.order.orderNumber,
      productName: service.product?.name || "Dedicated Server",
      status: service.status,
      selectedOs: service.selectedOsName || service.dedicatedOsOption?.name || service.order.osName,
      billingTerm: service.order.termMonths,
      renewalDate: service.nextRenewalAt,
      renewalAmount: service.renewalAmount ? money(service.renewalAmount) : money(service.order.unitPrice),
      invoice: service.order.invoices ? {
        id: service.order.invoices.id,
        invoiceNumber: service.order.invoices.invoiceNumber,
        status: service.order.invoices.status,
        totalAmount: money(service.order.invoices.totalAmount),
      } : null,
      estimatedDeliveryAt: service.estimatedDeliveryAt,
      paymentConfirmedAt: service.paymentConfirmedAt,
      deliveredAt: service.deliveredAt,
      primaryIp: service.status === "delivered" ? service.primaryIp : null,
      resources: {
        cpuCores: service.product?.cpuCores || null,
        ramGb: service.product?.ramGb || null,
        storageGb: service.product?.storageGb || null,
        storageType: service.product?.storageType || null,
        bandwidthTb: service.product ? Number(service.product.bandwidthTb || 0) : null,
      },
    })),
  })
}
