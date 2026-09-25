import { NextRequest, NextResponse } from "next/server"
import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/lib/db"

// Versioned public API (/api/v1) authentication via API keys (reseller + client).
export type ApiKeyType = "reseller" | "client"
export type ApiKeyContext = {
  id: string
  type: ApiKeyType
  ownerCustomerId: string | null
  scopes: string[]
  rateLimitPerMin: number
}

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw.trim()).digest("hex")
}

/** Generate a new key. The raw value is shown ONCE to the creator; only the hash is stored. */
export function generateApiKey(type: ApiKeyType) {
  const p = type === "client" ? "ck" : "rk"
  const secret = randomBytes(24).toString("base64url")
  const raw = `${p}_live_${secret}`
  return { raw, prefix: raw.slice(0, 12), hashedKey: hashApiKey(raw) }
}

export function apiError(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status })
}

// Lightweight per-process backstop rate limiter; Cloudflare edge rules are the primary control.
const buckets = new Map<string, { count: number; resetAt: number }>()
function rateLimit(keyId: string, perMin: number) {
  const now = Date.now()
  const b = buckets.get(keyId)
  if (!b || now >= b.resetAt) { buckets.set(keyId, { count: 1, resetAt: now + 60_000 }); return { ok: true } }
  b.count += 1
  if (b.count > Math.max(1, perMin)) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
  return { ok: true }
}

/** Authenticate a request by `Authorization: Bearer <api_key>`. Returns a context or an error response. */
export async function authenticateApiKey(req: NextRequest): Promise<{ ctx: ApiKeyContext } | { error: NextResponse }> {
  const header = req.headers.get("authorization") || ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return { error: apiError("unauthorized", "Missing 'Authorization: Bearer <api_key>' header", 401) }

  const key = await prisma.apiKey.findUnique({ where: { hashedKey: hashApiKey(match[1]) } }).catch(() => null)
  if (!key || key.revokedAt) return { error: apiError("invalid_key", "API key is invalid or revoked", 401) }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return { error: apiError("expired_key", "API key has expired", 401) }

  const rl = rateLimit(key.id, key.rateLimitPerMin || 120)
  if (!rl.ok) return { error: apiError("rate_limited", "Too many requests", 429, { retryAfterSeconds: rl.retryAfter }) }

  prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => null)
  const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : []
  return {
    ctx: {
      id: key.id,
      type: key.type === "client" ? "client" : "reseller",
      ownerCustomerId: key.ownerCustomerId,
      scopes,
      rateLimitPerMin: key.rateLimitPerMin,
    },
  }
}

export function hasScope(ctx: ApiKeyContext, scope: string) {
  return ctx.scopes.includes(scope) || ctx.scopes.includes("*")
}

/** Returns an error response if the scope is missing, else null. */
export function requireScope(ctx: ApiKeyContext, scope: string): NextResponse | null {
  return hasScope(ctx, scope) ? null : apiError("forbidden", `Missing required scope: ${scope}`, 403)
}

/** For client keys, the customerId filter to apply; for reseller keys, undefined (unrestricted). */
export function customerFilter(ctx: ApiKeyContext): string | undefined {
  return ctx.type === "client" ? ctx.ownerCustomerId || "__none__" : undefined
}
