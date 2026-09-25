import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { listVmNetworkTimeline } from "@/lib/vm-network-orchestrator"
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
    const timeline = await listVmNetworkTimeline(id)
    return NextResponse.json({ success: true, timeline })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to load network timeline" }, { status: 400 })
  }
}
