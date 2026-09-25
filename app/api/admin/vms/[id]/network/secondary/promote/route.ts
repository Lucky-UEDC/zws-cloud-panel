import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { promoteSecondaryIp } from "@/lib/vm-network-orchestrator"
import { blockWhenEnterpriseNetworkingDisabled } from "@/app/api/admin/vms/[id]/network/_enterprise-gate"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const blocked = await blockWhenEnterpriseNetworkingDisabled()
  if (blocked) return blocked

  try {
    const body = await request.json().catch(() => ({}))
    const { id } = await params
    const result = await promoteSecondaryIp({
      vpsId: id,
      actorEmail: String(admin.email),
      assignmentId: String(body.assignmentId || "").trim(),
      reason: body.reason ? String(body.reason) : null,
      dryRun: false,
      confirmRisky: body.confirmRisky === true,
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to promote secondary IP" }, { status: 400 })
  }
}
