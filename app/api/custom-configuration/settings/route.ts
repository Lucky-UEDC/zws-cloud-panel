import { NextResponse } from "next/server"
import { apiError, apiSuccess } from "@/lib/api-response"
import { getCustomConfigurationSettings } from "@/lib/settings"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const settings = await getCustomConfigurationSettings()
    if (!settings.enableCustomConfiguration) {
      return apiError("custom_config_disabled", "Custom configuration is disabled.", 403)
    }

    return apiSuccess({ settings })
  } catch (error) {
    console.error("[CustomConfiguration][Settings] load failed", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}

