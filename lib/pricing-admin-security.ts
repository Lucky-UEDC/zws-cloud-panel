import { NextRequest, NextResponse } from "next/server"
import { getRedisClient } from "@/lib/redis"
import { isSuperAdmin } from "@/lib/admin-rbac"
import { writeAuditLog } from "@/lib/audit-log"
import { requireAdminFullAuth, requireRecentMfa, requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { prisma } from "@/lib/db"
import { ensureMfaSettings, hasUsableMfaMethod } from "@/lib/auth/mfa/settings"
import type { MfaSubject } from "@/lib/auth/mfa/types"
import { getRuntimeSecurityPolicy } from "@/lib/security-policy"
import { extractClientIp } from "@/lib/request-context"

function clientIp(request: NextRequest) {
  return extractClientIp(request)
}

async function rateLimit(request: NextRequest) {
  const redis = getRedisClient()
  if (!redis) return true
  try {
    await redis.connect().catch(() => undefined)
    const key = `pricing-admin:rate:${clientIp(request)}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 60)
    return count <= 60
  } catch {
    return true
  }
}

function adminSubjectFromSession(session: any, admin: any): MfaSubject {
  return {
    userType: "admin",
    userId: session.userId,
    role: session.role,
    email: session.email,
    name: admin?.displayName || session.displayName || "Admin",
    phone: admin?.phoneVerified ? admin?.phone : null,
    phoneVerified: admin?.phoneVerified,
    hashedPassword: admin?.hashedPassword || null,
    legacyTotpEnabled: admin?.twoFactorEnabled,
    legacyTotpSecret: admin?.twoFactorSecret,
    legacyBackupCodes: admin?.twoFactorBackupCodes,
  }
}

async function basePricingAdmin(request: NextRequest) {
  const auth = await requireAdminFullAuth(request)
  if (!auth.ok) return { response: auth.response }
  const admin = {
    sub: auth.session.userId,
    email: auth.session.email,
    role: auth.session.role,
  }
  const ipAddress = clientIp(request)
  const userAgent = request.headers.get("user-agent") || null

  async function deny(message: string, status: number, action = "PRICING_ADMIN_DENIED") {
    await writeAuditLog({
      action,
      actorEmail: admin?.email || null,
      adminId: admin?.sub || null,
      targetType: "pricing",
      metadata: { message, path: request.nextUrl.pathname, method: request.method },
      ipAddress,
      userAgent,
    })
    return NextResponse.json({ error: message }, { status })
  }

  if (!await rateLimit(request)) return { response: await deny("Too many pricing admin requests.", 429, "PRICING_ADMIN_RATE_LIMITED") }
  if (!admin?.email || !admin.sub || !isSuperAdmin(admin.role)) return { response: await deny("Unauthorized", 401) }
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return { response: await deny("Invalid request origin.", 403, "PRICING_ADMIN_BAD_ORIGIN") }

  return { admin, ipAddress, userAgent, session: auth.session }
}

export async function requirePricingAdminRead(request: NextRequest) {
  return basePricingAdmin(request)
}

export async function requirePricingAdminMutation(request: NextRequest) {
  const base = await basePricingAdmin(request)
  if ("response" in base) return base
  const policy = await getRuntimeSecurityPolicy()
  if (!policy.mfaEnforcementEnabled) return base
  const adminRow = await prisma.adminProfile.findUnique({ where: { id: base.admin.sub } }).catch(() => null)
  const subject = adminSubjectFromSession(base.session, adminRow)
  const settings = await ensureMfaSettings(subject)
  if (!hasUsableMfaMethod(subject, settings)) return base

  const recent = await requireRecentMfa(request, "admin")
  if (!recent.ok) return { response: recent.response }
  return base
}

export const requirePricingAdmin = requirePricingAdminMutation

export async function getPricingAdminMfaState(request: NextRequest) {
  const base = await basePricingAdmin(request)
  if ("response" in base) return base
  const adminRow = await prisma.adminProfile.findUnique({ where: { id: base.admin.sub } }).catch(() => null)
  const subject = adminSubjectFromSession(base.session, adminRow)
  const settings = await ensureMfaSettings(subject)
  const policy = await getRuntimeSecurityPolicy()
  return {
    ...base,
    mfaConfigured: hasUsableMfaMethod(subject, settings),
    mfaEnforcementEnabled: policy.mfaEnforcementEnabled,
    mfaMode: policy.mfaMode,
    mfa: {
      defaultMethod: settings.defaultMethod,
      totpEnabled: Boolean(settings.totpEnabled && settings.totpSecretEncrypted),
      emailEnabled: Boolean(settings.emailFallbackEnabled),
      whatsappEnabled: Boolean(settings.whatsappEnabled && subject.phone),
      recoveryCodesEnabled: Boolean(settings.recoveryCodesEnabled),
      lastVerifiedAt: base.session.mfaVerifiedAt || null,
    },
  }
}
