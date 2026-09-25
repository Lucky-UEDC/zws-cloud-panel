import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { disconnectCloudflareAccount } from "@/lib/cloudflare-accounts"
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
    const account = await disconnectCloudflareAccount(body.accountId ? String(body.accountId) : null)
    await createAuditLog({
      actorEmail: String(admin.email),
      action: "CLOUDFLARE_DISCONNECT",
      targetType: "cloudflare_account",
      targetId: account?.id || "",
      metadata: { accountId: account?.accountId || body.accountId || null },
    }).catch(() => null)
    return NextResponse.json({ success: true, account })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to disconnect Cloudflare account" }, { status: 400 })
  }
}
