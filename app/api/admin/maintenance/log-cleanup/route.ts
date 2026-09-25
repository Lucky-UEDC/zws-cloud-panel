import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { CLEANUP_WINDOWS, runMaintenanceCleanup } from "@/lib/admin/maintenance-cleanup"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const body = await request.json().catch(() => ({}))
  const window = String(body.window || "30d") as keyof typeof CLEANUP_WINDOWS
  if (!CLEANUP_WINDOWS[window]) {
    return NextResponse.json({ ok: false, error: "Invalid cleanup window" }, { status: 400, headers: NO_CACHE_HEADERS })
  }
  const result = await runMaintenanceCleanup({
    window,
    targets: Array.isArray(body.targets) ? body.targets.map(String) : undefined,
    mode: body.mode === "delete" ? "delete" : "archive",
    dryRun: body.dryRun !== false,
    actor: String(admin.email),
  })
  return NextResponse.json(result, { headers: NO_CACHE_HEADERS })
}
