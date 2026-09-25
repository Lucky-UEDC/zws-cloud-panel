import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { serializeOperatingSystem } from "@/app/api/admin/os-templates/serializers"
import { syncSingleNodeOperatingSystems } from "@/lib/os-template-sync"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

async function listNodeTemplates(nodeId: string) {
  const rows = await prisma.osTemplate.findMany({
    where: { proxmoxNodeId: nodeId, source: { in: ["PROXMOX", "proxmox"] }, proxmoxVmid: { not: null } },
    include: { proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
    orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { sortOrder: "asc" }, { proxmoxVmid: "asc" }],
  })
  return rows.map((row) => serializeOperatingSystem(row))
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const templates = await listNodeTemplates(id)
  return NextResponse.json({ success: true, nodeId: id, templates, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const node = await prisma.proxmoxNode.findUnique({ where: { id } })
  if (!node) return NextResponse.json({ success: false, error: "Node not found" }, { status: 404, headers: NO_CACHE_HEADERS })
  const sync = await syncSingleNodeOperatingSystems({
    id: node.id,
    name: node.name,
    nodeName: node.nodeName,
    host: node.host,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
  }, String(admin.email))
  const templates = await listNodeTemplates(id)
  return NextResponse.json({ success: true, nodeId: id, action: "sync", sync, templates, refreshedAt: new Date().toISOString() }, { headers: NO_CACHE_HEADERS })
}
