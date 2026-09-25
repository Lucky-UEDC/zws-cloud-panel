import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { runAdminVmAction } from "@/lib/admin-vm-management"
import { safeApiErrorMessage } from "@/lib/api-error-safe"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const vpsId = String(body.vpsId || body.id || body.orderId || "").trim()
    if (!vpsId) return NextResponse.json({ success: false, error: "vpsId is required" }, { status: 400 })
    const result = await runAdminVmAction({ vpsId, action: "shutdown", actorEmail: String(admin.email) })
    return NextResponse.json({ success: true, result })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Shutdown failed") }, { status: 400 })
  }
}
