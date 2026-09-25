import type { SecurityContext } from "@/lib/security/abuse"
import { prisma } from "@/lib/db"
import { logSecurityEvent, logSuspiciousRequest, securityJson } from "@/lib/security/abuse"
import { getSystemSecuritySettings, isCloudflareCaptchaRequired, isCloudflareWhitelisted, type TurnstileSurface } from "@/lib/security/security-settings"

type TurnstileResponse = {
  success?: boolean
  "error-codes"?: string[]
  challenge_ts?: string
  hostname?: string
  action?: string
}

type TurnstileVerificationOptions = {
  blockOnFailure?: boolean
  expectedAction?: string
}

function turnstileDebug(event: string, detail: Record<string, unknown>) {
  if (process.env.SECURITY_AUTH_DEBUG !== "1") return
  console.info("[TURNSTILE_DEBUG]", event, detail)
}

async function maybeBlockCaptchaAbuse(ctx: SecurityContext, reason: string) {
  const since = new Date(Date.now() - 60 * 60_000)
  const or: Record<string, string>[] = []
  if (ctx.ip && ctx.ip !== "unknown") or.push({ ip: ctx.ip })
  if (ctx.deviceFingerprint) or.push({ deviceFingerprint: ctx.deviceFingerprint })
  if (!or.length) return
  const count = await (prisma as any).suspiciousRequest.count({
    where: {
      reason: { in: ["captcha_missing", "captcha_failed", "captcha_replay"] },
      createdAt: { gte: since },
      OR: or,
    },
  }).catch(() => 0)

  if (count >= 5) {
    await logSecurityEvent(ctx, "captcha_abuse_threshold", "warn", "logged", { reason, count, windowMs: 60 * 60_000 })
  }
}

export async function verifyTurnstileWithSecret(input: {
  secret: string
  token: unknown
  remoteIp?: string | null
}) {
  const value = String(input.token || "").trim()
  if (!value) return { ok: false as const, data: null as TurnstileResponse | null, errors: ["missing-input-response"] }

  const form = new FormData()
  form.set("secret", input.secret)
  form.set("response", value)
  if (input.remoteIp && input.remoteIp !== "unknown") form.set("remoteip", input.remoteIp)

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (!response?.ok) {
    return { ok: false as const, data: null as TurnstileResponse | null, errors: ["provider_error"], status: response?.status || null }
  }

  const data = await response.json().catch(() => ({} as TurnstileResponse)) as TurnstileResponse
  return {
    ok: Boolean(data.success),
    data,
    errors: data["error-codes"] || [],
    status: response.status,
  }
}

export async function verifyTurnstileToken(ctx: SecurityContext, token: unknown, surface: TurnstileSurface) {
  return verifyTurnstileTokenWithOptions(ctx, token, surface)
}

export async function verifyTurnstileTokenWithOptions(
  ctx: SecurityContext,
  token: unknown,
  surface: TurnstileSurface,
  options: TurnstileVerificationOptions = {},
) {
  const settings = await getSystemSecuritySettings()
  if (!isCloudflareCaptchaRequired(settings, surface)) {
    await logSecurityEvent(ctx, "captcha_disabled", "info", "allowed", { surface })
    return { ok: true as const, skipped: true as const }
  }

  if (await isCloudflareWhitelisted(ctx)) {
    await logSecurityEvent(ctx, "cloudflare_whitelist_bypass", "info", "allowed", { surface, reason: "trusted_ip_or_cidr" })
    return { ok: true as const, skipped: true as const, whitelisted: true as const }
  }

  const secret = settings.turnstileSecretKey
  const value = String(token || "").trim()
  const blockOnFailure = options.blockOnFailure !== false
  turnstileDebug("prepared", {
    surface,
    tokenPresent: Boolean(value),
    secretPresent: Boolean(secret),
    expectedAction: options.expectedAction || null,
  })

  if (!value) {
    await logSecurityEvent(ctx, "captcha_missing", "warn", "denied", { surface })
    await logSuspiciousRequest(ctx, "captcha_missing", "warn", "denied", { surface })
    if (blockOnFailure) await maybeBlockCaptchaAbuse(ctx, "captcha_missing")
    return { ok: false as const, code: "captcha_required" as const, response: securityJson("captcha_required", "Security verification is required.", 403, { reason: "Captcha token missing.", ip: ctx.ip, page: ctx.route, ruleTriggered: "turnstile_required" }) }
  }

  if (!secret) {
    await logSecurityEvent(ctx, "captcha_not_configured", "error", "denied", { surface })
    return { ok: false as const, code: "captcha_not_configured" as const, response: securityJson("captcha_not_configured", "Security verification is not configured.", 503, { reason: "Turnstile secret key missing.", ip: ctx.ip, page: ctx.route, ruleTriggered: "turnstile_configuration" }) }
  }

  const result = await verifyTurnstileWithSecret({ secret, token: value, remoteIp: ctx.ip })
  const metadata = {
    errors: result.errors,
    status: result.status || null,
    surface,
    hostname: result.data?.hostname || null,
    action: result.data?.action || null,
    challengeTs: result.data?.challenge_ts || null,
  }
  turnstileDebug("provider_response", {
    success: result.ok,
    ...metadata,
  })

  if (result.errors.includes("provider_error")) {
    await logSecurityEvent(ctx, "captcha_provider_error", "error", "denied", metadata)
    await logSuspiciousRequest(ctx, "captcha_provider_error", "error", "denied", metadata)
    return { ok: false as const, code: "captcha_provider_error" as const, errors: result.errors, response: securityJson("captcha_provider_error", "Security verification provider is temporarily unavailable.", 503, { errors: result.errors, reason: "Turnstile provider unavailable.", ip: ctx.ip, page: ctx.route, ruleTriggered: "turnstile_provider" }) }
  }

  if (!result.ok) {
    const code = result.errors.includes("timeout-or-duplicate")
      ? "captcha_expired"
      : result.errors.includes("invalid-input-secret")
        ? "captcha_invalid_secret"
        : result.errors.includes("invalid-input-response") || result.errors.includes("missing-input-response")
          ? "captcha_invalid_token"
          : "captcha_failed"
    const reason = code === "captcha_expired" ? "captcha_replay" : "captcha_failed"
    await logSecurityEvent(ctx, reason, "warn", "denied", metadata)
    await logSuspiciousRequest(ctx, reason, "warn", "denied", metadata)
    if (blockOnFailure) await maybeBlockCaptchaAbuse(ctx, reason)
    return { ok: false as const, code, errors: result.errors, response: securityJson(code, "Security verification failed.", 403, { errors: result.errors, reason: "Captcha validation failed.", ip: ctx.ip, page: ctx.route, ruleTriggered: "turnstile_validation" }) }
  }

  if (options.expectedAction && result.data?.action && result.data.action !== options.expectedAction) {
    await logSecurityEvent(ctx, "captcha_action_mismatch", "warn", "denied", metadata)
    await logSuspiciousRequest(ctx, "captcha_action_mismatch", "warn", "denied", metadata)
    return { ok: false as const, code: "captcha_invalid_token" as const, errors: ["action-mismatch"], response: securityJson("captcha_invalid_token", "Security verification failed.", 403, { errors: ["action-mismatch"], reason: "Captcha action mismatch.", ip: ctx.ip, page: ctx.route, ruleTriggered: "turnstile_action" }) }
  }

  await logSecurityEvent(ctx, "captcha_verified", "info", "allowed", metadata)
  return { ok: true as const, data: result.data }
}
