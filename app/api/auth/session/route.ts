import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { sessionUserResponse, type SessionUser } from "@/lib/server-auth"
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { resolveSessionResult } from "@/lib/auth/session-store"
import { normalizeStaffRole } from "@/lib/roles"
import { createPanelLog } from "@/lib/panel-log"

function userFromResolved(session: Awaited<ReturnType<typeof resolveSessionResult>>): SessionUser | null {
  if (session.status !== "valid") return null
  if (session.session.role === "client") {
    return {
      role: "client",
      id: session.session.userId,
      email: session.session.email,
      name: session.session.name || "Client",
      status: session.session.status || "ACTIVE",
      emailVerifiedAt: session.session.emailVerifiedAt || null,
    }
  }
  return {
    role: normalizeStaffRole(session.session.role) || "admin",
    email: session.session.email,
    displayName: session.session.displayName || "Admin",
  }
}

export async function GET(request: NextRequest) {
  try {
    const adminToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.admin)?.value
    const clientToken = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value || request.cookies.get(LEGACY_SESSION_COOKIE_NAMES.client)?.value
    const admin = adminToken ? await resolveSessionResult(adminToken, "admin") : null
    if (admin?.status === "unavailable") {
      throw new Error(admin.message)
    }
    const client = !adminToken && clientToken ? await resolveSessionResult(clientToken, "client") : null
    if (client?.status === "unavailable") {
      throw new Error(client.message)
    }
    const session = userFromResolved(admin || client || { status: "invalid", reason: "missing_token" })
    if (!session) {
      if (request.nextUrl.searchParams.get("optional") === "1") {
        return NextResponse.json({ authenticated: false }, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        })
      }
      await createPanelLog({ category: "Auth", level: "warn", message: "auth_failed", metadata: { endpoint: "/api/auth/session" } }).catch(() => null)
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    await createPanelLog({ category: "Auth", message: "auth_confirmed", actorType: session.role === "client" ? "customer" : "admin", actorEmail: String(session.email), metadata: { endpoint: "/api/auth/session", role: session.role } }).catch(() => null)
    return NextResponse.json(sessionUserResponse(session), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    })
  } catch (error) {
    await createPanelLog({
      category: "Auth",
      level: "warn",
      message: "auth_session_check_error",
      metadata: { endpoint: "/api/auth/session", message: error instanceof Error ? error.message : String(error) },
    }).catch(() => null)
    return NextResponse.json(
      {
        authenticated: false,
        retryable: true,
        error: "Session check is temporarily unavailable.",
      },
      { status: 503 },
    )
  }
}
