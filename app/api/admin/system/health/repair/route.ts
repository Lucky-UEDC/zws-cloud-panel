import { NextRequest, NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { createAuditLog } from "@/lib/audit-log"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { runPlatformHealthRepair } from "@/lib/platform-health-repair"
import { extractClientIp } from "@/lib/request-context"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const body = await request.json().catch(() => ({}))
  const result = await runPlatformHealthRepair({
    actorEmail: String(admin.email),
    limit: Number(body.limit || 50),
  })
  await createAuditLog({
    actorEmail: String(admin.email),
    action: "PLATFORM_HEALTH_REPAIR",
    targetType: "platform_health",
    newValue: { repaired: result.repaired, skipped: result.skipped, failed: result.failed },
    metadata: result as any,
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  }).catch(() => null)

  return NextResponse.json({ success: result.failed === 0, result }, { status: result.failed ? 207 : 200, headers: NO_CACHE_HEADERS })
}
