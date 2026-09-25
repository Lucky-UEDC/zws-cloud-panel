import type { NextRequest } from "next/server"
import { assertNotBlocked, getSecurityContext, rejectDetectedPayload, type SecurityContext } from "@/lib/security/abuse"
import { checkSecurityRateLimit, recordFailedAttempt } from "@/lib/security/rate-limit"
import { verifyTurnstileToken } from "@/lib/security/turnstile"
import { detectPayload } from "@/lib/security/input"
import type { TurnstileSurface } from "@/lib/security/security-settings"

export async function securityGate(request: NextRequest) {
  const ctx = await getSecurityContext(request)
  const blocked = await assertNotBlocked(ctx)
  if (!blocked.ok) return { ok: false as const, ctx, response: blocked.response }
  return { ok: true as const, ctx }
}

export async function requireTurnstile(ctx: SecurityContext, token: unknown, surface: TurnstileSurface) {
  return verifyTurnstileToken(ctx, token, surface)
}

export async function requireRateLimit(ctx: SecurityContext, scope: string, limit: number, windowMs: number, identifier?: string | null) {
  const rate = await checkSecurityRateLimit(ctx, { scope, limit, windowMs, identifier })
  if (!rate.allowed) return { ok: false as const, response: rate.response }
  return { ok: true as const }
}

export async function markAttempt(ctx: SecurityContext, scope: string, identifier?: string | null, reason?: string) {
  await recordFailedAttempt(ctx, { scope, identifier, reason })
}

export async function rejectIfPayload(ctx: SecurityContext, value: unknown, field: string) {
  const detection = detectPayload(value)
  if (!detection.dangerous) return { ok: true as const, detection }
  return { ok: false as const, response: await rejectDetectedPayload(ctx, detection, field), detection }
}
