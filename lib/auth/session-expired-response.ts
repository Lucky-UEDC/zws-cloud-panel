import { NextResponse } from "next/server"
import { ALL_AUTH_COOKIE_NAMES, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session-cookies"
import { safeJson } from "@/lib/safe-json"

export const SESSION_EXPIRED_MESSAGE = "Session expired. Please login again."
export const SESSION_EXPIRED_CODE = "session_expired"

export function clearAuthCookies(response: NextResponse) {
  for (const name of ALL_AUTH_COOKIE_NAMES) {
    response.cookies.set(name, "", {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: 0,
      expires: new Date(0),
    })
  }
  return response
}

export function sessionExpiredJson(status = 401) {
  const response = NextResponse.json(
    safeJson({
      success: false,
      authenticated: false,
      code: SESSION_EXPIRED_CODE,
      error: SESSION_EXPIRED_MESSAGE,
      message: SESSION_EXPIRED_MESSAGE,
    }),
    { status },
  )
  return clearAuthCookies(response)
}
