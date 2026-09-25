import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getAdminVmOverview } from "@/lib/admin-vm-query"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { classifyEnterpriseError } from "@/lib/enterprise-error-classifier"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeJson } from "@/lib/safe-json"
import { humanDatabaseError } from "@/lib/admin-safe-query"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { refreshRecentAdminVmRuntimeStatuses } from "@/lib/vm-runtime-status"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    await refreshRecentAdminVmRuntimeStatuses(Number(searchParams.get("pageSize") || 50)).catch((error) => {
      console.warn("[ADMIN_VMS_STATUS_REFRESH]", { message: error?.message || String(error) })
    })
    const payload = await getAdminVmOverview({
      page: Number(searchParams.get("page") || 1),
      pageSize: Number(searchParams.get("pageSize") || 50),
      includeDeleted: searchParams.get("includeDeleted") === "true",
      status: searchParams.get("status"),
      search: searchParams.get("search"),
      forceRefresh: searchParams.get("forceRefresh") === "true",
    })

    return NextResponse.json(safeJson({ success: true, warnings: payload.partialWarnings || [], ...payload }), { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const classified = classifyEnterpriseError(error)
    return NextResponse.json(safeJson({
      success: true,
      rows: [],
      pagination: { page: 1, pageSize: 50, total: 0, pages: 1 },
      diagnosticsSummary: { rowsWithIssues: 0, staleVmStates: 0, networkMismatch: 0, provisioningFailed: 0, paymentFailed: 0 },
      vmStatusPartial: true,
      partialWarnings: [humanDatabaseError(error, safeApiErrorMessage(classified.message, "Unable to load VM overview"))],
      errorKind: classified.kind,
    }), { status: 200, headers: NO_CACHE_HEADERS })
  }
}
