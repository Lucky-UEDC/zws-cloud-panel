import { NextRequest, NextResponse } from "next/server"
import { canManageSettings } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getRuntimeIntegrationConfig, updateRuntimeIntegrationConfig } from "@/lib/integration-config"
import { createPanelLog } from "@/lib/panel-log"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { googleCallbackUrl, googleDriveCallbackUrl, googleRedirectDiagnostic } from "@/lib/auth/google-oauth"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({
    success: true,
    settings: await getRuntimeIntegrationConfig({ masked: true }),
    diagnostics: {
      googleOAuth: {
        loginCallback: googleCallbackUrl(request),
        driveCallback: googleDriveCallbackUrl(request),
        login: googleRedirectDiagnostic("/api/auth/google/callback", request),
        drive: googleRedirectDiagnostic("/api/admin/backups/google/callback", request),
      },
    },
  }, { headers: NO_CACHE_HEADERS })
}

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const payload = await request.json().catch(() => ({}))
  const settings = await updateRuntimeIntegrationConfig(payload && typeof payload === "object" ? payload : {}, String(admin.email))
  await createPanelLog({
    category: "Admin Action",
    message: "runtime_integrations_updated",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { services: Object.keys(payload || {}) },
  }).catch(() => null)
  return NextResponse.json({ success: true, settings }, { headers: NO_CACHE_HEADERS })
}
