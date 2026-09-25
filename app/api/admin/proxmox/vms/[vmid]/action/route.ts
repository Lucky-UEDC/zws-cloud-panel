import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"
import { writeStructuredLog, requestId, logApiError } from "@/lib/structured-logger"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ vmid: string }> }) {
  const logId = requestId("vmid_action")
  const startedAt = Date.now()
  let vmidForLog: number | null = null
  let vpsIdForLog: string | null = null
  let actionForLog = "unknown"
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { vmid: vmidStr } = await params
  const vmid = parseInt(vmidStr)
  vmidForLog = vmid
  const { action } = (await request.json()) as { action: "start" | "stop" | "reboot" }
  actionForLog = action || "unknown"
  if (!["start", "stop", "reboot"].includes(action)) {
    return NextResponse.json({ error: "Unsupported VM action" }, { status: 400, headers: NO_CACHE_HEADERS })
  }

  try {
    const vps = await prisma.vpsInstance.findFirst({
      where: {
        vmid,
        deletedAt: null,
        ownershipStatus: { notIn: ["external", "manual", "rejected"] },
        provisioningSource: { in: ["panel", "zws", "linked", "imported", "manual_delivery"] },
        proxmoxNode: { isActive: true },
      },
      include: { proxmoxNode: true },
      orderBy: { createdAt: "desc" },
    })
    if (!vps?.proxmoxNode) {
      return NextResponse.json({ error: "Panel-owned VM not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }
    vpsIdForLog = vps.id
    await Promise.all([
      publishRealtimeEvent(realtimeChannels.vpsLive(vps.id), { reason: "action_requested", action, snapshot: { source: "admin-action", generatedAt: new Date().toISOString(), vpsInstanceId: vps.id, vmid, status: action === "start" ? "STARTING" : action === "stop" ? "STOPPING" : "REBOOTING" } }),
      publishRealtimeEvent(realtimeChannels.adminVmLive(), { reason: "action_requested", action, snapshot: { source: "admin-action", generatedAt: new Date().toISOString(), vpsInstanceId: vps.id, vmid, status: action === "start" ? "STARTING" : action === "stop" ? "STOPPING" : "REBOOTING" } }),
      writeStructuredLog("vm-actions", "request", { requestId: logId, vpsInstanceId: vps.id, vmid, actorEmail: admin.email, action }),
    ]).catch(() => null)
    const result = await runAdminVmAction({ vpsId: vps.id, action, actorEmail: String(admin.email) })
    const taskId = result && typeof result === "object" ? (result as any).taskId || null : null
    const live = await publishLiveVmSnapshot(vps.id, `action:${action}:queued`).catch(() => null)
    await writeStructuredLog("vm-actions", "response", { requestId: logId, vpsInstanceId: vps.id, vmid, actorEmail: admin.email, action, status: 202, durationMs: Date.now() - startedAt, response: { taskId } })
    return NextResponse.json({
      success: true,
      action,
      result,
      status: (result as any)?.status || null,
      runtimeStatus: (result as any)?.runtimeStatus || null,
      vpsInstanceId: vps.id,
      proxmoxNodeId: vps.proxmoxNode.id,
      node: vps.proxmoxNode.nodeName,
      vmid,
      taskId,
      live,
    }, { status: 202, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    if (vpsIdForLog) {
      await publishLiveVmSnapshot(vpsIdForLog, `action:${actionForLog}:failed`).catch(() => null)
    }
    await writeStructuredLog("vm-actions", "response", { requestId: logId, vmid: vmidForLog, status: error.status || 500, durationMs: Date.now() - startedAt, error })
    await logApiError({ requestId: logId, route: "/api/admin/proxmox/vms/[vmid]/action", vmid: vmidForLog, status: error.status || 500, durationMs: Date.now() - startedAt, error })
    return NextResponse.json({
      success: false,
      error: error.message,
      code: error.code || (error.message === "VM missing" ? "VM_MISSING" : "ACTION_FAILED"),
      vmid: vmidForLog,
      vpsInstanceId: vpsIdForLog,
    }, { status: error.status || 500, headers: NO_CACHE_HEADERS })
  }
}
