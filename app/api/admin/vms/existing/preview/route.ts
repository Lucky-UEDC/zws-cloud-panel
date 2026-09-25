import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { loadExistingVmPreview } from "@/lib/admin-vm-management"
import { buildSupportCode, safeApiErrorMessage } from "@/lib/api-error-safe"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const preview = await loadExistingVmPreview({
      nodeId: String(body.nodeId || body.proxmoxNodeId || ""),
      vmid: Number(body.vmid || body.vmId || 0),
      excludeVpsId: body.excludeVpsId ? String(body.excludeVpsId) : null,
    })
    return NextResponse.json({ success: true, preview }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    const supportCode = buildSupportCode("VM-LINK-PREVIEW")
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Unable to load VM"), assigned: error?.assigned || null, supportCode }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
