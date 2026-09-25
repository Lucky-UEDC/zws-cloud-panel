import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { restoreBandwidthThrottle } from "@/lib/bandwidth-enforcement"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; vpsId: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id, vpsId } = await params
  const vps = await prisma.vpsInstance.findFirst({ where: { id: vpsId, proxmoxNodeId: id }, select: { id: true, vmid: true, proxmoxNodeId: true } })
  if (!vps) return NextResponse.json({ success: false, error: "VM not found on this node" }, { status: 404, headers: NO_CACHE_HEADERS })
  const result = await restoreBandwidthThrottle({ vpsId: vps.id, actor: String(admin.email), reason: "admin_node_bandwidth_restore" })
  return NextResponse.json({
    success: true,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    nodeId: id,
    requestedMbps: 0.5,
    proxmoxRateValue: null,
    net0: (result as any).net0 ?? null,
    applied: false,
    restored: Boolean((result as any).restored),
    verifiedAt: (result as any).verifiedAt || new Date().toISOString(),
  }, { headers: NO_CACHE_HEADERS })
}
