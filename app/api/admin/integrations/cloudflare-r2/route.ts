import { NextRequest, NextResponse } from "next/server"
import { canManageSettings } from "@/lib/admin-rbac"
import { getCloudflareR2Config, saveCloudflareR2Config } from "@/lib/cloudflare-r2"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

async function requireAdmin() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return null
  return admin
}

export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ success: true, config: await getCloudflareR2Config() }, { headers: NO_CACHE_HEADERS })
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const config = await saveCloudflareR2Config(body && typeof body === "object" ? body : {}, String(admin.email))
  return NextResponse.json({ success: true, config }, { headers: NO_CACHE_HEADERS })
}
