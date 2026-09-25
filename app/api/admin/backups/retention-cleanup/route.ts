import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { cleanupExpiredBackups } from "@/lib/backups"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

export async function POST() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ success: true, result: await cleanupExpiredBackups(String(admin.email)) }, { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to run retention cleanup." }, { status: 500, headers: NO_CACHE_HEADERS })
  }
}
