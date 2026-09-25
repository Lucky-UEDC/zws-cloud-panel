import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"

const API = "https://api.cloudflare.com/client/v4"
const AUTH_URL = "https://dash.cloudflare.com/oauth2/auth"
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"

function env(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim()
}

function baseUrl(request?: NextRequest) {
  const configured = env("APP_URL") || env("NEXT_PUBLIC_APP_URL")
  if (configured) return configured.replace(/\/+$/, "")
  if (request) return new URL(request.url).origin
  return ""
}

function base64url(buffer: Buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

async function cloudflareOAuthConfig(request?: NextRequest) {
  const config = await getServiceIntegrationConfig("cloudflareOAuth").catch(() => ({} as any))
  const clientId = String(config.clientId || env("CF_OAUTH_CLIENT_ID") || env("CLOUDFLARE_OAUTH_CLIENT_ID") || "").trim()
  const clientSecret = String(config.clientSecret || env("CF_OAUTH_CLIENT_SECRET") || env("CLOUDFLARE_OAUTH_CLIENT_SECRET") || "").trim()
  const redirectUri = String(config.redirectUri || env("CF_OAUTH_REDIRECT_URI") || `${baseUrl(request)}/api/admin/system/cloudflare/callback`).trim()
  const scopes = String(config.scopes || env("CF_OAUTH_SCOPES") || "account:read zone:read dns:edit tunnel:edit").trim()
  return { clientId, clientSecret, redirectUri, scopes, enabled: config.enabled !== false }
}

async function api<T = any>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const message = Array.isArray(body.errors) && body.errors.length
      ? body.errors.map((error: any) => error.message || error.code).join("; ")
      : response.statusText
    throw new Error(`Cloudflare API failed ${path}: ${message}`)
  }
  return body.result as T
}

export async function listCloudflareAccounts() {
  const rows = await (prisma as any).cloudflareAccount.findMany({
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  }).catch(() => [])
  return rows.map((row: any) => ({
    id: row.id,
    accountId: row.accountId,
    accountName: row.accountName,
    zoneId: row.zoneId,
    zoneName: row.zoneName,
    tunnelId: row.tunnelId,
    tunnelName: row.tunnelName,
    status: row.status,
    isActive: row.isActive,
    tokenExpiresAt: row.tokenExpiresAt,
    metadata: row.metadata || {},
    connectedBy: row.connectedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function getActiveCloudflareAccount() {
  return (prisma as any).cloudflareAccount.findFirst({
    where: { status: "connected", isActive: true },
    orderBy: { updatedAt: "desc" },
  }).catch(() => null)
}

export async function getCloudflareAccountToken(account?: any) {
  const row = account || await getActiveCloudflareAccount()
  if (!row?.accessTokenEncrypted) return ""
  return decryptSecretValue(String(row.accessTokenEncrypted))
}

export async function selectedCloudflareContext() {
  const account = await getActiveCloudflareAccount()
  const token = await getCloudflareAccountToken(account)
  if (!account || !token) return null
  return {
    account,
    token,
    accountId: String(account.accountId || ""),
    zoneId: String(account.zoneId || ""),
    tunnelId: String(account.tunnelId || ""),
  }
}

export async function createCloudflareConnectUrl(request: NextRequest, adminEmail?: string | null) {
  const config = await cloudflareOAuthConfig(request)
  if (!config.clientId || !config.clientSecret || !config.redirectUri) throw new Error("Cloudflare OAuth client settings are not configured in integrations.")
  const state = base64url(crypto.randomBytes(24))
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest())
  await (prisma as any).cloudflareOAuthState.create({
    data: {
      state,
      codeVerifierEncrypted: encryptSecretValue(verifier),
      redirectUri: config.redirectUri,
      createdBy: adminEmail || null,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })
  return { authorizationUrl: `${AUTH_URL}?${params.toString()}`, state, redirectUri: config.redirectUri }
}

export async function completeCloudflareOAuth(request: NextRequest, code: string, state: string) {
  const row = await (prisma as any).cloudflareOAuthState.findUnique({ where: { state } }).catch(() => null)
  if (!row || row.consumedAt) throw new Error("Cloudflare OAuth state is invalid or already used.")
  if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error("Cloudflare OAuth state has expired.")
  const config = await cloudflareOAuthConfig(request)
  const verifier = row.codeVerifierEncrypted ? decryptSecretValue(String(row.codeVerifierEncrypted)) : ""
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: String(row.redirectUri || config.redirectUri),
  })
  if (verifier) params.set("code_verifier", verifier)
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  })
  const tokenBody = await response.json().catch(() => ({}))
  if (!response.ok || tokenBody.error) throw new Error(tokenBody.error_description || tokenBody.error || "Cloudflare OAuth token exchange failed.")
  const accessToken = String(tokenBody.access_token || "")
  if (!accessToken) throw new Error("Cloudflare OAuth did not return an access token.")

  const accounts = await api<any[]>("/accounts", accessToken)
  const zones = await api<any[]>("/zones", accessToken).catch(() => [])
  const activeExists = await getActiveCloudflareAccount()
  const saved = []
  for (const account of accounts || []) {
    const accountZones = (zones || []).filter((zone: any) => zone.account?.id === account.id)
    const primaryZone = accountZones[0] || null
    const savedRow: any = await (prisma as any).cloudflareAccount.upsert({
      where: { accountId: String(account.id) },
      update: {
        accountName: account.name || null,
        zoneId: primaryZone?.id || undefined,
        zoneName: primaryZone?.name || undefined,
        accessTokenEncrypted: encryptSecretValue(accessToken),
        refreshTokenEncrypted: tokenBody.refresh_token ? encryptSecretValue(String(tokenBody.refresh_token)) : null,
        tokenExpiresAt: tokenBody.expires_in ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000) : null,
        scope: tokenBody.scope || config.scopes || null,
        status: "connected",
        isActive: !activeExists && saved.length === 0,
        metadata: { zones: accountZones.map((zone: any) => ({ id: zone.id, name: zone.name, status: zone.status })) },
        connectedBy: row.createdBy || null,
      },
      create: {
        accountId: String(account.id),
        accountName: account.name || null,
        zoneId: primaryZone?.id || null,
        zoneName: primaryZone?.name || null,
        accessTokenEncrypted: encryptSecretValue(accessToken),
        refreshTokenEncrypted: tokenBody.refresh_token ? encryptSecretValue(String(tokenBody.refresh_token)) : null,
        tokenExpiresAt: tokenBody.expires_in ? new Date(Date.now() + Number(tokenBody.expires_in) * 1000) : null,
        scope: tokenBody.scope || config.scopes || null,
        status: "connected",
        isActive: !activeExists && saved.length === 0,
        metadata: { zones: accountZones.map((zone: any) => ({ id: zone.id, name: zone.name, status: zone.status })) },
        connectedBy: row.createdBy || null,
      },
    })
    saved.push(savedRow)
  }
  await (prisma as any).cloudflareOAuthState.update({ where: { state }, data: { consumedAt: new Date() } }).catch(() => null)
  return { accounts: saved.map((account) => ({ id: account.id, accountId: account.accountId, accountName: account.accountName, zoneId: account.zoneId, zoneName: account.zoneName, isActive: account.isActive })) }
}

