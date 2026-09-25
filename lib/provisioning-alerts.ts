import { dispatchAdminNotification } from "@/lib/admin-notification-dispatcher"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"

type CapacityEvent =
  | "node_capacity_warning"
  | "node_full"
  | "provision_failover"

async function shouldSend(key: string, ttlSeconds = 900) {
  const redis = getRedisClient()
  if (!redis) return true
  try {
    await redis.connect().catch(() => undefined)
    const set = await redis.set(`alert-throttle:${key}`, "1", "EX", ttlSeconds, "NX")
    return Boolean(set)
  } catch {
    return true
  }
}

export async function recordCapacityAlert(input: {
  event: CapacityEvent
  title: string
  message: string
  nodeId?: string | null
  severity?: "warning" | "critical"
  dedupeKey: string
  metadata?: Record<string, unknown>
  throttleSeconds?: number
}) {
  await (prisma as any).systemAlert.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {
      alertType: input.event,
      severity: input.severity || "warning",
      status: "open",
      title: input.title,
      message: input.message,
      nodeId: input.nodeId || null,
      metadata: input.metadata || {},
      lastSeenAt: new Date(),
      resolvedAt: null,
    },
    create: {
      dedupeKey: input.dedupeKey,
      alertType: input.event,
      severity: input.severity || "warning",
      title: input.title,
      message: input.message,
      nodeId: input.nodeId || null,
      metadata: input.metadata || {},
    },
  }).catch(() => null)

  if (!(await shouldSend(input.dedupeKey, input.throttleSeconds))) {
    return { queued: false, reason: "throttled" }
  }
  return dispatchAdminNotification({
    event: input.event,
    message: input.message,
    metadata: {
      dedupeKey: input.dedupeKey,
      nodeId: input.nodeId || null,
      severity: input.severity || "warning",
      ...(input.metadata || {}),
    },
  }).catch(() => ({ queued: false, reason: "dispatch_failed" }))
}

export async function resolveCapacityAlert(dedupeKey: string) {
  await (prisma as any).systemAlert.updateMany({
    where: { dedupeKey, status: "open" },
    data: { status: "resolved", resolvedAt: new Date(), lastSeenAt: new Date() },
  }).catch(() => null)
}
