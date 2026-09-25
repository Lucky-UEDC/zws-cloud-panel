import { cookies } from "next/headers"
import { cache } from "react"
import type { NextRequest } from "next/server"
import { resolveSession } from "@/lib/auth/session-store"
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { normalizeStaffRole, roleLabel, type StaffRole } from "@/lib/roles"

export type AdminTokenPayload = {
  sub?: string
  email?: string
  displayName?: string
  role?: string
}

export type ClientTokenPayload = {
  sub?: string
  email?: string
  name?: string
  role?: string
  status?: string
  emailVerifiedAt?: string | null
}

export type SessionUser =
  | {
      role: StaffRole
      email: string
      displayName: string
    }
  | {
      role: "client"
      id: string
      email: string
      name: string
      status?: string
      emailVerifiedAt?: string | null
}

export async function getAdminFromCookies() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAMES.admin)?.value || cookieStore.get(LEGACY_SESSION_COOKIE_NAMES.admin)?.value
  if (!token) return null
  const session = await resolveSession(token, "admin")
  if (session?.email && session.assuranceLevel === "FULLY_AUTHENTICATED") {
    return {
      sub: session.userId,
      email: session.email,
      displayName: session.displayName || "Admin",
      role: session.role,
    } as AdminTokenPayload
  }
  return null
}

export async function getClientFromCookies() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAMES.client)?.value || cookieStore.get(LEGACY_SESSION_COOKIE_NAMES.client)?.value
  if (!token) return null
  const session = await resolveSession(token, "client")
  if (session?.email && session.assuranceLevel === "FULLY_AUTHENTICATED") {
    return {
      sub: session.userId,
      email: session.email,
      name: session.name || "Client",
      role: "client",
      status: session.status || "ACTIVE",
      emailVerifiedAt: session.emailVerifiedAt || null,
    } as ClientTokenPayload
  }
  return null
}

export async function getAdminFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.admin)?.value
  if (!token) return null
  const session = await resolveSession(token, "admin")
  if (session?.email && session.assuranceLevel === "FULLY_AUTHENTICATED") {
    return {
      sub: session.userId,
      email: session.email,
      displayName: session.displayName || "Admin",
      role: session.role,
    } as AdminTokenPayload
  }
  return null
}

export async function getClientFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.client)?.value
  if (!token) return null
  const session = await resolveSession(token, "client")
  if (session?.email && session.assuranceLevel === "FULLY_AUTHENTICATED") {
    return {
      sub: session.userId,
      email: session.email,
      name: session.name || "Client",
      role: "client",
      status: session.status || "ACTIVE",
      emailVerifiedAt: session.emailVerifiedAt || null,
    } as ClientTokenPayload
  }
  return null
}

export async function getSessionFromCookies(): Promise<SessionUser | null> {
  const [admin, client] = await Promise.all([getAdminFromCookies(), getClientFromCookies()])

  if (admin?.email) {
    return {
      role: normalizeStaffRole(admin.role) || "admin",
      email: String(admin.email),
      displayName: String(admin.displayName || "Admin"),
    }
  }

  if (client?.email && client?.sub) {
    return {
      role: "client",
      id: String(client.sub),
      email: String(client.email),
      name: String(client.name || "Client"),
      status: String(client.status || "ACTIVE"),
      emailVerifiedAt: client.emailVerifiedAt || null,
    }
  }

  return null
}

/**
 * Request-scoped memoized variants for layouts / server components only.
 *
 * React `cache()` is safe here because layouts & RSC run inside a single
 * request scope, so the memo is per-request. Route handlers do NOT have a
 * request scope (the memo could leak across requests), so they must keep
 * using the plain functions above.
 */
export const getClientFromCookiesCached = cache(async () => getClientFromCookies())
export const getAdminFromCookiesCached = cache(async () => getAdminFromCookies())
export const getSessionFromCookiesCached = cache(async () => getSessionFromCookies())

export async function getCanonicalSessionUser(): Promise<SessionUser | null> {
  return getSessionFromCookies()
}

export function sessionUserResponse(user: SessionUser | null) {
  if (!user) return { authenticated: false as const, user: null }
  if (user.role === "client") {
    return {
      authenticated: true as const,
      session: { user: { role: "CUSTOMER" as const, canonicalRole: "client" as const, id: user.id, email: user.email, name: user.name } },
      user: {
        role: "client" as const,
        roleLabel: "CUSTOMER" as const,
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status || "ACTIVE",
        emailVerifiedAt: user.emailVerifiedAt || null,
      },
    }
  }
  return {
    authenticated: true as const,
    session: { user: { role: roleLabel(user.role), canonicalRole: user.role, email: user.email, displayName: user.displayName } },
    user: {
      role: user.role,
      roleLabel: roleLabel(user.role),
      email: user.email,
      displayName: user.displayName,
    },
  }
}
