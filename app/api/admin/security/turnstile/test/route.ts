import { NextRequest, NextResponse } from "next/server"
import { canManageSettings } from "@/lib/admin-rbac"
import { requireAdminFullAuth, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { extractClientIp } from "@/lib/request-context"
import {
  getSystemSecuritySettings,
  isMaskedTurnstileSecret,
  recordTurnstileVerificationStatus,
  validateTurnstileSecretKey,
  validateTurnstileSiteKey,
} from "@/lib/security/security-settings"
import { verifyTurnstileWithSecret } from "@/lib/security/turnstile"
import { writeAuditLog } from "@/lib/audit-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return auth.response
  if (!canManageSettings(auth.session.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response

  try {
    const body = await request.json().catch(() => ({}))
    validateTurnstileSiteKey(body?.siteKey)
    const current = await getSystemSecuritySettings({ fresh: true })
    const rawSecret = String(body?.secretKey || "").trim()
    const secret = isMaskedTurnstileSecret(rawSecret) ? current.turnstileSecretKey : validateTurnstileSecretKey(rawSecret)
    if (!secret) throw new Error("Turnstile secret key is required for the connection test.")

    const result = await verifyTurnstileWithSecret({
      secret,
      token: body?.token,
      remoteIp: extractClientIp(request),
    })
    await recordTurnstileVerificationStatus(result.ok).catch(() => null)

    await writeAuditLog({
      action: "TURNSTILE_CONNECTION_TEST",
      adminId: auth.session.userId,
      actorEmail: auth.session.email,
      targetType: "cloudflare_security_settings",
      metadata: { success: result.ok, errors: result.errors },
      ipAddress: extractClientIp(request),
      userAgent: request.headers.get("user-agent") || null,
    }).catch(() => null)

    if (!result.ok) {
      return NextResponse.json({ success: false, error: "Turnstile verification failed.", errors: result.errors }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      status: "connected",
      lastVerificationStatus: "success",
      lastVerificationAt: new Date().toISOString(),
      hostname: result.data?.hostname || null,
      action: result.data?.action || null,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unable to test Turnstile settings.",
    }, { status: 400 })
  }
}
