import crypto from "node:crypto"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { prisma } from "@/lib/db"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { getBaseUrl } from "@/lib/runtime-site-url"
import { getRedisClient } from "@/lib/redis"
import { encryptSecretValue } from "@/lib/secret-crypto"

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"])
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))
const consumedStates = new Map<string, number>()

export type GoogleOAuthRole = "client" | "admin"

export type GoogleOAuthState = {
  nonce: string
  role: GoogleOAuthRole
  next?: string | null
  mode?: "login" | "link"
  issuedAt: number
}

export type VerifiedGoogleProfile = {
  subject: string
  email: string
  emailVerified: boolean
  name: string | null
  avatarUrl: string | null
}

function authSecret() {
  const secret = process.env.AUTH_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("A session/JWT secret is required for OAuth state signing.")
  return secret
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url")
}

function sha256Base64Url(input: string) {
  return base64url(crypto.createHash("sha256").update(input).digest())
}

function hmac(input: string) {
  return base64url(crypto.createHmac("sha256", authSecret()).update(input).digest())
}

function safeNext(value?: string | null) {
  const next = String(value || "")
  return next.startsWith("/") && !next.startsWith("//") ? next : ""
}

function cleanOrigin(value: unknown) {
  const raw = String(value || "").trim().replace(/\/+$/, "")
  const text = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw
  if (!text) return ""
  try {
    const url = new URL(text)
    if (process.env.NODE_ENV === "production" && /^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/i.test(url.host)) return ""
    return `${url.protocol}//${url.host}`
  } catch {
    return ""
  }
}

function cleanCallback(value: unknown) {
  const text = String(value || "").trim()
  if (!text) return ""
  try {
    const url = new URL(text)
    url.hash = ""
    url.search = ""
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}

function requestOrigin(request?: Request | { headers?: Headers | null } | null) {
  const configured = cleanOrigin(process.env.NEXT_PUBLIC_APP_URL) || cleanOrigin(process.env.APP_URL)
  return configured || cleanOrigin(getBaseUrl(request || null))
}

export function googleCallbackUrlForPath(path: string, request?: Request | { headers?: Headers | null } | null) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${requestOrigin(request || null)}${normalizedPath}`.replace(/\/+$/, "")
}

export function googleCallbackUrl(request?: Request | { headers?: Headers | null } | null) {
  return googleCallbackUrlForPath("/api/auth/google/callback", request || null)
}

export function googleDriveCallbackUrl(request?: Request | { headers?: Headers | null } | null) {
  return googleCallbackUrlForPath("/api/admin/backups/google/callback", request || null)
}

export function allowedGoogleRedirectUris(path: "/api/auth/google/callback" | "/api/admin/backups/google/callback", request?: Request | { headers?: Headers | null } | null) {
  return [googleCallbackUrlForPath(path, request || null)].map(cleanCallback).filter(Boolean)
}

export function googleRedirectDiagnostic(path: "/api/auth/google/callback" | "/api/admin/backups/google/callback", request?: Request | { headers?: Headers | null } | null) {
  const headers = request?.headers || null
  const baseUrl = requestOrigin(request || null)
  const generatedCallback = googleCallbackUrlForPath(path, request || null)
  return {
    baseUrl,
    generatedCallback,
    expectedCallbacks: [generatedCallback],
    googleConsoleInstruction: "Add this exact Authorized redirect URI in Google Cloud Console for the OAuth client.",
    requestHeaders: {
      "x-forwarded-host": headers?.get("x-forwarded-host") || null,
      "x-forwarded-proto": headers?.get("x-forwarded-proto") || null,
      host: headers?.get("host") || null,
    },
  }
}

export function validateGoogleRedirectUri(redirectUri: string, path: "/api/auth/google/callback" | "/api/admin/backups/google/callback", request?: Request | { headers?: Headers | null } | null) {
  const normalized = cleanCallback(redirectUri)
  const allowed = allowedGoogleRedirectUris(path, request || null)
  return {
    ok: Boolean(normalized && allowed.includes(normalized)),
    redirectUri: normalized,
    allowed,
    expectedPath: path,
  }
}

export async function getGoogleOAuthConfig(request?: Request | { headers?: Headers | null } | null) {
  const runtime = await getServiceIntegrationConfig("googleOAuth").catch(() => ({} as Record<string, unknown>))
  const clientId = String(runtime.clientId || process.env.GOOGLE_CLIENT_ID || "").trim()
  const clientSecret = String(runtime.clientSecret || process.env.GOOGLE_CLIENT_SECRET || "").trim()
  const requestCallback = googleCallbackUrl(request || null)
  const redirectUri = requestCallback
  return { clientId, clientSecret, redirectUri }
}

export function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(32))
  return { verifier, challenge: sha256Base64Url(verifier) }
}

export function createOAuthState(input: Omit<GoogleOAuthState, "nonce" | "issuedAt">) {
  const state: GoogleOAuthState = {
    role: input.role,
    next: safeNext(input.next),
    mode: input.mode || "login",
    nonce: base64url(crypto.randomBytes(18)),
    issuedAt: Date.now(),
  }
  const payload = base64url(JSON.stringify(state))
  return { state, token: `${payload}.${hmac(payload)}` }
}

export function verifyOAuthState(token: string, expectedNonce: string) {
  const [payload, signature] = String(token || "").split(".")
  if (!payload || !signature || hmac(payload) !== signature) return null
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GoogleOAuthState
  if (parsed.nonce !== expectedNonce) return null
  if (Date.now() - Number(parsed.issuedAt || 0) > 10 * 60_000) return null
  if (parsed.role !== "admin" && parsed.role !== "client") return null
  return { ...parsed, next: safeNext(parsed.next), mode: parsed.mode === "link" ? "link" : "login" }
}

export async function consumeOAuthState(token: string) {
  const stateHash = hashOAuthToken(token)
  if (!stateHash) return false
  const key = `oauth:google:state:${stateHash}`
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.connect().catch(() => undefined)
      const result = await redis.set(key, "1", "EX", 10 * 60, "NX")
      return result === "OK"
    } catch {
      // Fall through to process-local replay protection if Redis is temporarily unavailable.
    }
  }
  const now = Date.now()
  for (const [hash, expiresAt] of consumedStates) {
    if (expiresAt <= now) consumedStates.delete(hash)
  }
  if (consumedStates.has(stateHash)) return false
  consumedStates.set(stateHash, now + 10 * 60_000)
  return true
}

export function googleAuthUrl(input: {
  clientId: string
  redirectUri: string
  stateToken: string
  nonce: string
  codeChallenge: string
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: input.stateToken,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account",
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeGoogleCode(input: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  codeVerifier: string
}) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.codeVerifier,
    }),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status}`)
  return await response.json() as { id_token?: string; access_token?: string; refresh_token?: string; scope?: string; expires_in?: number }
}

