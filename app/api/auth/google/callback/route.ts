import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getSetting, type SecuritySettings } from "@/lib/settings"
import { issueClientSession, issueStaffSession } from "@/lib/auth-flows"
import { getAdminFromRequest, getClientFromRequest } from "@/lib/server-auth"
import {
  consumeOAuthState,
  exchangeGoogleCode,
  getGoogleOAuthConfig,
  upsertOAuthIdentity,
  validateGoogleRedirectUri,
  verifyGoogleIdToken,
  verifyOAuthState,
} from "@/lib/auth/google-oauth"
import { isGoogleOAuthLoginEnabled } from "@/lib/auth/google-oauth-toggle"

export const dynamic = "force-dynamic"

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url))
}

function cleanup(response: NextResponse) {
  response.cookies.delete("zws_google_oauth_nonce")
  response.cookies.delete("zws_google_oauth_verifier")
  return response
}

async function currentLinkedUser(request: NextRequest, role: "admin" | "client") {
  if (role === "admin") {
    const admin = await getAdminFromRequest(request).catch(() => null)
    return admin?.sub ? { userType: "admin" as const, userId: String(admin.sub) } : null
  }
  const client = await getClientFromRequest(request).catch(() => null)
  return client?.sub ? { userType: "customer" as const, userId: String(client.sub) } : null
}

export async function GET(request: NextRequest) {
  try {
    if (!await isGoogleOAuthLoginEnabled()) return cleanup(redirect(request, "/login?oauth=google_disabled"))
    const error = request.nextUrl.searchParams.get("error")
    if (error) return cleanup(redirect(request, `/login?oauth=${encodeURIComponent(error)}`))
    const code = String(request.nextUrl.searchParams.get("code") || "")
    const stateToken = String(request.nextUrl.searchParams.get("state") || "")
    const nonce = request.cookies.get("zws_google_oauth_nonce")?.value || ""
    const verifier = request.cookies.get("zws_google_oauth_verifier")?.value || ""
    const state = verifyOAuthState(stateToken, nonce)
    if (!code || !verifier || !state) return cleanup(redirect(request, "/login?oauth=invalid_state"))
    if (!await consumeOAuthState(stateToken)) return cleanup(redirect(request, "/login?oauth=state_replayed"))

    const config = await getGoogleOAuthConfig(request)
    if (!config.clientId || !config.clientSecret) return cleanup(redirect(request, "/login?oauth=google_not_configured"))
    const redirectValidation = validateGoogleRedirectUri(config.redirectUri, "/api/auth/google/callback", request)
    if (!redirectValidation.ok) {
      console.error("[google_oauth_redirect_uri_invalid]", redirectValidation)
      return cleanup(redirect(request, "/login?oauth=google_redirect_uri_invalid"))
    }

    const token = await exchangeGoogleCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier: verifier,
    })
    if (!token.id_token) return cleanup(redirect(request, "/login?oauth=missing_id_token"))
    const profile = await verifyGoogleIdToken(token.id_token, config.clientId, state.nonce)
    if (!profile.emailVerified) return cleanup(redirect(request, "/login?oauth=email_not_verified"))

    const existingIdentity = await (prisma as any).oAuthIdentity.findUnique({
      where: { provider_providerSubject: { provider: "google", providerSubject: profile.subject } },
    }).catch(() => null)

    const security = await getSetting<SecuritySettings>("security_settings")
    if (existingIdentity) {
      await (prisma as any).oAuthIdentity.update({
        where: { id: existingIdentity.id },
        data: { lastLoginAt: new Date(), email: profile.email, emailVerified: profile.emailVerified, displayName: profile.name, avatarUrl: profile.avatarUrl },
      }).catch(() => null)
      if (existingIdentity.userType === "admin") {
        const admin = await prisma.adminProfile.findUnique({ where: { id: existingIdentity.userId } })
        if (!admin?.isActive) return cleanup(redirect(request, "/login?oauth=admin_unavailable"))
        const session = await issueStaffSession(admin, security.sessionTimeoutMinutes, request)
        return cleanup(redirect(request, state.next || session.redirectTo || "/admin"))
      }
      const customer = await prisma.customer.findUnique({ where: { id: existingIdentity.userId } })
      if (!customer?.isActive) return cleanup(redirect(request, "/login?oauth=account_unavailable"))
      const session = await issueClientSession(customer, security.sessionTimeoutMinutes, request)
      return cleanup(redirect(request, state.next || session.redirectTo || "/client-area"))
    }

    const linkedUser = await currentLinkedUser(request, state.role)
    if (linkedUser) {
      await upsertOAuthIdentity({
        ...linkedUser,
        profile,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        scope: token.scope,
        expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null,
      })
      return cleanup(redirect(request, state.next || (state.role === "admin" ? "/admin/account-security" : "/client-area/security/mfa")))
    }

    if (state.role === "admin") {
      const admin = await prisma.adminProfile.findUnique({ where: { email: profile.email } })
      if (admin) return cleanup(redirect(request, "/login?oauth=link_required"))
      return cleanup(redirect(request, "/login?oauth=admin_link_required"))
    }

    const existingCustomer = await prisma.customer.findUnique({ where: { email: profile.email } })
    if (existingCustomer) return cleanup(redirect(request, "/login?oauth=link_required"))

    const customer = await prisma.customer.create({
      data: {
        email: profile.email,
        name: profile.name || profile.email.split("@")[0],
        hashedPassword: null,
        emailVerifiedAt: new Date(),
        isActive: true,
        status: "ACTIVE",
        metadata: { oauthSignupProvider: "google" } as any,
      },
    })
    await upsertOAuthIdentity({
      userType: "customer",
      userId: customer.id,
      profile,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scope: token.scope,
      expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000) : null,
    })
    const session = await issueClientSession(customer, security.sessionTimeoutMinutes, request)
    return cleanup(redirect(request, state.next || session.redirectTo || "/client-area"))
  } catch (error) {
    console.error("[google_oauth_callback_failed]", error)
    return cleanup(redirect(request, "/login?oauth=google_failed"))
  }
}
