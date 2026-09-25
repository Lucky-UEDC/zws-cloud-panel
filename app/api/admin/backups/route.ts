import { NextRequest, NextResponse } from "next/server"
import { listBackupRuns, createBackup, ensureRuntimeBackupDestination, recoverStaleBackupRuns } from "@/lib/backups"
import { backupHealth } from "@/lib/backup-health"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeJson as jsonSafe } from "@/lib/safe-json"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  // Recover any backups stuck in "running" for >2 hours
  await recoverStaleBackupRuns({ maxAgeMinutes: 120, actor: "api" }).catch(() => null)
  const [data, health] = await Promise.all([
    listBackupRuns(),
    backupHealth().catch((error: any) => ({ ok: false, error: error?.message || String(error) })),
  ])
  return NextResponse.json(jsonSafe({ success: true, ...data, health }), { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  await ensureRuntimeBackupDestination(String(admin.email))
  const run = await createBackup({ createdBy: String(admin.email), triggerType: "manual", scope: body.scope || ["database"] })
  return NextResponse.json(jsonSafe({ success: run.status === "completed", run }), { status: run.status === "failed" ? 500 : 201 })
}
