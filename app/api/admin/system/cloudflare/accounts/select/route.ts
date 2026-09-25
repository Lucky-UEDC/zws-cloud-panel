import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { selectCloudflareAccount } from "@/lib/cloudflare-accounts"
import { createAuditLog } from "@/lib/audit-log"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  try {
    const account = await selectCloudflareAccount({
      accountId: String(body.accountId || "").trim(),
      zoneId: body.zoneId === undefined ? undefined : String(body.zoneId || "").trim() || null,
      tunnelId: body.tunnelId === undefined ? undefined : String(body.tunnelId || "").trim() || null,
      tunnelName: body.tunnelName === undefined ? undefined : String(body.tunnelName || "").trim() || null,
    })
    await createAuditLog({
      actorEmail: String(admin.email),
      action: "CLOUDFLARE_ACCOUNT_SELECT",
      targetType: "cloudflare_account",
      targetId: account.id,
      metadata: { accountId: account.accountId, zoneId: account.zoneId, tunnelId: account.tunnelId },
    }).catch(() => null)
    return NextResponse.json({ success: true, account })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to select Cloudflare account" }, { status: 400 })
  }
}
