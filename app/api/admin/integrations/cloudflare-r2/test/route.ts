import { NextRequest, NextResponse } from "next/server"
import { canManageSettings } from "@/lib/admin-rbac"
import { cloudflareR2ErrorMessage, testCloudflareR2Connection } from "@/lib/cloudflare-r2"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getAdminFromCookies } from "@/lib/server-auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => undefined)
  try {
    const result = await testCloudflareR2Connection(body && typeof body === "object" ? body : undefined)
    return NextResponse.json({ success: true, result }, { headers: NO_CACHE_HEADERS })
  } catch (error) {
    return NextResponse.json({ success: false, error: cloudflareR2ErrorMessage(error) }, { headers: NO_CACHE_HEADERS })
  }
}
