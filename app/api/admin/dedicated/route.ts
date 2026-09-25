import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { decryptDedicatedPassword } from "@/lib/dedicated"
import { canAccessAdminApi } from "@/lib/admin-rbac"

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const services = await prisma.dedicatedService.findMany({
    include: {
      customer: { select: { id: true, email: true, name: true } },
      product: { select: { id: true, name: true } },
      dedicatedOsOption: true,
      order: { include: { invoices: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({
    success: true,
    services: services.map((service) => ({
      id: service.id,
      serviceNumber: service.serviceNumber,
      orderId: service.orderId,
      orderNumber: service.order.orderNumber,
      customer: service.customer,
      product: service.product,
      status: service.status,
      selectedOs: service.selectedOsName || service.dedicatedOsOption?.name || service.order.osName,
      hostname: service.hostname,
      paymentConfirmedAt: service.paymentConfirmedAt,
      estimatedDeliveryAt: service.estimatedDeliveryAt,
      deliveredAt: service.deliveredAt,
      primaryIp: service.primaryIp,
      username: service.username,
      hasPassword: Boolean(decryptDedicatedPassword(service.passwordEncrypted)),
      panelUrl: service.panelUrl,
      installedOs: service.installedOs,
      invoice: service.order.invoices ? {
        id: service.order.invoices.id,
        invoiceNumber: service.order.invoices.invoiceNumber,
        status: service.order.invoices.status,
        totalAmount: money(service.order.invoices.totalAmount),
      } : null,
      paymentStatus: service.order.payments[0]?.status || service.order.status,
      createdAt: service.createdAt,
    })),
  })
}
