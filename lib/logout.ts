import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { ALL_AUTH_COOKIE_NAMES, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session-cookies"
import { resolveSession, revokeSession, revokeSessionsForUser } from "@/lib/auth/session-store"
import { prisma } from "@/lib/db"
import { getSetting, type SecuritySettings } from "@/lib/settings"
import { clearTrustedDeviceCookie } from "@/lib/auth/mfa/trusted-devices"

export const AUTH_COOKIE_NAMES = [
  ...ALL_AUTH_COOKIE_NAMES,
  "remember_me",
  "rememberMe",
  "remember_token",
  "refresh_token",
  "auth_token",
] as const

export function clearAuthCookies(response: NextResponse) {
  for (const name of AUTH_COOKIE_NAMES) {
    response.cookies.set(name, "", {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 0,
      expires: new Date(0),
    })
  }
  response.headers.set("Clear-Site-Data", '"cache", "storage"')
  response.headers.set("X-ZWS-Auth-Invalidated", "1")
}

export function getLogoutRedirectPath(input: {
  hasAdminToken: boolean
  hasClientToken: boolean
}) {
  if (input.hasAdminToken || input.hasClientToken) {
    return "/login"
  }

  return "/"
}

async function logoutScope() {
  const settings = await getSetting<SecuritySettings>("security_settings").catch(() => null)
  const value = String((settings as any)?.logoutScope || process.env.AUTH_LOGOUT_SCOPE || "current")
  return value === "all" ? "all" : "current"
}

function userTypeForRole(role?: string | null) {
  return role === "client" ? "customer" : "admin"
}

export async function revokeAllAuthStateForUser(input: {
  userId: string
  role?: string | null
  userType?: "admin" | "customer" | string | null
}) {
  const userType = input.userType || userTypeForRole(input.role)
  await Promise.all([
    revokeSessionsForUser(input.userId, input.role || undefined).catch(() => null),
    (prisma as any).userLoginSession.updateMany({
      where: { userType, userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => null),
    prisma.authChallenge.deleteMany({ where: { userType, userId: input.userId } }).catch(() => null),
    (prisma as any).userTrustedDevice.updateMany({
      where: { userType, userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => null),
    (prisma as any).oAuthIdentity.updateMany({
      where: { userType, userId: input.userId },
      data: {
        refreshTokenHash: null,
        refreshTokenEncrypted: null,
        accessTokenHash: null,
        accessTokenEncrypted: null,
        tokenExpiresAt: null,
      },
    }).catch(() => null),
  ])
}

export async function invalidateAuthForLogout(input: {
  request: NextRequest
  response: NextResponse
  adminOnly?: boolean
  scope?: "current" | "all"
  endpoint?: string
}) {
  const adminToken = input.request.cookies.get("__Host-admin_token")?.value || input.request.cookies.get("admin_token")?.value
  const clientToken = input.request.cookies.get("__Host-client_token")?.value || input.request.cookies.get("client_token")?.value
  const scope = input.scope || await logoutScope()
  const tokens = input.adminOnly ? [adminToken] : [adminToken, clientToken, input.request.cookies.get("remember_token")?.value, input.request.cookies.get("refresh_token")?.value]
  const sessions = await Promise.all(tokens.map(async (token) => token ? resolveSession(token).catch(() => null) : null))

  await Promise.all(tokens.map((token) => revokeSession(token))).catch(() => null)

  if (scope === "all") {
    await Promise.all(sessions.filter(Boolean).map((session: any) => revokeAllAuthStateForUser({
      userId: session.userId,
      role: session.role,
      userType: userTypeForRole(session.role),
    }))).catch(() => null)
  }

  await Promise.all(sessions.filter(Boolean).map((session: any) => prisma.authChallenge.deleteMany({
    where: { userType: userTypeForRole(session.role), userId: session.userId },
  }).catch(() => null))).catch(() => null)

  clearAuthCookies(input.response)
  clearTrustedDeviceCookie(input.response)
  return {
    scope,
    hasAdminToken: Boolean(adminToken),
    hasClientToken: Boolean(clientToken),
    revokedUsers: sessions.filter(Boolean).map((session: any) => ({ userId: session.userId, role: session.role })),
  }
}
