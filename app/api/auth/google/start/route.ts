import { NextRequest, NextResponse } from "next/server"
import { createOAuthState, createPkcePair, getGoogleOAuthConfig, googleAuthUrl, googleRedirectDiagnostic, validateGoogleRedirectUri, type GoogleOAuthRole } from "@/lib/auth/google-oauth"
import { isGoogleOAuthLoginEnabled } from "@/lib/auth/google-oauth-toggle"

export const dynamic = "force-dynamic"

function role(value: string | null): GoogleOAuthRole {
  return value === "admin" ? "admin" : "client"
}

function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : ""
}

export async function GET(request: NextRequest) {
  if (!await isGoogleOAuthLoginEnabled()) {
    return NextResponse.json({ error: "Google login is disabled", code: "google_oauth_disabled" }, { status: 404 })
  }
  const requestedRole = role(request.nextUrl.searchParams.get("role"))
  const mode = request.nextUrl.searchParams.get("mode") === "link" ? "link" : "login"
  const next = safeNext(request.nextUrl.searchParams.get("next")) || (requestedRole === "admin" ? "/admin" : "/client-area")
  const config = await getGoogleOAuthConfig(request)
  if (!config.clientId || !config.clientSecret) {
    return NextResponse.redirect(new URL(`/login?oauth=google_not_configured`, request.url))
  }
  const redirectValidation = validateGoogleRedirectUri(config.redirectUri, "/api/auth/google/callback", request)
  if (!redirectValidation.ok) {
    return NextResponse.json({
      error: "Google OAuth redirect URI is not allowed.",
      code: "google_redirect_uri_invalid",
      redirectUri: redirectValidation.redirectUri,
      allowedRedirectUris: redirectValidation.allowed,
      requiredGoogleConsoleCallbacks: redirectValidation.allowed,
      diagnostic: googleRedirectDiagnostic("/api/auth/google/callback", request),
    }, { status: 500 })
  }

  const pkce = createPkcePair()
  const state = createOAuthState({ role: requestedRole, mode, next })
  const response = NextResponse.redirect(googleAuthUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    stateToken: state.token,
    nonce: state.state.nonce,
    codeChallenge: pkce.challenge,
  }))

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 10 * 60,
  }
  response.cookies.set("zws_google_oauth_nonce", state.state.nonce, cookieOptions)
  response.cookies.set("zws_google_oauth_verifier", pkce.verifier, cookieOptions)
  return response
}
