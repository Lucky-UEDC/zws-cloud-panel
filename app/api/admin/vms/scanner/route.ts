import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { scanVmInfrastructure } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await scanVmInfrastructure({
      actorEmail: String(admin.email),
      nodeId: body.nodeId ? String(body.nodeId) : null,
      repair: body.repair === true,
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-SCANNER")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "VM scanner failed"), supportCode }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
