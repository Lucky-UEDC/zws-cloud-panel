import { NextRequest, NextResponse } from "next/server"
import { requireRecentMfa } from "@/lib/auth/guards"
import { adminStepUpMfaMaxAgeMs } from "@/lib/admin-sensitive-action"
import { getCurrentMfaSubject } from "@/lib/auth/mfa/current-subject"
import { beginMfaOrBypass } from "@/lib/auth/mfa/orchestrator"
import { ensureMfaSettings, getDeliverableMfaMethods, hasUsableMfaMethod } from "@/lib/auth/mfa/settings"
import type { MfaMethod } from "@/lib/auth/mfa/types"
import { createPanelLog } from "@/lib/panel-log"

const allowedMethods = new Set(["totp", "email", "whatsapp", "recovery"])

function hasDeliverableMethod(methods: Awaited<ReturnType<typeof getDeliverableMfaMethods>>) {
  return methods.totp || methods.email || methods.whatsapp || methods.recovery
}

export async function POST(request: NextRequest) {
  try {
    const subject = await getCurrentMfaSubject()
    if (!subject || subject.userType !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const recent = await requireRecentMfa(request, "admin", adminStepUpMfaMaxAgeMs())
    if (recent.ok) {
      return NextResponse.json({
        success: true,
        code: "mfa_not_required",
        verifiedAt: recent.session.mfaVerifiedAt || new Date().toISOString(),
      })
    }
    const settings = await ensureMfaSettings(subject)
    if (!hasUsableMfaMethod(subject, settings)) {
      return NextResponse.json({
        success: true,
        code: "mfa_not_required",
        skipped: true,
        reason: "mfa_not_configured",
      })
    }
    const deliverableMethods = await getDeliverableMfaMethods(subject, settings)
    if (!hasDeliverableMethod(deliverableMethods)) {
      void createPanelLog({
        category: "Auth",
        level: "warn",
        message: "admin_step_up_mfa_skipped_delivery_unavailable",
        actorType: "admin",
        actorEmail: subject.email,
        metadata: { reason: "mfa_delivery_unavailable", availableMethods: deliverableMethods },
      }).catch(() => null)
      return NextResponse.json({
        success: true,
        code: "mfa_not_required",
        skipped: true,
        reason: "mfa_delivery_unavailable",
      })
    }
    const body = await request.json().catch(() => ({}))
    const requested = String(body?.method || "").toLowerCase()
    const preferredMethod = allowedMethods.has(requested) && deliverableMethods[requested as MfaMethod] ? requested as MfaMethod : undefined
    const challenge = await beginMfaOrBypass({ request, subject, preferredMethod, deliverableMethods })
    return NextResponse.json({
      success: true,
      code: "mfa_required",
      method: challenge.method,
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt,
      otpExpiresAt: challenge.otpExpiresAt,
      maskedTarget: challenge.maskedTarget,
      fallbackMessage: challenge.fallbackMessage,
      riskLevel: challenge.context.risk.level,
    })
  } catch (error: any) {
    console.error("[auth] step-up start error", error)
    return NextResponse.json({ error: error?.message || "Unable to start MFA verification" }, { status: 500 })
  }
}
