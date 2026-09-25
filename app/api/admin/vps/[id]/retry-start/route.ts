import { NextResponse } from "next/server"
import { retryStartVps } from "@/lib/provision"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

const DEPRECATED_HEADERS = {
  "X-ZWS-Deprecated": "true",
  "X-ZWS-Replacement": "/api/admin/vms/:id/actions",
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: DEPRECATED_HEADERS })
  }

  try {
    const { id } = await params
    const result = await retryStartVps(id, String(admin.email))
    if (result.status !== "ACTIVE") {
      return NextResponse.json({ success: false, error: result.error || "VM did not reach running state", vmid: result.vmid }, { status: 400, headers: DEPRECATED_HEADERS })
    }
    return NextResponse.json({
      success: true,
      ...result,
      deprecated: { route: "/api/admin/vps/[id]/retry-start", replacement: "/api/admin/vms/[id]/actions" },
    }, { headers: DEPRECATED_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Retry start failed" }, { status: 400, headers: DEPRECATED_HEADERS })
  }
}
