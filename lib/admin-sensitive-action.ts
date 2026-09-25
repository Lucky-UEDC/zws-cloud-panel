import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { requireAdminFullAuth, requireRecentMfa } from "@/lib/auth/guards"
import { ensureMfaSettings, hasDeliverableMfaMethod, hasUsableMfaMethod } from "@/lib/auth/mfa/settings"
import { resolveMfaSubject } from "@/lib/auth/mfa/subjects"
import { getRuntimeSecurityPolicy } from "@/lib/security-policy"
import { createPanelLog } from "@/lib/panel-log"
import type { ResolvedSession } from "@/lib/auth/session-store"

export function adminStepUpMfaMaxAgeMs() {
  const minutes = Number(process.env.ADMIN_STEP_UP_MFA_MINUTES || "")
  if (Number.isFinite(minutes) && minutes > 0) return Math.floor(minutes * 60_000)
  const ms = Number(process.env.ADMIN_STEP_UP_MFA_MAX_AGE_MS || "")
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms)
  return 12 * 60 * 60_000
}

export async function requireSensitiveAdminMfa(request: NextRequest, session?: ResolvedSession | null) {
  const auth = session ? { ok: true as const, session } : await requireAdminFullAuth(request)
  if (!auth.ok) return auth
  const policy = await getRuntimeSecurityPolicy().catch(() => null)
  if (policy?.mfaMode !== "enforce") return auth
  const subject = await resolveMfaSubject("admin", auth.session.userId)
  if (!subject) return auth
  const admin = await prisma.adminProfile.findUnique({ where: { id: subject.userId } }).catch(() => null)
  subject.phone = (admin as any)?.phoneVerified ? (admin as any)?.phone : subject.phone
  subject.phoneVerified = (admin as any)?.phoneVerified ?? subject.phoneVerified
  const settings = await ensureMfaSettings(subject)
  if (!hasUsableMfaMethod(subject, settings)) return auth
  if (!await hasDeliverableMfaMethod(subject, settings)) {
    void createPanelLog({
      category: "Auth",
      level: "warn",
      message: "admin_sensitive_mfa_skipped_delivery_unavailable",
      actorType: "admin",
      actorEmail: auth.session.email,
      metadata: { reason: "mfa_delivery_unavailable", path: request.nextUrl.pathname },
    }).catch(() => null)
    return auth
  }
  return requireRecentMfa(request, "admin", adminStepUpMfaMaxAgeMs())
}
