import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getAdminVmDetails } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { humanDatabaseError } from "@/lib/admin-safe-query"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { refreshOneVmRuntimeStatusById } from "@/lib/vm-runtime-status"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { id } = await params
    await refreshOneVmRuntimeStatusById(id, null, { force: true }).catch((error) => {
      console.warn("[ADMIN_VM_DETAILS_STATUS_REFRESH]", { id, message: error?.message || String(error) })
    })
    const details = await getAdminVmDetails(id)
    return NextResponse.json(details, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-READ")
    return NextResponse.json({
      success: true,
      partial: true,
      warnings: [humanDatabaseError(error, safeApiErrorMessage(error, "Failed to load VM details"))],
      vps: null,
      overview: {},
      timeline: [],
      logs: [],
      supportCode,
    }, { status: 200, headers: NO_CACHE_HEADERS })
  }
}
