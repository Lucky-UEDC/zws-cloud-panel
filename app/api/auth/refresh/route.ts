import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAMES, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session-cookies"
import { SESSION_EXPIRED_CODE, SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expired-response"
import { renewSession } from "@/lib/auth/session-store"
import { createPanelLog } from "@/lib/panel-log"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

function sessionScope(request: NextRequest) {
  const adminToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value
  if (adminToken) return { token: adminToken, expected: "admin" as const, cookieName: SESSION_COOKIE_NAMES.admin }
  const clientToken = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value
  if (clientToken) return { token: clientToken, expected: "client" as const, cookieName: SESSION_COOKIE_NAMES.client }
  return null
}

export async function POST(request: NextRequest) {
  const scope = sessionScope(request)
  if (!scope) {
    await createPanelLog({
      category: "Auth",
      level: "warn",
      message: "auth_session_refresh_failed",
      metadata: { endpoint: "/api/auth/refresh", reason: "missing_token" },
    }).catch(() => null)
    return json({ success: false, authenticated: false, code: SESSION_EXPIRED_CODE, error: SESSION_EXPIRED_MESSAGE }, 401)
  }

  const result = await renewSession(scope.token, scope.expected)
  if (result.status === "unavailable") {
    await createPanelLog({
      category: "Auth",
      level: "warn",
      message: "auth_session_refresh_retryable",
      metadata: { endpoint: "/api/auth/refresh", reason: result.reason, message: result.message },
    }).catch(() => null)
    return json({
      success: false,
      authenticated: false,
      retryable: true,
      code: "session_refresh_unavailable",
      error: "Session refresh is temporarily unavailable.",
    }, 503)
  }

  if (result.status === "invalid") {
    await createPanelLog({
      category: "Auth",
      level: "warn",
      message: "auth_session_refresh_failed",
      metadata: { endpoint: "/api/auth/refresh", reason: result.reason, expected: scope.expected },
    }).catch(() => null)
    return json({ success: false, authenticated: false, code: SESSION_EXPIRED_CODE, error: SESSION_EXPIRED_MESSAGE }, 401)
  }

  const response = json({
    success: true,
    authenticated: true,
    refreshed: true,
    role: result.session.role,
    expiresAt: result.expiresAt.toISOString(),
    expiresInSeconds: result.expiresInSeconds,
  })
  response.cookies.set(scope.cookieName, scope.token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: result.expiresInSeconds,
  })
  return response
}
