import { NextRequest, NextResponse } from "next/server"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { enqueueVmAction, resolveVmActionTargetByNode, serializeVmActionJob } from "@/lib/vm-action-jobs"
import { requestId, writeStructuredLog } from "@/lib/structured-logger"

export const dynamic = "force-dynamic"
const ACTIONS = new Set(["start", "stop", "restart", "shutdown"])

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const startedAt = Date.now()
  const reqId = request.headers.get("x-request-id") || requestId("vm_api")
  const { action } = await params
  if (!ACTIONS.has(action)) return NextResponse.json({ success: false, code: "INVALID_ACTION", error: "Unsupported VM action", requestId: reqId }, { status: 404 })

  const [admin, customer] = await Promise.all([getAdminFromRequest(request), getClientFromRequest(request)])
  const isAdmin = Boolean(admin?.email && canAccessAdminApi(admin.role))
  const adminEmail = isAdmin ? String(admin?.email || "") : ""
  const customerId = isAdmin ? undefined : String(customer?.sub || "")
  if (!isAdmin && !customerId) return NextResponse.json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized", requestId: reqId }, { status: 401 })

  let vmid: number | null = null
  let node = ""
  try {
    const body = await request.json().catch(() => ({}))
    node = String(body?.node || "").trim()
    vmid = Number(body?.vmid)
    const vps = await resolveVmActionTargetByNode({ node, vmid, customerId })
    const queued = await enqueueVmAction({
      vps,
      action,
      requestId: reqId,
      actor: isAdmin
        ? { requestedBy: adminEmail, requestedRole: "admin" }
        : { requestedBy: `customer:${customerId}`, requestedRole: "customer", customerId },
    })
    const nodeName = vps.proxmoxNode?.nodeName || node
    await writeStructuredLog("vm-actions", "api_response", {
      requestId: reqId, api: `/api/vm/${action}`, durationMs: Date.now() - startedAt, result: "accepted",
      jobId: queued.job.id, orderId: vps.orderId, customerId: vps.customerId, vpsInstanceId: vps.id,
      proxmoxNodeId: vps.proxmoxNodeId, node: nodeName, vmid: vps.vmid,
    })
    return NextResponse.json({ success: true, ...serializeVmActionJob(queued.job), duplicate: queued.duplicate }, { status: 202, headers: { "Cache-Control": "no-store", "X-Request-ID": reqId } })
  } catch (error: any) {
    const rawStatus = Number(error?.status || 503)
    const status = rawStatus >= 500 ? 503 : rawStatus
    await writeStructuredLog("vm-actions", "api_response", {
      requestId: reqId, api: `/api/vm/${action}`, durationMs: Date.now() - startedAt, result: "failed",
      node, vmid, error,
    })
    return NextResponse.json({ success: false, code: error?.code || "ACTION_FAILED", error: error?.message || "Action failed", requestId: reqId }, { status, headers: { "Cache-Control": "no-store", "X-Request-ID": reqId } })
  }
}
