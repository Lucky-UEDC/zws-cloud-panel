import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { apiError, apiSuccess } from "@/lib/api-response"
import { deleteOrderAndCleanupService } from "@/lib/vps-lifecycle"
import { decryptSecretValue } from "@/lib/secret-crypto"
import { enqueueProvisioningJob } from "@/lib/provision"
import { provisioningReplayState } from "@/lib/provisioning-identity"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email) return apiError("unauthorized", "Unauthorized", 401)

    const { id: routeId } = await params
    const id = String(routeId || "")

    const [order, auditLogs] = await Promise.all([
      prisma.order.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          product: { select: { id: true, name: true } },
          vpsInstance: {
            include: {
              ipAllocations: { select: { ipAddress: true, status: true, poolId: true }, take: 5 },
              operatingSystem: { select: { name: true, osType: true } },
              proxmoxNode: { select: { name: true, host: true } },
            },
          },
          provisioningJobs: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { steps: { orderBy: { createdAt: "asc" } } },
          },
        },
      }),
      prisma.auditLog.findMany({
        where: { targetType: "order", targetId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, action: true, actorEmail: true, metadata: true, createdAt: true },
      }),
    ])

    if (!order) return apiError("not_found", "Order not found", 404)

    const job = order.provisioningJobs[0] ?? null
    const vps = order.vpsInstance

    return apiSuccess({
      success: true,
      order: { ...order, vpsInstance: undefined, provisioningJobs: undefined },
      vpsInstance: vps
        ? {
            ...vps,
            passwordDecrypted: vps.passwordEncrypted ? (() => { try { return decryptSecretValue(vps.passwordEncrypted!) } catch { return null } })() : null,
            primaryIp: vps.ipAllocations?.[0]?.ipAddress ?? vps.ipAddress,
            os: vps.operatingSystem?.name ?? null,
            node: vps.proxmoxNode?.name ?? null,
            ipAllocations: undefined,
            operatingSystem: undefined,
            proxmoxNode: undefined,
          }
        : null,
      provisioningJob: job
        ? { id: job.id, status: job.status, progress: job.progress, currentStep: job.currentStep, error: job.error, errorCode: job.errorCode, updatedAt: job.updatedAt }
        : null,
      timeline: job?.steps ?? [],
      auditLog: auditLogs,
    })
  } catch (error: any) {
    console.error("[ADMIN_ORDER_GET]", error)
    return apiError("server_error", error?.message || "Unable to fetch order", 500)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email) return apiError("unauthorized", "Unauthorized", 401)

    const { id: routeId } = await params
    const id = String(routeId || "")
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "").trim().toLowerCase()

    if (action !== "resume_provisioning") {
      return apiError("bad_request", "Unknown action. Supported: resume_provisioning", 400)
    }

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, status: true, provisioningStatus: true, deletedAt: true },
    })
    if (!order) return apiError("not_found", "Order not found", 404)
    if (order.deletedAt) return apiError("bad_request", "Order has been deleted", 400)

    // Clear the stuck error state so recovery can proceed
    await prisma.order.update({
      where: { id },
      data: { provisioningError: null },
    }).catch(() => null)

    // Reset any waiting_for_admin provisioning jobs so they can be re-queued
    await prisma.provisioningJob.updateMany({
      where: {
        orderId: id,
        status: { in: ["waiting_for_admin", "failed"] },
      },
      data: {
        status: "queued",
        error: null,
        errorCode: null,
        claimedAt: null,
      },
    }).catch(() => null)

    const job = await enqueueProvisioningJob(id, admin.email, { retryBlocked: true }).catch((err: any) => ({
      id: null,
      error: err?.message || "enqueue_failed",
    }))

    if ((job as any).error) {
      return apiError("server_error", (job as any).error, 500)
    }
    const state = await provisioningReplayState(id)

    return apiSuccess({
      success: true,
      code: "provisioning_resumed",
      orderId: id,
      orderNumber: order.orderNumber,
      jobId: (job as any).id || null,
      ...state,
    })
  } catch (error: any) {
    console.error("[ADMIN_ORDER_PATCH]", error)
    return apiError("server_error", error?.message || "Unable to resume provisioning", 500)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email) return apiError("unauthorized", "Unauthorized", 401)

    const { id: routeId } = await params
    const id = String(routeId || "")
    const order = await prisma.order.findUnique({
      where: { id },
      include: { vpsInstance: { select: { id: true, status: true, vmid: true } } },
    })
    if (!order) return apiError("not_found", "Order not found", 404)
    if (order.deletedAt) return apiSuccess({ success: true, orderId: order.id, alreadyDeleted: true })

    const result = await deleteOrderAndCleanupService(id, { actorEmail: admin.email, adminId: (admin as any).sub || null })
    const deletionState = String((result as any).deletionJob?.status || "completed")

    return apiSuccess({
      success: true,
      code: "deleted",
      order: result.order,
      vpsInstance: result.vpsInstance || order.vpsInstance || null,
      terminatedVps: result.terminatedVps,
      releasedIps: result.releasedIps || null,
      deletionState,
      deletionJobId: (result as any).deletionJob?.jobId || null,
      preservedFinancialRecords: result.preservedFinancialRecords,
      result,
    })
  } catch (error: any) {
    console.error("[ADMIN_ORDER_DELETE]", error)
    return apiError("server_error", error?.message || "Unable to delete order", 500)
  }
}
