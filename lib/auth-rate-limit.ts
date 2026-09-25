import type { SecuritySettings } from "@/lib/settings"
import { prisma } from "@/lib/db"

function getKey(scope: string, email: string, ip: string | null) {
  return `${scope}:${String(email || "").toLowerCase()}:${ip || "unknown"}`
}

function getIpKey(scope: string, ip: string | null) {
  return `${scope}:ip:${ip || "unknown"}`
}

// Per-IP brute-force cap: 20 failed attempts per IP per hour regardless of email
const IP_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const IP_RATE_LIMIT_MAX_ATTEMPTS = 20

export async function checkIpRateLimit(scope: "admin" | "client", ip: string | null) {
  if (!ip || ip === "unknown") return { allowed: true }
  const windowStart = new Date(Date.now() - IP_RATE_LIMIT_WINDOW_MS)
  const identifier = getIpKey(scope, ip)
  const failedAttempts = await (prisma as any).failedAttempt.count({
    where: {
      scope: `login:${scope}`,
      ip,
      createdAt: { gte: windowStart },
    },
  }).catch(() => 0)
  if (failedAttempts >= IP_RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil(IP_RATE_LIMIT_WINDOW_MS / 1000) }
  }
  return { allowed: true }
}

export async function checkLoginRateLimit(
  scope: "admin" | "client",
  email: string,
  ip: string | null,
  security: SecuritySettings,
) {
  // Per-IP check first (blocks credential stuffing from a single IP)
  const ipCheck = await checkIpRateLimit(scope, ip)
  if (!ipCheck.allowed) {
    return { allowed: false, retryAfterSeconds: ipCheck.retryAfterSeconds ?? 3600 }
  }

  const windowMs = Math.max(1, Number(security.lockoutDurationMinutes || 60)) * 60 * 1000
  const windowStart = new Date(Date.now() - windowMs)
  const identifier = getKey(scope, email, ip)
  const failedAttempts = await (prisma as any).failedAttempt.count({
    where: {
      scope: `login:${scope}`,
      identifier,
      createdAt: { gte: windowStart },
    },
  }).catch(() => 0)

  if (failedAttempts >= Number(security.maxLoginAttempts || 5)) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

export async function markLoginResult(
  scope: "admin" | "client",
  email: string,
  ip: string | null,
  success: boolean,
  security: SecuritySettings,
  metadata: Record<string, unknown> = {},
) {
  const identifier = getKey(scope, email, ip)
  if (success) {
    await (prisma as any).failedAttempt.deleteMany({
      where: { scope: `login:${scope}`, identifier },
    }).catch(() => null)
    return
  }

  await (prisma as any).failedAttempt.create({
    data: {
      scope: `login:${scope}`,
      identifier,
      ip,
      reason: "invalid_login",
      metadata: {
        maxLoginAttempts: security.maxLoginAttempts,
        lockoutDurationMinutes: security.lockoutDurationMinutes,
        ...metadata,
      },
    },
  }).catch(() => null)
}
