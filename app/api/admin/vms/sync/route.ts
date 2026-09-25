import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getAdminVmOverview } from "@/lib/admin-vm-query"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  try {
    const body = await request.json().catch(() => ({}))
    const vpsId = String(body.vpsId || body.id || body.orderId || "").trim()
    if (vpsId) {
      const result = await runAdminVmAction({ vpsId, action: "sync_proxmox_state", actorEmail: String(admin.email) })
      return NextResponse.json({ success: true, mode: "single", result })
    }
    const overview = await getAdminVmOverview({ page: 1, pageSize: 100, includeDeleted: false, forceRefresh: true })
    return NextResponse.json({ success: true, mode: "overview", syncedRows: overview.rows.length, diagnosticsSummary: overview.diagnosticsSummary })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "VM sync failed") }, { status: 400 })
  }
}
