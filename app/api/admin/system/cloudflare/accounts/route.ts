import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { listCloudflareAccounts } from "@/lib/cloudflare-accounts"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return null
  return admin
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  try {
    const accounts = await listCloudflareAccounts()
    return NextResponse.json({ success: true, accounts })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to list Cloudflare accounts" }, { status: 500 })
  }
}
