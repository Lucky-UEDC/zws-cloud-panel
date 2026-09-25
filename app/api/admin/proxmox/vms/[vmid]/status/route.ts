import { NextRequest, NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { discoverVmIpAddress } from "@/lib/vm-ip-discovery"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ vmid: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const { vmid: vmidStr } = await params
  const vmid = parseInt(vmidStr)

  try {
    const vps = await prisma.vpsInstance.findFirst({
      where: {
        vmid,
        deletedAt: null,
        ownershipStatus: { notIn: ["external", "manual", "rejected"] },
        provisioningSource: { in: ["panel", "zws", "linked", "imported", "manual_delivery"] },
        proxmoxNode: { isActive: true },
      },
      include: { proxmoxNode: true },
      orderBy: { createdAt: "desc" },
    })
    if (!vps?.proxmoxNode) {
      return NextResponse.json({ error: "Panel-owned VM not found" }, { status: 404, headers: NO_CACHE_HEADERS })
    }
    const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, { allowInsecureTls: vps.proxmoxNode.allowInsecureTls })
    const [status, config] = await Promise.all([
      client.getVMStatus(vps.proxmoxNode.nodeName, vmid),
      client.getVMConfig(vps.proxmoxNode.nodeName, vmid).catch(() => null),
    ])
    const discovered = await discoverVmIpAddress({ client, nodeName: vps.proxmoxNode.nodeName, vmid, config, allocatedIp: vps.ipAddress, hostname: vps.name }).catch(() => null)
    const runtimeStatus = String(status?.status || "").toLowerCase()
    const dbStatus = runtimeStatus === "running" ? "ACTIVE" : runtimeStatus === "stopped" ? "STOPPED" : runtimeStatus === "paused" ? "PAUSED" : vps.status
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: dbStatus,
        ...(discovered?.ipAddress ? { ipAddress: discovered.ipAddress } : {}),
      },
    }).catch(() => null)
    return NextResponse.json({
      status,
      syncedStatus: dbStatus,
      ipAddress: discovered?.ipAddress || vps.ipAddress || null,
      ipSource: discovered?.source || "none",
      node: vps.proxmoxNode.nodeName,
      proxmoxNodeId: vps.proxmoxNode.id,
      vpsInstanceId: vps.id,
    }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500, headers: NO_CACHE_HEADERS })
  }
}
