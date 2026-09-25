import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getAggregatedAdminData } from "@/lib/admin-data-aggregator"
import { createPanelLog } from "@/lib/panel-log"
import { buildSupportCode } from "@/lib/api-error-safe"
import { classifyEnterpriseError } from "@/lib/enterprise-error-classifier"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const includeDeleted = searchParams.get("includeDeleted") === "true"
    const forceRefresh = searchParams.get("forceRefresh") === "true"

    const aggregated = await getAggregatedAdminData({
      page: 1,
      pageSize: 200,
      includeDeleted,
      forceRefresh,
    })

    const hasIssue = Object.values(aggregated.consistency.issues).some((count) => Number(count || 0) > 0)
    const supportCode = buildSupportCode("VM-CONS")

    await createPanelLog({
      level: hasIssue ? "warn" : "info",
      category: "Admin Action",
      message: hasIssue ? "admin_vm_order_consistency_issues_detected" : "admin_vm_order_consistency_clean",
      actorType: "admin",
      actorEmail: String(admin.email),
      metadata: {
        checkedAt: aggregated.consistency.checkedAt,
        issues: aggregated.consistency.issues,
        totals: aggregated.consistency.totals,
        supportCode,
      },
    })

    return NextResponse.json({
      success: true,
      consistency: aggregated.consistency,
      diagnosticsSummary: aggregated.diagnosticsSummary,
      degraded: aggregated.degraded,
      startupSchema: aggregated.startupSchema,
      supportCode,
    })
  } catch (error: any) {
    const classified = classifyEnterpriseError(error)
    return NextResponse.json({
      success: false,
      error: classified.message || "Unable to run consistency checks",
      errorKind: classified.kind,
      supportCode: buildSupportCode("VM-CONS"),
    }, { status: 500 })
  }
}
