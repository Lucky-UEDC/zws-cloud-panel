import Redis from "ioredis"

let client: Redis | null = null
let unavailable = false

export function getRedisClient(): Redis | null {
  if (unavailable) return null
  const url = String(process.env.REDIS_URL || "").trim()
  if (!url) return null
  if (client) return client

  try {
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      retryStrategy: () => null,
    })
    client.on("error", () => undefined)
    return client
  } catch {
    unavailable = true
    return null
  }
}

export async function withRedisLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedisClient()
  if (!redis) return fn()

  const lockValue = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  let acquired = false
  try {
    try {
      await redis.connect().catch(() => undefined)
      // Real mutual exclusion: block until we actually hold the lock. Previously this ran fn()
      // immediately when NX failed, so contending callers (payment/wallet/VMID/IP allocation)
      // all executed concurrently despite the lock. Poll until acquired or the TTL budget elapses;
      // a crashed holder's lock auto-expires via PX so we never deadlock.
      const deadline = Date.now() + ttlMs
      for (;;) {
        const lock = await redis.set(key, lockValue, "PX", ttlMs, "NX")
        if (lock) {
          acquired = true
          break
        }
        if (Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch {
      // Redis is an optimization; database constraints remain the fallback guard.
    }
    // If we timed out waiting for a stuck holder, still proceed — the DB uniqueness/claim
    // constraints remain the ultimate source-of-truth guard against duplicates.
    return await fn()
  } finally {
    if (acquired) {
      try {
        const current = await redis.get(key)
        if (current === lockValue) await redis.del(key)
      } catch {
        // Best effort unlock; the PX TTL expires the lock otherwise.
      }
    }
  }
}
