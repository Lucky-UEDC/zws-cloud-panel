import assert from "node:assert/strict"
import test from "node:test"
import { withRedisLock } from "@/lib/redis"

test("Redis acquisition failure falls back without retrying a rejected callback", async () => {
  const originalRedisUrl = process.env.REDIS_URL
  process.env.REDIS_URL = "redis://127.0.0.1:1"

  try {
    let successCalls = 0
    const result = await withRedisLock("test:redis-lock:fallback", 10, async () => {
      successCalls += 1
      return "completed"
    })
    assert.equal(result, "completed")
    assert.equal(successCalls, 1)

    const callbackError = new Error("callback failed")
    let rejectedCalls = 0
    await assert.rejects(
      withRedisLock("test:redis-lock:callback-error", 10, async () => {
        rejectedCalls += 1
        if (rejectedCalls > 1) return "unexpected retry"
        throw callbackError
      }),
      (error) => error === callbackError,
    )
    assert.equal(rejectedCalls, 1)
  } finally {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL
    else process.env.REDIS_URL = originalRedisUrl
  }
})
