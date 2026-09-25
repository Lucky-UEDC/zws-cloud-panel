import { NextResponse } from "next/server"
import { setStoragePoolEnabled } from "@/lib/storage-pools"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }
function serializeConfig(config: any) {
  return { ...config, totalBytes: config.totalBytes == null ? null : Number(config.totalBytes), usedBytes: config.usedBytes == null ? null : Number(config.usedBytes), freeBytes: config.freeBytes == null ? null : Number(config.freeBytes), availableBytes: config.availableBytes == null ? null : Number(config.availableBytes), pricePerGbMonthly: Number(config.pricePerGbMonthly || 0) }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id } = await params
  try {
    const config = await setStoragePoolEnabled(id, true, String(admin.email))
    return NextResponse.json({ success: true, config: serializeConfig(config) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to enable storage pool." }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
