import { NextRequest, NextResponse } from "next/server"
import { getLogoutRedirectPath, invalidateAuthForLogout } from "@/lib/logout"
import { createPanelLog } from "@/lib/panel-log"
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"

export async function GET(request: NextRequest) {
  const adminToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value
  const clientToken = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value
  const hasAdminToken = Boolean(adminToken)
  const hasClientToken = Boolean(clientToken)
  const redirectPath = getLogoutRedirectPath({ hasAdminToken, hasClientToken })
  const response = NextResponse.redirect(getRedirectUrl(request, redirectPath))
  await invalidateAuthForLogout({ request, response, endpoint: "/logout" }).catch(() => null)
  return response
}

export async function POST(request: NextRequest) {
  const adminToken = request.cookies.get(SESSION_COOKIE_NAMES.admin)?.value
  const clientToken = request.cookies.get(SESSION_COOKIE_NAMES.client)?.value
  const hasAdminToken = Boolean(adminToken)
  const hasClientToken = Boolean(clientToken)
  const redirectPath = getLogoutRedirectPath({ hasAdminToken, hasClientToken })
  const response = NextResponse.redirect(getRedirectUrl(request, redirectPath))

  await invalidateAuthForLogout({ request, response, endpoint: "/logout" }).catch(async (error) => {
    const message = error instanceof Error ? error.message : "Unknown logout error"
    console.error("logout_failed", { message })
    await createPanelLog({ category: "Auth", level: "warn", message: "logout_error", metadata: { message } }).catch(() => null)
  })
  await createPanelLog({ category: "Auth", message: "manual_logout", metadata: { endpoint: "/logout", method: "POST", redirectPath, hasAdminToken, hasClientToken } }).catch(() => null)
  return response
}

function getRedirectUrl(request: NextRequest, path: string) {
  const forwardedProto = request.headers.get("x-forwarded-proto")
  const forwardedHost = request.headers.get("x-forwarded-host")
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "") || "https"

  return new URL(path, `${protocol}://${host}`)
}
