import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { enqueueProvisioningJob, enqueueUpgradeJob } from "@/lib/provision"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { assertPaymentVerifiedForProvisioning } from "@/lib/payment-state"
import { deleteOrderAndCleanupService } from "@/lib/vps-lifecycle"

function csvValue(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function isUpgradeOrder(order: any) {
  const orderType = String(order?.orderType || "").toLowerCase()
  const metadata = record(order?.metadata)
  return ["vps_upgrade", "instance_upgrade", "disk_resize", "disk_migrate", "disk_add"].includes(orderType) ||
    String(metadata.kind || "").toLowerCase() === "upgrade" ||
    String(metadata.kind || "").toLowerCase() === "disk_upgrade" ||
    Boolean(metadata.upgrade?.vpsInstanceId)
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : []
  const action = String(body.action || "")
  const confirmationText = String(body.confirmationText || "").trim()
  if (!ids.length) return NextResponse.json({ error: "Select at least one order" }, { status: 400 })

  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    include: { customer: true, product: true, offer: true, vpsInstance: true },
  })

  if (action === "export") {
    const csv = [
      ["Order", "Customer", "Product", "Amount", "Status", "Provisioning", "Created"].map(csvValue).join(","),
      ...orders.map((order) => [
        order.orderNumber,
        order.customer?.email || order.customerId,
        order.offer?.name || order.product?.name || "Custom instance",
        Number(order.payableAmount || order.totalAmount),
        order.status,
        order.provisioningStatus,
        order.createdAt.toISOString(),
      ].map(csvValue).join(",")),
    ].join("\n")
    return NextResponse.json({ success: true, csv, count: orders.length })
  }

  if ((action === "delete_selected_orders" || action === "delete_selected_unpaid_orders") && orders.some((order) => ["paid", "active", "completed", "verification_pending"].includes(String(order.status || "").toLowerCase())) && confirmationText !== "DELETE ORDERS") {
    return NextResponse.json({
      error: "Paid or completed orders require typed confirmation.",
      code: "PAID_ORDER_CONFIRMATION_REQUIRED",
      requiredConfirmation: "DELETE ORDERS",
    }, { status: 409 })
  }

  let updated = 0
  for (const order of orders) {
    const status = String(order.status || "").toLowerCase()
    const provisioningStatus = String(order.provisioningStatus || "").toUpperCase()
    if (action === "cancel_pending") {
      if (!["pending", "pending_payment", "draft", "payment_failed"].includes(status)) continue
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "cancelled",
          provisioningStatus: "CANCELLED",
          metadata: { ...((order.metadata as any) || {}), cancelledByBulkAction: true, cancelledBy: admin.email },
        },
      })
      updated += 1
    } else if (action === "delete_selected_orders" || action === "delete_selected_unpaid_orders") {
      const paidRecord = ["paid", "active", "completed", "verification_pending"].includes(status)
      if (paidRecord && confirmationText !== "DELETE ORDERS") continue
      if (!paidRecord && !["cancelled", "deleted", "payment_failed", "pending", "pending_payment", "draft", "failed"].includes(status) && provisioningStatus !== "CANCELLED") continue
      await deleteOrderAndCleanupService(order.id, { actorEmail: String(admin.email), adminId: (admin as any).sub || null })
      updated += 1
    } else if (action === "retry_provisioning") {
      if (status !== "paid" || !["FAILED", "PROVISIONING_FAILED", "START_FAILED", "UPGRADE_FAILED", "WAITING_FOR_ADMIN"].includes(provisioningStatus)) continue
      const upgradeOrder = isUpgradeOrder(order)
      const gate = await assertPaymentVerifiedForProvisioning(order.id).catch(() => null)
      if (!gate) continue
      await prisma.order.update({ where: { id: order.id }, data: { provisioningStatus: upgradeOrder ? "UPGRADE_QUEUED" : "QUEUED", provisioningError: null } })
      if (upgradeOrder) {
        await enqueueUpgradeJob(order.id, `admin:${admin.email}:bulk_retry`, { retryBlocked: true }).catch(() => undefined)
      } else {
        await enqueueProvisioningJob(order.id, `admin:${admin.email}:bulk_retry`, { retryBlocked: true }).catch(() => undefined)
      }
      updated += 1
    } else {
      return NextResponse.json({ error: "Unsupported bulk order action" }, { status: 400 })
    }
  }

  return NextResponse.json({ success: true, updated, skipped: orders.length - updated })
}
