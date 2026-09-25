import { NextRequest, NextResponse } from "next/server"
import { restoreBackup } from "@/lib/backups"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"
import { safeJson } from "@/lib/safe-json"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const requestedMode = String(body.mode || "DRY_RUN").toUpperCase()
    const mode = requestedMode === "MERGE_RESTORE" ? "MERGE_RESTORE" : requestedMode === "DRY_RUN" ? "DRY_RUN" : "FULL_RESTORE"
    const restore = await restoreBackup({
      backupRunId: id,
      mode,
      confirmation: String(body.confirmation || ""),
      tables: Array.isArray(body.tables) ? body.tables.map(String) : [],
      createdBy: String(admin.email),
    })
    return NextResponse.json(safeJson({ success: restore.status === "passed", restore }), { status: restore.status === "failed" ? 400 : 200, headers: NO_CACHE_HEADERS })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Backup restore failed." }, { status: error?.status || 500, headers: NO_CACHE_HEADERS })
  }
}
