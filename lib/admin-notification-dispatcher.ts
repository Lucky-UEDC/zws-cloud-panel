import { getAdminNotificationSettings, type AdminNotificationEvent } from "@/lib/admin-notifications"
import { sendWhatsAppMessage } from "@/lib/whatsapp/queue"
import { createPanelLog } from "@/lib/panel-log"
import { getRedisClient } from "@/lib/redis"
import { extractClientIp } from "@/lib/request-context"

const OPERATIONS_EVENTS = new Set<AdminNotificationEvent>([
  "node_capacity_warning",
  "node_full",
  "provision_failover",
])

export async function dispatchAdminNotification(input: {
  event: AdminNotificationEvent
  message: string
  request?: Request | null
  metadata?: Record<string, unknown>
}) {
  const settings = await getAdminNotificationSettings().catch(() => null)
  if (!settings?.enabled || settings.events[input.event] !== true) return { queued: false, reason: "disabled" }
  if (settings.deliveryMode === "silent_log") {
    await createPanelLog({ category: "Notification", message: input.event, metadata: { message: input.message, ...(input.metadata || {}) } }).catch(() => null)
    return { queued: false, reason: "silent_log" }
  }
  if (input.event === "website_visit" && input.request) {
    const ip = extractClientIp(input.request)
    const redis = getRedisClient()
    if (redis) {
      await redis.connect().catch(() => undefined)
      const throttle = await redis.set(`admin-visit-notification:${ip}`, "1", "EX", 30 * 60, "NX").catch(() => null)
      if (!throttle) return { queued: false, reason: "throttled" }
    }
  }
  const numbers = OPERATIONS_EVENTS.has(input.event) && settings.operationsNumbers.length
    ? settings.operationsNumbers
    : [settings.notificationNumber].filter(Boolean)
  if (!numbers.length) return { queued: false, reason: "missing_number" }
  const results = await Promise.allSettled(numbers.map((to) => sendWhatsAppMessage({
    to,
    provider: settings.provider,
    skipRegistrationCheck: true,
    templateKey: "system_fallback",
    variables: { message_text: input.message },
    category: "transactional",
    metadata: { adminNotificationEvent: input.event, deliveryMode: settings.deliveryMode, ...(input.metadata || {}) },
  })))
  return { queued: results.some((result) => result.status === "fulfilled" && result.value.ok), results }
}
