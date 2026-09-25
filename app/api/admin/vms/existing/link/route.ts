import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { bindExistingVmToOrder } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const result = await bindExistingVmToOrder({
      orderId: String(body.orderId || ""),
      customerId: String(body.customerId || ""),
      nodeId: String(body.nodeId || body.proxmoxNodeId || ""),
      vmid: Number(body.vmid || body.vmId || 0),
      actorEmail: String(admin.email),
      source: "linked",
      reason: body.reason ? String(body.reason) : "Admin linked existing VM",
      serviceCreatedAt: body.linkedServiceCreatedAt || body.serviceCreatedAt || null,
      serviceDueAt: body.linkedServiceDueAt || body.serviceDueAt || null,
    })
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-LINK-EXISTING")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Link existing VM failed"), assigned: error?.assigned || null, supportCode }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
