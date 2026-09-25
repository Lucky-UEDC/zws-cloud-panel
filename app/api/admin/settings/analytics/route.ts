import { NextRequest, NextResponse } from "next/server"
import { canManageSettings, isSuperAdmin } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getPublicSystemSettings, updateSystemAnalyticsSettings } from "@/lib/system-settings"
import { createPanelLog } from "@/lib/panel-log"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getRuntimeConfig } from "@/lib/runtime-config"

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({
    success: true,
    settings: await getPublicSystemSettings(),
    runtimeConfig: await getRuntimeConfig(),
    canManageCustomScripts: isSuperAdmin(admin.role),
  }, { headers: NO_CACHE_HEADERS })
}

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const canManageCustomScripts = isSuperAdmin(admin.role)
  const settings = await updateSystemAnalyticsSettings(await request.json().catch(() => ({})), String(admin.email), { allowCustomScripts: canManageCustomScripts })
  const runtimeConfig = await getRuntimeConfig()
  await createPanelLog({
    category: "Admin Action",
    message: "system_analytics_settings_updated",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: {
      googleAnalyticsConfigured: Boolean(settings.googleAnalyticsId),
      metaPixelConfigured: Boolean(settings.metaPixelId),
      tawkConfigured: Boolean(settings.tawkPropertyId),
      crispConfigured: Boolean(settings.crispWebsiteId),
      customScriptsChanged: canManageCustomScripts,
    },
  }).catch(() => null)
  return NextResponse.json({ success: true, settings, runtimeConfig, canManageCustomScripts }, { headers: NO_CACHE_HEADERS })
}
