import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { scanAndRelinkVmsByOrderTags } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await scanAndRelinkVmsByOrderTags({
      actorEmail: String(admin.email),
      nodeId: body?.nodeId ? String(body.nodeId) : null,
      orderId: body?.orderId ? String(body.orderId) : null,
      vpsId: body?.vpsId ? String(body.vpsId) : null,
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-RELINK-SCAN")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Relink scan failed"), supportCode }, { status: 400 })
  }
}
