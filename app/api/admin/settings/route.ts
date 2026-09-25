import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canManageSettings } from "@/lib/admin-rbac"
import { getAllSettings, maskAdminSecrets } from "@/lib/settings"

export async function GET() {
  try {
    const admin = await getAdminFromCookies()
    if (!admin?.email || !canManageSettings(admin.role)) {
      return NextResponse.json({
        ok: false,
        success: false,
        code: "ADMIN_UNAUTHORIZED",
        error: "Your admin session expired. Please sign in again.",
      }, { status: 401 })
    }

    const settings = await getAllSettings()
    const { smtp: _smtp, ...settingsWithoutEmail } = settings
    const masked = {
      success: true,
      ...settingsWithoutEmail,
      payment: maskAdminSecrets("payment_settings", settings.payment),
    }
    return NextResponse.json(masked)
  } catch (error) {
    console.error("[Admin][Settings] load failed", error)
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 })
  }
}
