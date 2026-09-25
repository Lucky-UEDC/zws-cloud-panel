import { NextResponse } from "next/server"
import { enqueueProvisioningJob, enqueueUpgradeJob } from "@/lib/provision"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { assertPaymentVerifiedForProvisioning } from "@/lib/payment-state"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms/:id/provision/retry-step",
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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: DEPRECATED_HEADERS })
  }

  try {
    const { id } = await params
    const order = await prisma.order.findFirst({ where: { OR: [{ id }, { serviceId: id }] }, select: { id: true, orderType: true, metadata: true } })
    if (!order) return NextResponse.json({ success: false, error: "Order not found" }, { status: 404, headers: DEPRECATED_HEADERS })
    const upgradeOrder = isUpgradeOrder(order)
    await assertPaymentVerifiedForProvisioning(order.id)

    await prisma.provisioningJob.updateMany({
      where: { orderId: order.id, status: { in: ["failed", "waiting_for_admin"] } },
      data: {
        status: "queued",
        dedupeKey: `${upgradeOrder ? "upgrade" : "provision"}:${order.id}`,
        currentStep: upgradeOrder ? "UPGRADE_QUEUED" : "QUEUED",
        displayStatus: "Queued",
        error: null,
        errorCode: null,
        completedAt: null,
        nextRetryAt: null,
      },
    })
    await prisma.order.update({ where: { id: order.id }, data: { provisioningStatus: upgradeOrder ? "UPGRADE_QUEUED" : "QUEUED", provisioningError: null } }).catch(() => undefined)
    const job = upgradeOrder
      ? await enqueueUpgradeJob(order.id, String(admin.email), { retryBlocked: true })
      : await enqueueProvisioningJob(order.id, String(admin.email), { retryBlocked: true })
    return NextResponse.json({
      success: true,
      job,
      deprecated: { route: "/api/admin/vps/[id]/retry", replacement: "/api/admin/vms/[id]/provision/retry-step" },
    }, { headers: DEPRECATED_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Retry failed" }, { status: 400, headers: DEPRECATED_HEADERS })
  }
}