export async function verifyGoogleIdToken(idToken: string, clientId: string, nonce: string): Promise<VerifiedGoogleProfile> {
  const verified = await jwtVerify(idToken, GOOGLE_JWKS, { audience: clientId })
  const payload = verified.payload as any
  if (!GOOGLE_ISSUERS.has(String(payload.iss || ""))) throw new Error("Invalid Google token issuer.")
  if (String(payload.nonce || "") !== nonce) throw new Error("Invalid Google token nonce.")
  const email = String(payload.email || "").trim().toLowerCase()
  if (!email) throw new Error("Google account did not include an email address.")
  return {
    subject: String(payload.sub || ""),
    email,
    emailVerified: Boolean(payload.email_verified),
    name: payload.name ? String(payload.name) : null,
    avatarUrl: payload.picture ? String(payload.picture) : null,
  }
}

export function hashOAuthToken(value?: string | null) {
  const text = String(value || "")
  return text ? crypto.createHash("sha256").update(text).digest("hex") : null
}

export async function upsertOAuthIdentity(input: {
  userType: "admin" | "customer"
  userId: string
  profile: VerifiedGoogleProfile
  accessToken?: string | null
  refreshToken?: string | null
  scope?: string | null
  expiresAt?: Date | string | null
}) {
  const accessTokenEncrypted = input.accessToken ? encryptSecretValue(input.accessToken) : null
  const refreshTokenEncrypted = input.refreshToken ? encryptSecretValue(input.refreshToken) : null
  return (prisma as any).oAuthIdentity.upsert({
    where: { provider_providerSubject: { provider: "google", providerSubject: input.profile.subject } },
    create: {
      provider: "google",
      providerSubject: input.profile.subject,
      userType: input.userType,
      userId: input.userId,
      email: input.profile.email,
      emailVerified: input.profile.emailVerified,
      displayName: input.profile.name,
      avatarUrl: input.profile.avatarUrl,
      accessTokenHash: hashOAuthToken(input.accessToken),
      refreshTokenHash: hashOAuthToken(input.refreshToken),
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenScope: input.scope || null,
      tokenExpiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      lastLoginAt: new Date(),
    },
    update: {
      email: input.profile.email,
      emailVerified: input.profile.emailVerified,
      displayName: input.profile.name,
      avatarUrl: input.profile.avatarUrl,
      accessTokenHash: hashOAuthToken(input.accessToken),
      ...(accessTokenEncrypted ? { accessTokenEncrypted } : {}),
      ...(input.refreshToken ? { refreshTokenHash: hashOAuthToken(input.refreshToken) } : {}),
      ...(refreshTokenEncrypted ? { refreshTokenEncrypted } : {}),
      ...(input.scope ? { tokenScope: input.scope } : {}),
      ...(input.expiresAt ? { tokenExpiresAt: new Date(input.expiresAt) } : {}),
      lastLoginAt: new Date(),
    },
  })
}
