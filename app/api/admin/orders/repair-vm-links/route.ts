import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { humanDatabaseError } from "@/lib/admin-safe-query"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { repairPaidOrdersMissingVmLinks } from "@/lib/admin-vm-management"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await repairPaidOrdersMissingVmLinks({
      actorEmail: String(admin.email),
      limit: Number(body?.limit || 25),
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    const supportCode = buildSupportCode("ORDER-VM-REPAIR-BULK")
    return NextResponse.json({
      success: false,
      error: humanDatabaseError(error, safeApiErrorMessage(error, "Bulk VM link repair failed")),
      supportCode,
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
