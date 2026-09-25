import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createCloudflareConnectUrl } from "@/lib/cloudflare-accounts"
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
  try {
    const result = await createCloudflareConnectUrl(request, String(admin.email))
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Unable to start Cloudflare OAuth" }, { status: 400 })
  }
}
