import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"

const BLOOM_BITS = 1_048_576
const BLOOM_SEEDS = ["zws-a", "zws-b", "zws-c"]
const CACHE_TTL_SECONDS = 15 * 60

function digest(value: string, seed: string) {
  return crypto.createHash("sha256").update(`${seed}:${value}`).digest()
}

function bloomOffset(value: string, seed: string) {
  return digest(value, seed).readUInt32BE(0) % BLOOM_BITS
}

function identityHash(kind: "email" | "phone", value: string) {
  return crypto.createHash("sha256").update(`${kind}:${value}`).digest("hex")
}

async function redisBloomMightContain(key: string, value: string) {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    await redis.connect().catch(() => undefined)
    const bits = await Promise.all(BLOOM_SEEDS.map((seed) => redis.getbit(key, bloomOffset(value, seed))))
    return bits.every((bit) => bit === 1)
  } catch {
    return null
  }
}

async function redisBloomAdd(key: string, value: string) {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    await Promise.all(BLOOM_SEEDS.map((seed) => redis.setbit(key, bloomOffset(value, seed), 1)))
  } catch {
    // Best-effort cache; database uniqueness is authoritative.
  }
}

async function redisCachedDuplicate(kind: "email" | "phone", value: string) {
  const redis = getRedisClient()
  if (!redis) return null
  const hash = identityHash(kind, value)
  try {
    await redis.connect().catch(() => undefined)
    const cached = await redis.get(`signup:duplicate:${kind}:${hash}`)
    if (cached === "1") return true
    if (cached === "0") return false
  } catch {
    return null
  }
  return null
}

async function redisCacheDuplicate(kind: "email" | "phone", value: string, duplicate: boolean) {
  const redis = getRedisClient()
  if (!redis) return
  const hash = identityHash(kind, value)
  try {
    await redis.connect().catch(() => undefined)
    await redis.set(`signup:duplicate:${kind}:${hash}`, duplicate ? "1" : "0", "EX", CACHE_TTL_SECONDS)
    if (duplicate) await redisBloomAdd(`signup:bloom:${kind}`, value)
  } catch {
    // Best-effort cache; database uniqueness is authoritative.
  }
}

export async function findDuplicateAccount(input: {
  email: string
  phone: string
}) {
  const email = String(input.email || "").trim().toLowerCase()
  const phone = String(input.phone || "").trim()

  const emailCache = email ? await redisCachedDuplicate("email", email) : null
  if (emailCache === true) return { duplicate: true, field: "email" as const }
  const phoneCache = phone ? await redisCachedDuplicate("phone", phone) : null
  if (phoneCache === true) return { duplicate: true, field: "phone" as const }

  if (phone) await redisBloomMightContain("signup:bloom:phone", phone)
  if (email) await redisBloomMightContain("signup:bloom:email", email)

  const [customerByEmail, adminByEmail, customerByPhone, adminByPhone] = await Promise.all([
    email && emailCache !== false ? prisma.customer.findUnique({ where: { email }, select: { id: true } }).catch(() => null) : null,
    email && emailCache !== false ? prisma.adminProfile.findUnique({ where: { email }, select: { id: true } }).catch(() => null) : null,
    phone && phoneCache !== false ? prisma.customer.findFirst({ where: { phone }, select: { id: true } }).catch(() => null) : null,
    phone && phoneCache !== false ? prisma.adminProfile.findFirst({ where: { phone }, select: { id: true } }).catch(() => null) : null,
  ])

  const emailDuplicate = Boolean(customerByEmail || adminByEmail)
  const phoneDuplicate = Boolean(customerByPhone || adminByPhone)
  if (email) await redisCacheDuplicate("email", email, emailDuplicate)
  if (phone) await redisCacheDuplicate("phone", phone, phoneDuplicate)

  if (emailDuplicate) return { duplicate: true, field: "email" as const }
  if (phoneDuplicate) return { duplicate: true, field: "phone" as const }
  return { duplicate: false as const }
}

export async function rememberAccountIdentity(input: {
  email: string
  phone: string
}) {
  const email = String(input.email || "").trim().toLowerCase()
  const phone = String(input.phone || "").trim()
  await Promise.all([
    email ? redisCacheDuplicate("email", email, true) : undefined,
    phone ? redisCacheDuplicate("phone", phone, true) : undefined,
  ])
}
