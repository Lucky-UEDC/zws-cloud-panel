import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { enqueueProvisioningJob } from "@/lib/provision"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { provisioningReplayState } from "@/lib/provisioning-identity"

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { orderId } = await params
    const body = await request.json().catch(() => ({}))
    const rawNodeId = String(body?.nodeId || body?.proxmoxNodeId || "").trim()
    let nodeId: string | null | undefined
    if (rawNodeId === "auto") nodeId = null
    else if (rawNodeId === "product_default") {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { proxmoxNodeId: true, product: { select: { defaultNodeId: true } } } })
      nodeId = order?.product?.defaultNodeId || order?.proxmoxNodeId || undefined
    } else if (rawNodeId) {
      nodeId = rawNodeId
    }
    const options = rawNodeId && nodeId !== undefined
      ? {
          nodeId,
          retryBlocked: true,
          ipAssignmentMode: body?.ipAssignmentMode || (body?.requestedIp ? "manual" : "automatic"),
          poolId: body?.poolId || null,
          requestedIp: body?.requestedIp || null,
          forceIpOverride: body?.forceIpOverride === true,
        }
      : {
          retryBlocked: true,
          ipAssignmentMode: body?.ipAssignmentMode || (body?.requestedIp ? "manual" : "automatic"),
          poolId: body?.poolId || null,
          requestedIp: body?.requestedIp || null,
          forceIpOverride: body?.forceIpOverride === true,
        }
    const job = await enqueueProvisioningJob(orderId, String(admin.email), options)
    const state = await provisioningReplayState(orderId)

    return NextResponse.json({ success: true, queued: state.phase !== "READY", jobId: job.id, status: job.status, displayStatus: job.displayStatus, ...state })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Unable to queue provisioning") }, { status: 500 })
  }
}
