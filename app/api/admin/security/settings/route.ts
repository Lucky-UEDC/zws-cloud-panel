import { NextRequest, NextResponse } from "next/server"
import { canManageSettings } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { extractClientIp } from "@/lib/request-context"
import { writeAuditLog } from "@/lib/audit-log"
import { getAdminSecuritySettings, getAdminSecurityStatus, updateSystemSecuritySettings } from "@/lib/security/security-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canManageSettings(auth.session.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const [settings, status] = await Promise.all([
    getAdminSecuritySettings(),
    getAdminSecurityStatus(),
  ])
  settings.status = status
  return NextResponse.json({ success: true, settings })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canManageSettings(auth.session.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  try {
    const body = await request.json().catch(() => ({}))
    const settings = await updateSystemSecuritySettings(body && typeof body === "object" ? body : {})
    settings.status = await getAdminSecurityStatus()
    await writeAuditLog({
      action: "SYSTEM_SECURITY_SETTINGS_UPDATED",
      adminId: auth.session.userId,
      actorEmail: auth.session.email,
      targetType: "cloudflare_security_settings",
      newValue: {
        enabled: settings.enabled,
        mode: settings.mode,
        turnstileEnabled: settings.turnstileEnabled,
        turnstileConfigured: settings.turnstileConfigured,
        turnstileMode: settings.turnstileMode,
        protectLogin: settings.protectLogin,
        protectRegister: settings.protectRegister,
        protectForgotPassword: settings.protectForgotPassword,
        protectContact: settings.protectContact,
        protectCheckout: settings.protectCheckout,
        protectSupport: settings.protectSupport,
        protectOrders: settings.protectOrders,
        protectAdminLogin: settings.protectAdminLogin,
        whitelistEnabled: settings.whitelistEnabled,
        rateLimitEnabled: settings.rateLimitEnabled,
        riskScoringEnabled: settings.riskScoringEnabled,
        botDetectionEnabled: settings.botDetectionEnabled,
      },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent") || null,
    }).catch(() => null)
    return NextResponse.json({ success: true, settings })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unable to save security settings.",
    }, { status: 400 })
  }
}
