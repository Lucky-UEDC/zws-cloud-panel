import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { enqueueProvisioningJob } from "@/lib/provision"
import { prisma } from "@/lib/db"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { provisioningReplayState } from "@/lib/provisioning-identity"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    let orderId = String(body.orderId || "").trim()
    const vpsId = String(body.vpsId || body.id || "").trim()
    if (!orderId && vpsId) {
      const vps = await prisma.vpsInstance.findFirst({ where: { OR: [{ id: vpsId }, { orderId: vpsId }] }, select: { orderId: true } })
      orderId = vps?.orderId || ""
    }
    if (!orderId) return NextResponse.json({ success: false, error: "orderId or vpsId is required" }, { status: 400 })
    const rawNodeId = String(body.nodeId || body.proxmoxNodeId || "").trim()
    let nodeId: string | null | undefined
    if (rawNodeId === "auto") nodeId = null
    else if (rawNodeId === "product_default") {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { proxmoxNodeId: true, product: { select: { defaultNodeId: true } } } })
      nodeId = order?.product?.defaultNodeId || order?.proxmoxNodeId || undefined
    } else if (rawNodeId) {
      nodeId = rawNodeId
    }
    const job = await enqueueProvisioningJob(orderId, `admin:${admin.email}`, {
      retryBlocked: true,
      ipAssignmentMode: body?.ipAssignmentMode || (body?.requestedIp ? "manual" : "automatic"),
      poolId: body?.poolId || null,
      requestedIp: body?.requestedIp || null,
      forceIpOverride: body?.forceIpOverride === true,
      ...(rawNodeId && nodeId !== undefined ? { nodeId } : {}),
    })
    const state = await provisioningReplayState(orderId)
    return NextResponse.json({ success: true, queued: state.phase !== "READY", ...state, job })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Provision enqueue failed") }, { status: 400 })
  }
}
