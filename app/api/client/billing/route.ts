import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getClientFromCookies } from "@/lib/server-auth"

function money(value: unknown) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

export async function GET() {
  const client = await getClientFromCookies()
  if (!client?.sub || !client.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const customerId = String(client.sub)

  const [invoices, payments, orders] = await Promise.all([
    prisma.invoice.findMany({ where: { customerId, deletedAt: null, type: { not: "wallet_topup" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.payment.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.order.findMany({ where: { customerId, deletedAt: null, status: { not: "DELETED" } }, orderBy: { createdAt: "desc" }, take: 50, include: { invoices: { select: { id: true, invoiceNumber: true, deletedAt: true } } } }),
  ])

  return NextResponse.json({
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      subtotal: money(invoice.subtotal),
      taxAmount: money(invoice.taxAmount),
      gstPercent: money((invoice as any).gstPercent ?? invoice.taxRate),
      gstAmount: money((invoice as any).gstAmount ?? invoice.taxAmount),
      taxLabel: String((invoice as any).taxLabel || "GST"),
      discountAmount: money(invoice.discountAmount),
      totalAmount: money(invoice.totalAmount),
      currency: invoice.currency || "INR",
      createdAt: invoice.createdAt,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      paidAt: invoice.paidAt,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      orderId: payment.orderId,
      status: payment.status,
      purpose: payment.purpose,
      amount: money(payment.amount),
      gatewayAmount: money(payment.gatewayAmount),
      walletAppliedAmount: money(payment.walletAppliedAmount),
      currency: payment.currency || "INR",
      paymentMethod: payment.paymentMethod,
      gateway: payment.gateway,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayPaymentId: payment.gatewayPaymentId,
      transactionId: payment.transactionId,
      gatewayTransactionId: payment.gatewayTransactionId,
      createdAt: payment.createdAt,
      completedAt: payment.completedAt,
    })),
    orders: orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      provisioningStatus: order.provisioningStatus,
      totalAmount: money(order.totalAmount),
      payableAmount: money(order.payableAmount ?? order.finalAmount ?? order.totalAmount),
      currency: order.currency || "INR",
      createdAt: order.createdAt,
      invoices: order.invoices && !order.invoices.deletedAt ? [{ id: order.invoices.id, invoiceNumber: order.invoices.invoiceNumber }] : [],
    })),
  })
}
