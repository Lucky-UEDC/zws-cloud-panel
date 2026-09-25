import { NextResponse } from "next/server"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { getCustomConfigurationSettings, getSetting, type PlatformSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const [platform, customConfiguration] = await Promise.all([
    getSetting<PlatformSettings>("platform_settings"),
    getCustomConfigurationSettings(),
  ])
  return NextResponse.json({
    allowRegistration: platform.allowRegistration,
    customConfigurationEnabled: customConfiguration.enableCustomConfiguration,
  }, { headers: NO_CACHE_HEADERS })
}
