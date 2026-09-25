import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"
import { decryptDedicatedPassword } from "@/lib/dedicated"

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function timeline(status: string) {
  const order = ["payment", "hardware", "os", "network", "delivery"]
  const active = status === "installing" ? 2 : status === "delivered" ? 5 : status === "paid_waiting_installation" ? 1 : 0
  const labels: Record<string, string> = {
    payment: "Payment confirmed",
    hardware: "Hardware allocation pending",
    os: "OS installation",
    network: "Network/IP assignment",
    delivery: "Delivery",
  }
  return order.map((key, index) => ({
    key,
    label: labels[key],
    status: index < active ? "completed" : index === active ? "active" : "pending",
  }))
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const service = await prisma.dedicatedService.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, order: { deletedAt: null } },
    include: {
      product: true,
      dedicatedOsOption: true,
      order: { include: { invoices: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } } },
    },
  })
  if (!service) return NextResponse.json({ success: false, error: "Dedicated service not found" }, { status: 404 })
  const delivered = service.status === "delivered" || Boolean(service.deliveredAt)
  return NextResponse.json({
    success: true,
    service: {
      id: service.id,
      serviceNumber: service.serviceNumber,
      hostname: service.hostname,
      orderNumber: service.order.orderNumber,
      productName: service.product?.name || "Dedicated Server",
      status: service.status,
      selectedOs: service.selectedOsName || service.dedicatedOsOption?.name || service.order.osName,
      billingTerm: service.order.termMonths,
      renewalDate: service.nextRenewalAt,
      renewalAmount: service.renewalAmount ? money(service.renewalAmount) : money(service.order.unitPrice),
      paymentConfirmedAt: service.paymentConfirmedAt,
      estimatedDeliveryAt: service.estimatedDeliveryAt,
      deliveredAt: service.deliveredAt,
      installationNotes: service.installationNotes,
      ipmiRequired: service.ipmiRequired,
      invoice: service.order.invoices ? {
        id: service.order.invoices.id,
        invoiceNumber: service.order.invoices.invoiceNumber,
        status: service.order.invoices.status,
        totalAmount: money(service.order.invoices.totalAmount),
      } : null,
      paymentStatus: service.order.payments[0]?.status || service.order.status,
      timeline: timeline(service.status),
      resources: {
        cpuCores: service.product?.cpuCores || null,
        ramGb: service.product?.ramGb || null,
        storageGb: service.product?.storageGb || null,
        storageType: service.product?.storageType || null,
        bandwidthTb: service.product ? Number(service.product.bandwidthTb || 0) : null,
      },
      credentials: delivered ? {
        primaryIp: service.primaryIp,
        username: service.username,
        password: decryptDedicatedPassword(service.passwordEncrypted),
        panelUrl: service.panelUrl,
        installedOs: service.installedOs,
        notes: service.deliveryNotes,
      } : null,
    },
  })
}
