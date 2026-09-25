import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { runDatabaseRepairEngine } from "@/lib/database-repair-engine"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const body = await request.json().catch(() => ({}))
  const result = await runDatabaseRepairEngine({ apply: body.apply === true })
  return NextResponse.json(result, { headers: NO_CACHE_HEADERS })
}
