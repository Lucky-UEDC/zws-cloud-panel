import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { recoverProvisionableOrders } from "@/lib/provisioning-order-recovery"
import { getAdminFromCookies } from "@/lib/server-auth"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await recoverProvisionableOrders({
      actor: String(admin.email),
      limit: Number(body?.limit || 100),
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeApiErrorMessage(error, "Repair all orders failed"),
    }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
