import { NextResponse } from "next/server"
import { computeNodeSections } from "@/lib/compute-node-monitoring"
import { prisma } from "@/lib/db"
import { serializeStoragePoolConfig, syncNodeStoragePools } from "@/lib/storage-pools"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

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

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const [sections, configs] = await Promise.all([
    computeNodeSections(id),
    prisma.nodeStoragePoolConfig.findMany({
      where: { proxmoxNodeId: id },
      orderBy: [{ sortOrder: "asc" }, { storageId: "asc" }],
    }),
  ])
  return NextResponse.json({ success: true, ...sections.storage, configs: configs.map(serializeStoragePoolConfig) }, { headers: NO_CACHE_HEADERS })
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  const data = await syncNodeStoragePools(id, String(admin.email))
  return NextResponse.json({ success: true, ...data, configs: (data.configs || []).map(serializeStoragePoolConfig) }, { headers: NO_CACHE_HEADERS })
}
