import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { normalizeVmAutomationState, normalizeVmLifecycleState } from "@/lib/vm-state-machine"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"
import { requestId, writeStructuredLog, logApiError } from "@/lib/structured-logger"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const logId = requestId("vm_action")
  const startedAt = Date.now()
  let vpsIdForLog: string | null = null
  let actionForLog = "unknown"
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return sessionExpiredJson()
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const action = String(body.action || "").trim()
    vpsIdForLog = id
    actionForLog = action || "unknown"
    if (!action) return NextResponse.json({ success: false, error: "Action is required" }, { status: 400 })
    const optimistic = {
      reason: "action_requested",
      action,
      snapshot: {
        source: "admin-action",
        generatedAt: new Date().toISOString(),
        vpsInstanceId: id,
        status: action === "start" ? "STARTING" : action === "stop" ? "STOPPING" : action === "reboot" ? "REBOOTING" : action === "suspend" ? "SUSPENDING" : action === "unsuspend" || action === "resume" ? "STARTING" : "UPDATING",
      },
    }
    await Promise.all([
      publishRealtimeEvent(realtimeChannels.vpsLive(id), optimistic),
      publishRealtimeEvent(realtimeChannels.adminVmLive(), optimistic),
      writeStructuredLog("vm-actions", "request", { requestId: logId, vpsInstanceId: id, actorEmail: admin.email, action, status: "accepted", request: body }),
    ]).catch(() => null)

    const result = await runAdminVmAction({
      vpsId: id,
      action: action as any,
      actorEmail: String(admin.email),
      payload: body && typeof body === "object" ? body : {},
    })
    const liveSnapshot = await publishLiveVmSnapshot(id, `action:${action}:complete`).catch((error) => {
      void writeStructuredLog("proxmox-sync", "post_action_snapshot_failed", { requestId: logId, vpsInstanceId: id, action, error })
      return null
    })
    const resultRecord = result && typeof result === "object" ? result as Record<string, any> : {}
    const nextStatus = resultRecord.status || resultRecord.nextState || resultRecord.provisioningStatus || null
    await writeStructuredLog("vm-actions", "response", { requestId: logId, vpsInstanceId: id, actorEmail: admin.email, action, status: 200, durationMs: Date.now() - startedAt, response: { nextStatus, liveStatus: liveSnapshot?.status || null } })
    return NextResponse.json({
      success: true,
      action,
      result,
      live: liveSnapshot,
      auditEventId: resultRecord.auditEventId || null,
      diagnostics: {
        requestedAt: new Date().toISOString(),
        action,
        nextStatus,
      },
      nextState: nextStatus ? {
        lifecycleState: normalizeVmLifecycleState(nextStatus),
        automationState: normalizeVmAutomationState(nextStatus),
      } : null,
    })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-ACT")
    if (vpsIdForLog) {
      await publishLiveVmSnapshot(vpsIdForLog, `action:${actionForLog}:failed`).catch(() => null)
    }
    await writeStructuredLog("vm-actions", "response", { requestId: logId, status: 400, durationMs: Date.now() - startedAt, error })
    await logApiError({ requestId: logId, route: "/api/admin/vms/[id]/actions", status: 400, durationMs: Date.now() - startedAt, error })
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Action failed"), supportCode }, { status: 400 })
  }
}
