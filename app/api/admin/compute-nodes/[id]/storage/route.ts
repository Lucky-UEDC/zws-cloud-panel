import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { updateStoragePoolConfig } from "@/lib/storage-pools"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
export { GET } from "../storage-pools/route"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function serializeConfig(config: any) {
  return {
    ...config,
    totalBytes: config.totalBytes == null ? null : Number(config.totalBytes),
    usedBytes: config.usedBytes == null ? null : Number(config.usedBytes),
    freeBytes: config.freeBytes == null ? null : Number(config.freeBytes),
    availableBytes: config.availableBytes == null ? null : Number(config.availableBytes),
    pricePerGbMonthly: Number(config.pricePerGbMonthly || 0),
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    const poolId = String(body.id || "")
    const pool = await prisma.nodeStoragePoolConfig.findFirst({ where: { id: poolId, proxmoxNodeId: id }, select: { id: true } })
    if (!pool) {
      return NextResponse.json({ success: false, error: "Storage pool does not belong to this node." }, { status: 400, headers: NO_CACHE_HEADERS })
    }
    const updated = await updateStoragePoolConfig(poolId, body, String(admin.email))
    return NextResponse.json({ success: true, config: serializeConfig(updated) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to update storage pool." }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
