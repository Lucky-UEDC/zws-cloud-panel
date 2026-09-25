import crypto from "node:crypto"
import { getRedisClient } from "@/lib/redis"
import { requireSecret } from "@/lib/security/env-secret"

const TOKEN_TTL_SECONDS = 10 * 60

export type SignedPricingPayload = {
  product: string
  term?: number | null
  customerId?: string | null
  country: string
  currency: string
  price: number
  baseAmountInr: number
  exchangeRate: number
  markup: number
  rounding: string
  timestamp: number
  nonce: string
}

function secret() {
  return requireSecret(
    ["PRICE_TOKEN_SECRET", "AUTH_SECRET", "SESSION_SECRET", "JWT_SECRET", "NEXTAUTH_SECRET"],
    "development-price-token-secret-change-before-production",
    32,
  )
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url")
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url")
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function createPricingToken(input: Omit<SignedPricingPayload, "timestamp" | "nonce">) {
  const payload: SignedPricingPayload = {
    ...input,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString("base64url"),
  }
  const encoded = base64url(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

export async function verifyPricingToken(token: unknown, expected: {
  product?: string | null
  term?: number | null
  customerId?: string | null
  country?: string | null
  currency?: string | null
  consume?: boolean
} = {}) {
  const text = String(token || "")
  const [encoded, signature, extra] = text.split(".")
  if (!encoded || !signature || extra) throw Object.assign(new Error("Invalid pricing token."), { code: "INVALID_PRICE_TOKEN", status: 409 })
  if (!safeEqual(signature, sign(encoded))) throw Object.assign(new Error("Modified pricing token rejected."), { code: "PRICE_TOKEN_TAMPERED", status: 409 })

  let payload: SignedPricingPayload
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    throw Object.assign(new Error("Malformed pricing token."), { code: "INVALID_PRICE_TOKEN", status: 409 })
  }

  const ageSeconds = Math.floor((Date.now() - Number(payload.timestamp || 0)) / 1000)
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > TOKEN_TTL_SECONDS) {
    throw Object.assign(new Error("Pricing token expired. Refresh checkout and try again."), { code: "PRICE_TOKEN_EXPIRED", status: 409 })
  }
  if (expected.product && payload.product !== expected.product) throw Object.assign(new Error("Pricing token product mismatch."), { code: "PRICE_TOKEN_MISMATCH", status: 409 })
  if (expected.term && payload.term && Number(payload.term) !== Number(expected.term)) throw Object.assign(new Error("Pricing token term mismatch."), { code: "PRICE_TOKEN_MISMATCH", status: 409 })
  if (expected.customerId && payload.customerId && payload.customerId !== expected.customerId) throw Object.assign(new Error("Pricing token customer mismatch."), { code: "PRICE_TOKEN_MISMATCH", status: 409 })
  if (expected.country && payload.country !== expected.country) throw Object.assign(new Error("Pricing token country mismatch."), { code: "PRICE_TOKEN_MISMATCH", status: 409 })
  if (expected.currency && payload.currency !== expected.currency) throw Object.assign(new Error("Pricing token currency mismatch."), { code: "PRICE_TOKEN_MISMATCH", status: 409 })

  if (expected.consume) {
    const redis = getRedisClient()
    if (redis) {
      try {
        await redis.connect().catch(() => undefined)
        const key = `pricing-token:nonce:${payload.nonce}`
        const ok = await redis.set(key, "1", "EX", TOKEN_TTL_SECONDS, "NX")
        if (!ok) throw Object.assign(new Error("Pricing token replay rejected."), { code: "PRICE_TOKEN_REPLAY", status: 409 })
      } catch (error) {
        if ((error as any)?.code === "PRICE_TOKEN_REPLAY") throw error
      }
    }
  }

  return payload
}
