import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { autoFindVmForService } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const result = await autoFindVmForService({
      vpsId: id,
      nodeId: String(body.nodeId || body.proxmoxNodeId || ""),
      actorEmail: String(admin.email),
      apply: body.apply === true,
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-REASSIGN-AUTO")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Auto discovery failed"), assigned: error?.assigned || null, supportCode }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
