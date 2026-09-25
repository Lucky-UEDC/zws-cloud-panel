import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getAdminOrdersWithVmStatus } from "@/lib/admin-vm-query"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { classifyEnterpriseError } from "@/lib/enterprise-error-classifier"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeJson } from "@/lib/safe-json"
import { humanDatabaseError } from "@/lib/admin-safe-query"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const payload = await getAdminOrdersWithVmStatus({
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
      consistency: {
        checkedAt: new Date().toISOString(),
        totals: { ordersScanned: 0, vmRows: 0 },
        issues: { paidWithoutService: 0, vmWithoutProvisioningLink: 0, ipOwnershipMismatch: 0, activeInvoiceMismatch: 0, orphanProvisioningJobs: 0, orphanVms: 0 },
        samples: { paidWithoutServiceOrderIds: [], vmWithoutProvisioningOrderIds: [], ipMismatchOrderIds: [] },
      },
      degraded: { degradedMode: true, degradedReasons: [classified.kind] },
      vmStatusPartial: true,
      partialWarnings: [humanDatabaseError(error, safeApiErrorMessage(classified.message, "Unable to load order and VM status data"))],
      errorKind: classified.kind,
    }), { status: 200, headers: NO_CACHE_HEADERS })
  }
}
