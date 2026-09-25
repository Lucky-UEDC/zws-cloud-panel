import { NextRequest, NextResponse } from "next/server"
import { extractClientIp } from "@/lib/request-context"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sendOrderInvoiceNotification } from "@/lib/notifications/service"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { deleteInvoicesSafely } from "@/lib/invoice-deletion"
import { canAccessAdminApi, isAdminLikeRole } from "@/lib/admin-rbac"

function csvValue(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  const action = String(body.action || "")
  const reason = String(body.reason || "").trim()
  if (!ids.length) return NextResponse.json({ error: "Select at least one invoice" }, { status: 400 })
  if (action === "mark_paid") {
    return NextResponse.json({ success: false, code: "manual_payment_bulk_disabled", error: "Manual payments require a unique transaction reference and second-admin approval for each invoice." }, { status: 409 })
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: {
      customer: true,
      order: true,
      payments: { orderBy: { createdAt: "desc" }, include: { paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  })
  if (action === "export") {
    const csv = [
      ["Invoice", "Customer", "Amount", "Status", "Created"].map(csvValue).join(","),
      ...invoices.map((invoice) => [
        invoice.invoiceNumber,
        invoice.customer?.email || invoice.customerId,
        Number(invoice.totalAmount),
        invoice.status,
        invoice.createdAt.toISOString(),
      ].map(csvValue).join(",")),
    ].join("\n")
    return NextResponse.json({ success: true, csv, count: invoices.length })
  }

  if (action === "delete_unpaid_failed_cancelled" || action === "delete_selected_pending_cancelled") {
    if (!isAdminLikeRole(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const adminRow = await prisma.adminProfile.findUnique({
      where: { email: String(admin.email).toLowerCase() },
      select: { id: true },
    }).catch(() => null)

    const result = await deleteInvoicesSafely(ids, { actorEmail: admin.email, reason })
    const deleted = result.deleted
    const deletedIds = result.deletedIds
    const deletedSet = new Set(deletedIds)
    const deletedInvoices = result.invoices.filter((invoice) => deletedSet.has(invoice.id))

    await Promise.all(deletedInvoices.map((invoice) => createAuditLog({
      adminId: adminRow?.id || null,
      actorEmail: admin.email,
      customerId: invoice.customerId,
      targetType: "invoice",
      targetId: invoice.id,
      action: "INVOICE_DELETED",
      oldValue: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, status: invoice.status, amount: Number(invoice.totalAmount || 0) },
      newValue: { permanentlyDeletedAt: new Date().toISOString(), deletedBy: admin.email, deleteReason: reason || null },
      metadata: {
        source: "bulk",
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        amount: Number(invoice.totalAmount || 0),
        reason: reason || null,
      },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    }).catch(() => null)))

    await createAuditLog({
      adminId: adminRow?.id || null,
      actorEmail: admin.email,
      action: "INVOICE_BULK_DELETE",
      targetType: "invoice",
      metadata: { selected: ids.length, deleted, skipped: result.skipped, deletedIds, reason: reason || null },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent"),
    }).catch(() => null)
    await createPanelLog({
      category: "Admin Action",
      message: "invoice_bulk_deleted",
      actorType: "admin",
      actorEmail: admin.email,
      metadata: { selected: ids.length, deleted, skipped: result.skipped, reason: reason || null },
    }).catch(() => null)

    return NextResponse.json({
      success: true,
      code: "bulk_delete_completed",
      deleted,
      updated: deleted,
      skipped: ids.length - deleted,
      deletedIds,
      result: { deletedIds, skipped: result.skipped },
    })
  }

  let updated = 0
  let finalized = 0
  let reused = 0
  let skipped = 0
  let errored = 0
  const results: Array<Record<string, unknown>> = []
  for (const invoice of invoices) {
    const status = String(invoice.status || "").toLowerCase()
    if (action === "cancel_delete_pending" || action === "cancel_selected_pending") {
      if (status === "paid") continue
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "cancelled",
          metadata: { ...((invoice.metadata as any) || {}), deletedByBulkAction: true, bulkActionBy: admin.email, reason: reason || null },
        },
      })
      updated += 1
    } else if (action === "resend") {
      await sendOrderInvoiceNotification({
        templateKey: status === "paid" ? "invoice_paid" : "invoice_created",
        orderId: invoice.orderId,
        invoiceId: invoice.id,
        paymentUrl: `/client-area/billing/invoices/${invoice.id}`,
        metadata: { source: "admin_invoice_bulk_resend", adminEmail: admin.email },
      }).catch(() => undefined)
      updated += 1
    } else {
      return NextResponse.json({ error: "Unsupported bulk invoice action" }, { status: 400 })
    }
  }

  return NextResponse.json({
    success: action === "mark_paid" ? errored === 0 : true,
    updated,
    skipped: action === "mark_paid" ? skipped : invoices.length - updated,
    finalized,
    reused,
    errored,
    results: action === "mark_paid" ? results : undefined,
  }, action === "mark_paid" && errored > 0 ? { status: 207 } : undefined)
}
