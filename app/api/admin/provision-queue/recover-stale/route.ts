import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { recoverStaleProvisioningJobs } from "@/lib/provision"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }
  const result = await recoverStaleProvisioningJobs()
  return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
}
