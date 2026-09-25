import { NextResponse } from "next/server"
import { serializeStoragePoolConfig, updateStoragePoolConfig } from "@/lib/storage-pools"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"
export const revalidate = 0

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  try {
    const config = await updateStoragePoolConfig(id, body, String(admin.email))
    return NextResponse.json({ success: true, config: serializeStoragePoolConfig(config) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to update storage pool." }, { status: 400, headers: NO_CACHE_HEADERS })
  }
}
