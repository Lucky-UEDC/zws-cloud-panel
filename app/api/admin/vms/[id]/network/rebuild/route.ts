import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { rebuildNetwork } from "@/lib/vm-network-orchestrator"
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
    const result = await rebuildNetwork({
      vpsId: id,
      actorEmail: String(admin.email),
      reason: body.reason ? String(body.reason) : null,
      dryRun: body.dryRun === true,
      confirmRisky: body.confirmRisky === true,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : null,
    })
    return NextResponse.json({ success: Boolean(result?.success), result }, { status: result?.requiresConfirmation ? 409 : 200 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to rebuild network" }, { status: 400 })
  }
}
