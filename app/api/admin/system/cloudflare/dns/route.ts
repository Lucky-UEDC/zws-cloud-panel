import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { applyDnsMigration, getDnsMigrationPlan } from "@/lib/cloudflare-tunnel-manager"
import { createAuditLog } from "@/lib/audit-log"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  try {
    const tunnelId = new URL(request.url).searchParams.get("tunnelId") || undefined
    const plan = await getDnsMigrationPlan(tunnelId)
    return NextResponse.json({ success: true, plan })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to load DNS migration plan" }, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  try {
    const result = await applyDnsMigration({
      tunnelId: body.tunnelId ? String(body.tunnelId) : undefined,
      understandDnsChanges: body.understandDnsChanges === true,
    })
    await createAuditLog({
      actorEmail: String(admin.email),
      action: "CLOUDFLARE_DNS_MIGRATION_APPLY",
      targetType: "cloudflare_dns",
      newValue: result.applied,
      metadata: { conflictCount: result.plan.conflicts.length },
    })
    return NextResponse.json({ success: true, result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to apply DNS migration" }, { status: 400 })
  }
}
