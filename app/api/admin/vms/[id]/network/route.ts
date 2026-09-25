import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getVmNetworkDetails } from "@/lib/vm-network-orchestrator"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { blockWhenEnterpriseNetworkingDisabled } from "@/app/api/admin/vms/[id]/network/_enterprise-gate"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const blocked = await blockWhenEnterpriseNetworkingDisabled()
  if (blocked) return blocked

  try {
    const { id } = await params
    const details = await getVmNetworkDetails(id)
    return NextResponse.json({ success: true, ...details })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: safeApiErrorMessage(error, "Failed to load VM network") }, { status: 400 })
  }
}
