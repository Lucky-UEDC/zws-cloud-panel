import { NextRequest, NextResponse } from "next/server"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getPublicEmailConfig, upsertEmailConfig } from "@/lib/email/config"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function unauthorized() {
  return NextResponse.json({
    ok: false,
    success: false,
    code: "ADMIN_UNAUTHORIZED",
    error: "Your admin session expired. Please sign in again.",
  }, { status: 401 })
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return unauthorized()

  const config = await getPublicEmailConfig()
  return NextResponse.json({ success: true, config })
}

export async function PUT(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const config = await upsertEmailConfig(body)
  await createPanelLog({
    category: "Admin Action",
    message: "email_smtp_settings_updated",
    actorType: "admin",
    actorEmail: String(admin.email),
    metadata: { host: config.smtpHost, port: config.smtpPort, secure: config.smtpSecure, enabled: config.enabled },
  }).catch(() => null)
  return NextResponse.json({ success: true, config })
}
