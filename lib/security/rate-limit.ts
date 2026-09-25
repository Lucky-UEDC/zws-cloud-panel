import type { SecurityContext } from "@/lib/security/abuse"
import { prisma } from "@/lib/db"
import { logSecurityEvent, logSuspiciousRequest, securityJson } from "@/lib/security/abuse"
import { getSystemSecuritySettings, isCloudflareRateLimitEnabled } from "@/lib/security/security-settings"

export type RateLimitOptions = {
  scope: string
  identifier?: string | null
  limit: number
  windowMs: number
  reason?: string
}

export async function checkSecurityRateLimit(ctx: SecurityContext, options: RateLimitOptions) {
  const settings = await getSystemSecuritySettings().catch(() => ({ enabled: false, mode: "OFF" as const, rateLimitEnabled: false }))
  if (!isCloudflareRateLimitEnabled(settings)) return { allowed: true as const, count: 0, disabled: true as const }

  const identifier = String(options.identifier || ctx.ip || "unknown").toLowerCase()
  const since = new Date(Date.now() - options.windowMs)
  const count = await (prisma as any).failedAttempt.count({
    where: {
      scope: options.scope,
      OR: [
        { identifier, createdAt: { gte: since } },
        ...(ctx.ip && ctx.ip !== "unknown" ? [{ ip: ctx.ip, createdAt: { gte: since } }] : []),
      ],
    },
  }).catch(() => 0)

  if (count >= options.limit) {
    await logSuspiciousRequest(ctx, "rate_limit_abuse", "warn", "rate_limited", {
      scope: options.scope,
      identifier,
      count,
      limit: options.limit,
      windowMs: options.windowMs,
    }, identifier)
    if (count >= options.limit + 2) await logSecurityEvent(ctx, "rate_limit_abuse_threshold", "warn", "logged", { scope: options.scope, identifier, count, limit: options.limit })
    await logSecurityEvent(ctx, "rate_limit_blocked", "warn", "rate_limited", {
      scope: options.scope,
      identifier,
      count,
      limit: options.limit,
      windowMs: options.windowMs,
    })
    const retryAfterSeconds = Math.ceil(options.windowMs / 1000)
    return {
      allowed: false as const,
      response: securityJson("rate_limited", "Too many requests. Please try again later.", 429, { retryAfterSeconds }),
      retryAfterSeconds,
    }
  }

  return { allowed: true as const, count }
}

export async function recordFailedAttempt(ctx: SecurityContext, options: { scope: string; identifier?: string | null; reason?: string; metadata?: Record<string, unknown> }) {
  await (prisma as any).failedAttempt.create({
    data: {
      scope: options.scope,
      identifier: String(options.identifier || ctx.ip || "unknown").toLowerCase(),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      route: ctx.route,
      method: ctx.method,
      reason: options.reason || null,
      deviceFingerprint: ctx.deviceFingerprint,
      metadata: options.metadata || {},
    },
  }).catch(() => null)
}
