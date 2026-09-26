import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { requestManualPayment } from "@/lib/payments/manual-payments"
import { deleteInvoiceSafely } from "@/lib/invoice-deletion"
import { reconcileGatewayPayment } from "@/lib/payment-reconciliation"
import { canAccessAdminApi, isAdminLikeRole } from "@/lib/admin-rbac"
import { invoiceTaxWriteFields, money } from "@/lib/invoices/tax"

async function adminProfileId(email: string) {
  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(email).toLowerCase() },
    select: { id: true },
  })
  return adminRow?.id || null
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: true,
      order: {
        include: {
          product: true,
          offer: true,
          customConfig: true,
          vpsInstance: { select: { id: true, vmid: true, name: true, status: true, ipAddress: true } },
          dedicatedService: { select: { id: true, serviceNumber: true, status: true, primaryIp: true } },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, take: 5 },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 5 },
      gatewayAttempts: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  })
  if (!invoice || invoice.deletedAt) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  return NextResponse.json({
    success: true,
    invoice: {
      ...invoice,
      subtotal: Number(invoice.subtotal || 0),
      taxRate: Number(invoice.taxRate || 0),
      taxAmount: Number(invoice.taxAmount || 0),
      gstPercent: Number(invoice.gstPercent || 0),
      gstAmount: Number(invoice.gstAmount || 0),
      discountAmount: Number(invoice.discountAmount || 0),
      totalAmount: Number(invoice.totalAmount || 0),
    },
  })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adminRow = await prisma.adminProfile.findUnique({
    where: { email: String(admin.email).toLowerCase() },
    select: { id: true }
  })
  if (!adminRow) return NextResponse.json({ error: "Admin not found" }, { status: 404 })

  const { id } = await params
  const body = (await request.json()) as any
  const existing = await prisma.invoice.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  if (existing.deletedAt) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  const {
    status,
    dueDate,
    issueDate,
    lineItems,
    discount,
    taxRate: bodyTaxRate,
    metadata,
    notes,
    sendToCustomer,
    invoiceNumber,
    currency,
    paidAt,
  } = body

  // Recalculate totals based on line items
  let subtotal = 0
  let taxTotal = 0
  if (Array.isArray(lineItems)) {
    lineItems.forEach((item: any) => {
      const qty = Number(item.quantity || 0)
      const unitPrice = Number(item.unitPrice || 0)
      const taxPercent = Number(item.taxPercent || bodyTaxRate || 18)

      const lineSubtotal = qty * unitPrice
      subtotal += lineSubtotal
      taxTotal += lineSubtotal * (taxPercent / 100)
    })
  }

  const taxRate = subtotal > 0 ? money((taxTotal / subtotal) * 100) : money(bodyTaxRate ?? existing.taxRate)
  const finalTotal = money(subtotal + taxTotal - (Number(discount) || 0))
  const existingMetadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : {}
  const incomingMetadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}

  // Invoice number is editable but must stay globally unique.
  const nextInvoiceNumber = typeof invoiceNumber === "string" && invoiceNumber.trim() ? invoiceNumber.trim() : existing.invoiceNumber
  if (nextInvoiceNumber !== existing.invoiceNumber) {
    const clash = await prisma.invoice.findFirst({ where: { invoiceNumber: nextInvoiceNumber, id: { not: id } }, select: { id: true } })
    if (clash) return NextResponse.json({ error: `Invoice number "${nextInvoiceNumber}" is already in use.` }, { status: 409 })
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      status: status || existing.status,
      dueDate: dueDate ? new Date(dueDate) : existing.dueDate,
      issueDate: issueDate ? new Date(issueDate) : existing.issueDate,
      lineItems: lineItems ? lineItems : existing.lineItems,
      subtotal: money(subtotal),
      ...invoiceTaxWriteFields({ taxRate, taxAmount: taxTotal }),
      discountAmount: Number(discount) || 0,
      totalAmount: finalTotal,
      notes: notes || existing.notes,
      invoiceNumber: nextInvoiceNumber,
      currency: typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : existing.currency,
      paidAt: paidAt === undefined ? existing.paidAt : (paidAt ? new Date(paidAt) : null),
      metadata: { ...existingMetadata, ...incomingMetadata } as any,
      updatedAt: new Date(),
    },
  })

  await createAuditLog({
    adminId: adminRow.id,
    customerId: updated.customerId,
    action: "INVOICE_UPDATED",
    oldValue: JSON.stringify({ status: existing.status, total: existing.totalAmount }),
    newValue: JSON.stringify({ status: updated.status, total: updated.totalAmount }),
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  if (sendToCustomer) {
    sendOrderInvoiceNotification({
      templateKey: updated.status === "paid" ? "invoice_paid" : "invoice_created",
      orderId: updated.orderId,
      invoiceId: updated.id,
      paymentUrl: `/client-area/billing/invoices/${updated.id}`,
      metadata: { source: "admin_invoice_update", adminEmail: admin.email },
    }).catch(() => undefined)
  }

  return NextResponse.json({ success: true, invoice: updated })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = String(body.action || "").trim()
  const reason = String(body.reason || "").trim()
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      order: true,
      payments: { orderBy: { createdAt: "desc" }, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" } },
    },
  })
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  if (invoice.deletedAt) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })

  let updated: any = invoice
  let actionResult: Record<string, unknown> | null = null
  if (action === "mark_paid") {
    try {
      const manualRequest = await requestManualPayment({ invoiceId: invoice.id, transactionReference: String(body.transactionReference || ""), method: String(body.method || ""), amount: Number(body.amount), currency: String(body.currency || invoice.currency), paidAt: new Date(body.paidAt || Date.now()), evidence: String(body.evidence || reason || ""), requestedBy: String(admin.email) })
      actionResult = { message: "pending second-admin approval", manualPaymentRequestId: manualRequest.id, status: manualRequest.status }
      return NextResponse.json({ success: true, code: "manual_payment_pending_approval", invoice: updated, result: actionResult }, { status: 202 })
    } catch (error: any) {
      return NextResponse.json({ success: false, code: error?.code || "manual_payment_request_failed", error: error?.message || "Manual payment request failed." }, { status: 409 })
    }
  } else if (action === "cancel") {
    if (invoice.status === "paid") return NextResponse.json({ error: "Paid invoices cannot be cancelled" }, { status: 409 })
    updated = await prisma.invoice.update({
      where: { id },
      data: { status: "cancelled", metadata: { ...((invoice.metadata as any) || {}), cancelReason: reason || null, cancelledBy: admin.email } },
      include: { order: true, payments: true },
    })
  } else if (action === "convert_proforma") {
    updated = await prisma.invoice.update({
      where: { id },
      data: { metadata: { ...((invoice.metadata as any) || {}), invoiceType: "tax_invoice", convertedFrom: "proforma", convertedBy: admin.email } },
      include: { order: true, payments: true },
    })
  } else if (action === "resend") {
    updated = await prisma.invoice.update({
      where: { id },
      data: { metadata: { ...((invoice.metadata as any) || {}), resentAt: new Date().toISOString(), resentBy: admin.email } },
      include: { order: true, payments: true },
    })
    sendOrderInvoiceNotification({
      templateKey: updated.status === "paid" ? "invoice_paid" : "invoice_created",
      orderId: updated.orderId,
      invoiceId: updated.id,
      paymentUrl: `/client-area/billing/invoices/${updated.id}`,
      metadata: { source: "admin_invoice_resend", adminEmail: admin.email },
    }).catch(() => undefined)
  } else if (action === "verify_gateway") {
    const beforeHadOrder = Boolean(invoice.orderId)
    const latestPayment = invoice.payments[0] || null
    const latestAttempt = invoice.paymentAttempts[0] || latestPayment?.paymentAttempts?.[0] || null
    const reference = String(
      latestAttempt?.merchantOrderId ||
      latestAttempt?.gatewayOrderId ||
      latestPayment?.gatewayOrderId ||
      latestPayment?.idempotencyKey ||
      invoice.invoiceNumber ||
      "",
    ).trim()
    if (!reference) return NextResponse.json({ error: "No gateway reference found for this invoice" }, { status: 400 })
    const verified = await reconcileGatewayPayment(reference, `admin:${admin.email}`)
    const refreshed = await prisma.invoice.findUnique({
      where: { id },
      include: {
        order: { include: { provisioningJobs: { orderBy: { createdAt: "desc" }, take: 1 }, vpsInstance: true, dedicatedService: true } },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    })
    if (!refreshed) return NextResponse.json({ error: "Invoice not found after verification" }, { status: 404 })
    updated = refreshed as any
    const paid = String(refreshed.status || "").toLowerCase() === "paid"
    const hasOrder = Boolean(refreshed.orderId)
    const latestAttemptStatus = String(refreshed.paymentAttempts[0]?.status || "").toLowerCase()
    const message = verified.status === "amount_or_currency_mismatch" || latestAttemptStatus === "amount_or_currency_mismatch"
      ? "amount mismatch"
      : verified.failed
        ? "failed"
        : paid && hasOrder
          ? beforeHadOrder
            ? "paid and order already existed"
            : "paid and order created"
          : verified.reconciled
            ? "unpaid"
            : "gateway lookup failed"
    actionResult = {
      message,
      paid,
      orderId: refreshed.orderId || null,
      invoiceId: refreshed.id,
      serviceId: refreshed.order?.vpsInstance?.id || refreshed.order?.dedicatedService?.id || null,
      provisioningJobId: refreshed.order?.provisioningJobs?.[0]?.id || null,
      gatewayStatus: verified.status,
      gatewayOrderIdUsed: verified.gatewayOrderIdUsed || null,
      attemptedReferences: verified.attemptedReferences || [],
      gatewayHttpStatus: verified.gatewayHttpStatus ?? null,
      lastGatewayError: verified.lastGatewayError || null,
      rawGatewaySummary: verified.rawGatewaySummary || null,
    }
  } else {
    return NextResponse.json({ error: "Unsupported invoice action" }, { status: 400 })
  }

  await createPanelLog({
    category: "Admin Action",
    message: `invoice_${action}`,
    actorType: "admin",
    actorEmail: admin.email,
    customerId: invoice.customerId,
    orderId: updated?.orderId || invoice.orderId,
    metadata: { invoiceId: id, reason: reason || null, result: actionResult },
  })

  return NextResponse.json({ success: true, invoice: updated, result: actionResult })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const reason = String(body?.reason || "").trim()
  const force = body?.force === true || body?.force === "true"
  // Force delete is an irreversible admin override — it can remove PAID invoices and their payment
  // records (never the VM). Require an explicit typed confirmation so it can't happen by accident.
  if (force && String(body?.confirm || "").trim().toUpperCase() !== "DELETE") {
    return NextResponse.json({ success: false, code: "confirmation_required", error: 'Type "DELETE" to force-delete this invoice.' }, { status: 400 })
  }
  const result = await deleteInvoiceSafely(id, { actorEmail: admin.email, reason, force })
  if (!result.invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  if (!result.deleted) {
    return NextResponse.json({
      success: false,
      code: result.safety.reason || "invoice_delete_blocked",
      error: result.safety.reason === "active_service"
        ? "Delete the linked order/service to remove this paid service invoice."
        : result.safety.reason === "active_order"
        ? "This paid invoice is linked to an active order. Void or cancel the order first."
        : result.safety.reason === "successful_payment"
        ? "Paid invoices cannot be permanently deleted. Use Void/Adjustment for corrections."
        : result.safety.reason === "paid_invoice"
        ? "Paid invoices cannot be permanently deleted. Use Void/Adjustment for corrections."
        : result.safety.reason === "unsafe_status"
        ? "This invoice cannot be deleted in its current state."
        : "Invoice cannot be deleted safely.",
      result: { invoiceId: id, safety: result.safety },
    }, { status: 409 })
  }

  const adminId = await adminProfileId(admin.email)
  await createAuditLog({
    adminId,
    actorEmail: admin.email,
    customerId: result.invoice.customerId,
    targetType: "invoice",
    targetId: result.invoice.id,
    action: "INVOICE_DELETED",
    oldValue: JSON.stringify({ id: result.invoice.id, invoiceNumber: result.invoice.invoiceNumber, status: result.invoice.status, amount: Number(result.invoice.totalAmount || 0) }),
    newValue: JSON.stringify({ permanentlyDeletedAt: new Date().toISOString(), deletedBy: admin.email, deleteReason: reason || null, forced: result.forced }),
    metadata: {
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      amount: Number(result.invoice.totalAmount || 0),
      reason: reason || null,
      forced: result.forced,
      actorEmail: admin.email,
    },
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  }).catch(() => null)
  await createPanelLog({
    category: "Admin Action",
    message: "invoice_deleted",
    actorType: "admin",
    actorEmail: admin.email,
    customerId: result.invoice.customerId,
    orderId: result.invoice.orderId,
    metadata: {
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      status: result.invoice.status,
      amount: Number(result.invoice.totalAmount || 0),
      reason: reason || null,
    },
  }).catch(() => null)

  return NextResponse.json({ success: true, code: "deleted", deleted: true, invoiceId: id, result: { invoiceId: id } })
}
