import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import type { VpsPowerAction } from "@/lib/vps-control"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms/:id/actions",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: DEPRECATED_HEADERS })
  }

  const { id } = await params
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: VpsPowerAction }
    if (!body.action || !["start", "stop", "reboot", "forceStop"].includes(body.action)) {
      return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400, headers: DEPRECATED_HEADERS })
    }

    const result = await runAdminVmAction({ vpsId: id, action: body.action as any, actorEmail: String(admin.email) })
    return NextResponse.json({
      success: true,
      action: body.action,
      actor: String(admin.email),
      result,
      deprecated: {
        route: "/api/admin/vps/[id]/action",
        replacement: "/api/admin/vms/[id]/actions",
      },
    }, { status: 202, headers: DEPRECATED_HEADERS })
  } catch (error: any) {
    const status = Number(error?.status || 500)
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Action failed") }, { status, headers: DEPRECATED_HEADERS })
  }
}
