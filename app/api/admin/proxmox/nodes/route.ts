import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  try {
    const configuredNodes = await prisma.proxmoxNode.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
    const nodeStats = await Promise.all(
      configuredNodes.map(async (configured) => {
        const client = createProxmoxClient(configured.host, configured.tokenId, configured.tokenSecret, { allowInsecureTls: configured.allowInsecureTls })
        try {
          const stats = await client.getNodeStats(configured.nodeName)
          return normalizeNodeStats(configured, stats)
        } catch (error: any) {
          return { id: configured.id, node: configured.nodeName, name: configured.name, status: configured.status, stats: null, error: error?.message || "Node stats failed" }
        }
      })
    )
    return NextResponse.json({ nodes: nodeStats }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.status || 500, headers: NO_CACHE_HEADERS })
  }
}

function normalizeNodeStats(configured: { id: string; nodeName: string; name: string; status: string }, stats: any) {
  const cpuFraction = Number(stats?.cpu || 0)
  const cpuPercent = Number.isFinite(cpuFraction) ? Math.round(Math.max(0, Math.min(1, cpuFraction)) * 1000) / 10 : 0
  const memUsed = Number(stats?.memory?.used || 0)
  const memTotal = Number(stats?.memory?.total || 0)
  const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0
  return {
    id: configured.id,
    node: configured.nodeName,
    name: configured.name,
    status: configured.status,
    stats,
    cpuPercent,
    memPercent,
    memUsedGb: (memUsed / 1024 ** 3).toFixed(1),
    memTotalGb: (memTotal / 1024 ** 3).toFixed(1),
  }
}