export async function selectCloudflareAccount(input: { accountId: string; zoneId?: string | null; tunnelId?: string | null; tunnelName?: string | null }) {
  const row = await (prisma as any).cloudflareAccount.findFirst({
    where: { OR: [{ id: input.accountId }, { accountId: input.accountId }] },
  }).catch(() => null)
  if (!row) throw new Error("Cloudflare account not found.")
  await (prisma as any).cloudflareAccount.updateMany({ where: { id: { not: row.id } }, data: { isActive: false } })
  return (prisma as any).cloudflareAccount.update({
    where: { id: row.id },
    data: {
      isActive: true,
      status: "connected",
      zoneId: input.zoneId === undefined ? row.zoneId : input.zoneId,
      tunnelId: input.tunnelId === undefined ? row.tunnelId : input.tunnelId,
      tunnelName: input.tunnelName === undefined ? row.tunnelName : input.tunnelName,
    },
  })
}

export async function disconnectCloudflareAccount(accountId?: string | null) {
  const where = accountId ? { OR: [{ id: accountId }, { accountId }] } : { isActive: true }
  const row = await (prisma as any).cloudflareAccount.findFirst({ where }).catch(() => null)
  if (!row) return null
  return (prisma as any).cloudflareAccount.update({
    where: { id: row.id },
    data: { status: "disconnected", isActive: false },
  })
}

export async function updateActiveCloudflareTunnel(input: { tunnelId?: string | null; tunnelName?: string | null; zoneId?: string | null }) {
  const row = await getActiveCloudflareAccount()
  if (!row) return null
  return (prisma as any).cloudflareAccount.update({
    where: { id: row.id },
    data: {
      tunnelId: input.tunnelId === undefined ? row.tunnelId : input.tunnelId,
      tunnelName: input.tunnelName === undefined ? row.tunnelName : input.tunnelName,
      zoneId: input.zoneId === undefined ? row.zoneId : input.zoneId,
    },
  })
}
