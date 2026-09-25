import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { importExistingVm } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { calculateTax } from "@/lib/pricing"
import { createInvoiceForOrder } from "@/lib/invoices"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ZWS-${timestamp}-${random}`
}

function termPrice(product: any, termMonths: number) {
  const key = `price${termMonths}m`
  return Number(product?.[key] ?? product?.price1m ?? 0)
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    let orderId = String(body.orderId || "").trim()
    const customerId = String(body.customerId || "").trim()
    const termMonths = Math.max(1, Number(body.termMonths || body.billingCycle || 1) || 1)

    if (!orderId) {
      const productId = String(body.productId || "").trim()
      if (!customerId || !productId) {
        return NextResponse.json({ success: false, error: "customerId and productId are required when orderId is not provided" }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      const [customer, product] = await Promise.all([
        prisma.customer.findUnique({ where: { id: customerId } }),
        prisma.product.findUnique({ where: { id: productId } }),
      ])
      if (!customer) return NextResponse.json({ success: false, error: "Customer not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      if (!product) return NextResponse.json({ success: false, error: "Product not found" }, { status: 404, headers: NO_CACHE_HEADERS })
      const unitPrice = termPrice(product, termMonths)
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return NextResponse.json({ success: false, error: "Product price is invalid" }, { status: 400, headers: NO_CACHE_HEADERS })
      }
      const taxAmount = calculateTax(unitPrice)
      const totalAmount = Number((unitPrice + taxAmount).toFixed(2))
      const order = await prisma.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          customerId,
          productId,
          termMonths,
          unitPrice,
          quantity: 1,
          subtotal: unitPrice,
          taxAmount,
          discountAmount: 0,
          totalAmount,
          originalAmount: totalAmount,
          finalAmount: totalAmount,
          payableAmount: totalAmount,
          currency: "INR",
          status: "paid",
          provisioningStatus: "LINKING_EXISTING_VM",
          notes: body.reason ? String(body.reason) : "Bulk imported existing VM",
          metadata: {
            createdByAdmin: admin.email,
            provisionMode: "linked",
            importExistingVm: true,
            productName: product.name,
          },
        },
      })
      orderId = order.id
      const invoice = await createInvoiceForOrder(order.id)
      const payment = await prisma.payment.create({
        data: {
          orderId: order.id,
          invoiceId: invoice.id,
          customerId,
          gateway: "manual",
          amount: totalAmount,
          currency: "INR",
          status: "completed",
          purpose: "admin_import_existing_vm",
          completedAt: new Date(),
          gatewayTransactionId: `manual-import:${order.orderNumber}`,
          transactionId: `manual-import:${order.orderNumber}`,
          errorMessage: "Marked paid by admin during existing VM import",
        },
      })
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paidAt: new Date(),
          manualProcessedBy: String(admin.email),
          manualProcessedAt: new Date(),
          manualReason: "Existing VM import",
          paymentTransactionId: payment.transactionId || payment.gatewayTransactionId || payment.id,
        },
      }).catch(() => null)
    }

    const result = await importExistingVm({
      nodeId: String(body.nodeId || ""),
      vmid: Number(body.vmid),
      orderId,
      customerId,
      actorEmail: String(admin.email),
      reason: body.reason ? String(body.reason) : null,
      originalSignupDate: body.originalSignupDate || null,
      existingExpiryDate: body.existingExpiryDate || null,
      customRenewalDate: body.customRenewalDate || null,
      prepaidRemainingDays: body.prepaidRemainingDays ?? null,
      activatedAt: body.activatedAt || null,
      allowDefaultMonthly: body.allowDefaultMonthly === true,
      autoSuspendEnabled: body.autoSuspendEnabled !== false,
      autoDeleteEnabled: body.autoDeleteEnabled !== false,
      pauseReminders: body.pauseReminders === true,
      preservePaidStatus: body.preservePaidStatus !== false,
      preservedInvoiceNumber: body.preservedInvoiceNumber || body.invoiceNumber || null,
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-IMPORT")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Import failed"), supportCode }, { status: 400 })
  }
}
