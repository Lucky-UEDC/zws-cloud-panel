import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { humanDatabaseError } from "@/lib/admin-safe-query"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { repairPaidOrderVmLink } from "@/lib/admin-vm-management"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const { id } = await params
    const result = await repairPaidOrderVmLink({ orderId: id, actorEmail: String(admin.email) })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    const supportCode = buildSupportCode("ORDER-VM-REPAIR")
    return NextResponse.json({
      success: false,
      error: humanDatabaseError(error, safeApiErrorMessage(error, "Repair VM Link failed")),
      supportCode,
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
