import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getAdminVmOverview } from "@/lib/admin-vm-query"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { canAccessAdminApi } from "@/lib/admin-rbac"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms",
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const includeDeleted = request.nextUrl.searchParams.get("includeDeleted") === "true"
    const page = Number(request.nextUrl.searchParams.get("page") || 1)
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") || 50)
    const status = request.nextUrl.searchParams.get("status")
    const search = request.nextUrl.searchParams.get("search")

    const payload = await getAdminVmOverview({
      page,
      pageSize,
      includeDeleted,
      status,
      search,
      forceRefresh: request.nextUrl.searchParams.get("forceRefresh") === "true",
    })

    const vps = payload.rows.map((row) => ({
      id: row.id,
      name: row.name,
      vmid: row.vmid,
      status: row.status,
      ipAddress: row.ipAddress,
      nextRenewalAt: row.nextRenewalAt,
      customer: row.customer || { id: "", email: "", name: null },
      proxmoxNode: row.nodeName ? { id: "", nodeName: row.nodeName, name: row.nodeName } : null,
      provisioningJobs: row.provisioning.jobId
        ? [{
            id: row.provisioning.jobId,
            status: row.provisioning.jobStatus || "unknown",
            currentStep: row.provisioning.status,
            displayStatus: row.provisioning.displayStatus,
          }]
        : [],
      compatibility: {
        source: "admin_vm_query",
        orderId: row.order.id,
      },
    }))

    return NextResponse.json({
      success: true,
      vps,
      pendingJobs: [],
      pagination: payload.pagination,
      deprecated: {
        route: "/api/admin/vps",
        replacement: "/api/admin/vms",
        sunset: "compatibility_mode",
      },
    }, { headers: DEPRECATED_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Unable to load VM list") }, { status: 500, headers: DEPRECATED_HEADERS })
  }
}
