import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { safeJson } from "@/lib/safe-json"
import { getAdminFromCookies } from "@/lib/server-auth"
import { logApiError } from "@/lib/structured-logger"
import { loadCachedVmSnapshot } from "@/lib/vm-cache-snapshot"
import { refreshOneVmRuntimeStatusById } from "@/lib/vm-runtime-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return sessionExpiredJson()
  const startedAt = Date.now()
  const { id } = await params
  try {
    await refreshOneVmRuntimeStatusById(id, null, { force: true }).catch(() => null)
    const snapshot = await loadCachedVmSnapshot(id)
    return NextResponse.json(safeJson({ success: true, snapshot }), { headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    await logApiError({ route: "/api/admin/vms/[id]/live", vpsInstanceId: id, actorEmail: admin.email, status: error?.status || 500, durationMs: Date.now() - startedAt, error })
    return NextResponse.json({ success: false, error: error?.message || "Unable to load live VM data" }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}
