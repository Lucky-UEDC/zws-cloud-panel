import Redis from "ioredis"

type Unsubscribe = () => void

const MAX_RING_ITEMS = 240
const rings = new Map<string, unknown[]>()
const localSubscribers = new Map<string, Set<(payload: any) => void>>()

function redisUrl() {
  return String(process.env.REDIS_URL || "").trim()
}

function createRedisConnection() {
  const url = redisUrl()
  if (!url) return null
  const redis = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(2000, 100 * times),
  })
  redis.on("error", () => undefined)
  return redis
}

export const realtimeChannels = {
  nodeMetric: (nodeId: string) => `zws:realtime:node:${nodeId}:metric`,
  nodeLogs: (nodeId: string) => `zws:realtime:node:${nodeId}:logs`,
  vpsMetric: (vpsId: string) => `zws:realtime:vps:${vpsId}:metric`,
  vpsLogs: (vpsId: string) => `zws:realtime:vps:${vpsId}:logs`,
  vpsLive: (vpsId: string) => `zws:realtime:vps:${vpsId}:live`,
  adminVmLive: () => "zws:realtime:admin:vms:live",
  proxmoxEvents: () => "zws:realtime:proxmox:events",
  adminBandwidthLive: () => "zws:realtime:admin:bandwidth:live",
  nodeBandwidthLive: (nodeId: string) => `zws:realtime:node:${nodeId}:bandwidth:live`,
  orders: () => "zws:realtime:orders",
  order: (orderId: string) => `zws:realtime:order:${orderId}`,
  whatsapp: () => "zws:realtime:whatsapp",
  whatsappInstance: (instanceId: string) => `zws:realtime:whatsapp:${instanceId}`,
  tickets: () => "zws:realtime:tickets",
  ticket: (ticketId: string) => `zws:realtime:ticket:${ticketId}`,
}

export function toRealtimeJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "bigint") return Number(entry)
    if (entry instanceof Date) return entry.toISOString()
    return entry
  })
}

export function rememberRealtimeEvent(channel: string, payload: unknown) {
  const current = rings.get(channel) || []
  current.push(payload)
  if (current.length > MAX_RING_ITEMS) current.splice(0, current.length - MAX_RING_ITEMS)
  rings.set(channel, current)
}

export function recentRealtimeEvents<T = any>(channel: string, limit = 80): T[] {
  return (rings.get(channel) || []).slice(-limit) as T[]
}

function emitLocal(channel: string, payload: unknown) {
  rememberRealtimeEvent(channel, payload)
  for (const listener of localSubscribers.get(channel) || []) {
    try {
      listener(payload)
    } catch {
      // Ignore a broken local subscriber; SSE routes clean themselves up on cancel.
    }
  }
}

export async function publishRealtimeEvent(channel: string, payload: unknown) {
  emitLocal(channel, payload)
  const redis = createRedisConnection()
  if (!redis) return false
  try {
    await redis.publish(channel, toRealtimeJson(payload))
    return true
  } catch {
    return false
  } finally {
    redis.disconnect()
  }
}

export function subscribeRealtimeChannel(channel: string, onMessage: (payload: any) => void): Unsubscribe {
  let closed = false
  let redis: Redis | null = null
  const local = localSubscribers.get(channel) || new Set<(payload: any) => void>()
  local.add(onMessage)
  localSubscribers.set(channel, local)

  const url = redisUrl()
  if (url) {
    redis = createRedisConnection()
    redis?.subscribe(channel).catch(() => null)
    redis?.on("message", (receivedChannel, message) => {
      if (closed || receivedChannel !== channel) return
      try {
        const payload = JSON.parse(message)
        rememberRealtimeEvent(channel, payload)
        onMessage(payload)
      } catch {
        // Bad pubsub payloads should not kill the live stream.
      }
    })
  }

  return () => {
    closed = true
    local.delete(onMessage)
    if (!local.size) localSubscribers.delete(channel)
    redis?.unsubscribe(channel).catch(() => null)
    redis?.disconnect()
  }
}
