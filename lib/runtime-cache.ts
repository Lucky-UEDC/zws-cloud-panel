import { getRedisClient } from "@/lib/redis"

type MemoryEntry = {
  expiresAt: number
  value: unknown
}

const memoryCache = new Map<string, MemoryEntry>()

function pruneMemoryCache(now = Date.now()) {
  if (memoryCache.size < 1000) return
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key)
  }
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const now = Date.now()
  const memory = memoryCache.get(key)
  if (memory && memory.expiresAt > now) return memory.value as T
  if (memory) memoryCache.delete(key)

  const redis = getRedisClient()
  if (!redis) return null
  try {
    await redis.connect().catch(() => undefined)
    const raw = await redis.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<T> {
  const ttl = Math.max(1, Math.floor(ttlSeconds))
  pruneMemoryCache()
  memoryCache.set(key, { value, expiresAt: Date.now() + ttl * 1000 })

  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.connect().catch(() => undefined)
      await redis.set(key, JSON.stringify(value), "EX", ttl)
    } catch {
      // The memory cache keeps the request fast when Redis is unavailable.
    }
  }
  return value
}

export async function cachedJson<T>(key: string, ttlSeconds: number, loader: () => Promise<T>, forceRefresh = false): Promise<T> {
  if (!forceRefresh) {
    const cached = await getCachedJson<T>(key)
    if (cached !== null) return cached
  }
  return setCachedJson(key, await loader(), ttlSeconds)
}

export async function invalidateCachedJson(prefix: string) {
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key)
  }
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    const keys = await redis.keys(`${prefix}*`)
    if (keys.length) await redis.del(...keys)
  } catch {
    // Best effort invalidation.
  }
}
