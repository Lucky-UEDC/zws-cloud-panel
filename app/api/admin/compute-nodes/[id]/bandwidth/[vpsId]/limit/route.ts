import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { applyBandwidthThrottle, DEFAULT_THROTTLE_MEGABITS_PER_SECOND } from "@/lib/bandwidth-enforcement"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; vpsId: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id, vpsId } = await params
  const body = await request.json().catch(() => ({}))
  const vps = await prisma.vpsInstance.findFirst({ where: { id: vpsId, proxmoxNodeId: id }, select: { id: true, vmid: true, proxmoxNodeId: true } })
  if (!vps) return NextResponse.json({ success: false, error: "VM not found on this node" }, { status: 404, headers: NO_CACHE_HEADERS })
  const requestedMbps = Number(body.throttleRateMbps || body.limitMbps || DEFAULT_THROTTLE_MEGABITS_PER_SECOND)
  const result = await applyBandwidthThrottle({ vpsId: vps.id, actor: String(admin.email), throttleRateMbps: requestedMbps, force: true })
  return NextResponse.json({
    success: true,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    nodeId: id,
    requestedMbps,
    proxmoxRateValue: (result as any).proxmoxRateValue ?? null,
    net0: (result as any).net0 ?? null,
    applied: Boolean((result as any).applied),
    restored: false,
    verifiedAt: (result as any).verifiedAt || new Date().toISOString(),
  }, { headers: NO_CACHE_HEADERS })
}
