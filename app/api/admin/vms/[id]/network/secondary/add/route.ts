import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { addSecondaryIp } from "@/lib/vm-network-orchestrator"
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
    const result = await addSecondaryIp({
      vpsId: id,
      actorEmail: String(admin.email),
      family: String(body.family || "ipv4") === "ipv6" ? "ipv6" : "ipv4",
      role: (["secondary", "floating", "failover"].includes(String(body.role || "secondary")) ? String(body.role || "secondary") : "secondary") as "secondary" | "floating" | "failover",
      assignmentType: String(body.assignmentType || "address") === "prefix" ? "prefix" : "address",
      poolId: body.poolId ? String(body.poolId) : null,
      ipAddress: body.ipAddress ? String(body.ipAddress) : null,
      cidr: body.cidr !== undefined ? Number(body.cidr) : null,
      prefix: body.prefix ? String(body.prefix) : null,
      prefixLength: body.prefixLength !== undefined ? Number(body.prefixLength) : null,
      gateway: body.gateway ? String(body.gateway) : null,
      bridge: body.bridge ? String(body.bridge) : null,
      vlanTag: body.vlanTag !== undefined ? Number(body.vlanTag) : null,
      reason: body.reason ? String(body.reason) : null,
      dryRun: false,
      confirmRisky: false,
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to add secondary IP" }, { status: 400 })
  }
}
