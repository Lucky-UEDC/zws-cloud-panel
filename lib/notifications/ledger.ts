import crypto from "node:crypto"
import { prisma } from "@/lib/db"

export const NOTIFICATION_QUEUE_STATES = {
  pending: "pending",
  processing: "processing",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
  retrying: "retrying",
  cancelled: "cancelled",
  skippedDuplicate: "skipped_duplicate",
  skippedRateLimited: "skipped_rate_limited",
} as const

const SUCCESS_STATUSES = new Set(["pending", "processing", "queued", "sent", "delivered", "success", "partial_success"])
const REMINDER_EVENTS = new Set(["renewal_3d", "renewal_2d", "renewal_1d", "renewal_due_day"])
const SUSPENSION_EVENTS = new Set(["service_suspended"])

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function clean(value: unknown) {
  return String(value || "none").trim().toLowerCase()
}

export function notificationMessageHash(input: {
  customerId: string
  orderId?: string | null
  serviceId?: string | null
  invoiceId?: string | null
  templateId: string
  channel: string
  event: string
  notificationType?: string | null
  scheduledFor?: Date | null
  date?: Date
}) {
  const payload = [
    clean(input.customerId),
    clean(input.orderId),
    clean(input.serviceId),
    clean(input.invoiceId),
    clean(input.templateId),
    clean(input.channel),
    clean(input.event),
    clean(input.notificationType || input.event),
    dayKey(input.scheduledFor || input.date),
  ].join("|")
  return crypto.createHash("sha256").update(payload).digest("hex")
}

function todayRange(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start, end }
}

export function normalizeNotificationStatus(status: unknown) {
  const raw = String(status || "").toLowerCase()
  if (raw === "queued") return NOTIFICATION_QUEUE_STATES.pending
  if (raw === "success" || raw === "whatsapp_server_ack" || raw === "whatsapp_device_ack") return NOTIFICATION_QUEUE_STATES.sent
  if (raw === "read" || raw === "played") return NOTIFICATION_QUEUE_STATES.delivered
  if (raw === "abandoned") return NOTIFICATION_QUEUE_STATES.cancelled
  if (raw in NOTIFICATION_QUEUE_STATES) return raw
  return raw || NOTIFICATION_QUEUE_STATES.pending
}

async function rateLimitDecision(input: {
  customerId: string
  orderId?: string | null
  serviceId?: string | null
  invoiceId?: string | null
  event: string
  channel: string
  now: Date
}) {
  const { start, end } = todayRange(input.now)
  const daily = await (prisma as any).notificationLedger.findFirst({
    where: {
      customerId: input.customerId,
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.serviceId ? { serviceId: input.serviceId } : {}),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      channel: input.channel,
      status: { in: ["pending", "processing", "sent", "delivered"] },
      createdAt: { gte: start, lt: end },
    },
    select: { notificationId: true, event: true, status: true, metadata: true },
  }).catch(() => null)
  if (daily) return { allowed: false, reason: "daily_limit", existing: daily }

  if (SUSPENSION_EVENTS.has(input.event)) {
    const suspension = await (prisma as any).notificationLedger.findFirst({
      where: {
        customerId: input.customerId,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        channel: input.channel,
        event: { in: [...SUSPENSION_EVENTS] },
        status: { in: ["pending", "processing", "sent", "delivered"] },
      },
      select: { notificationId: true, event: true, status: true, metadata: true },
    }).catch(() => null)
    if (suspension) return { allowed: false, reason: "suspension_already_sent", existing: suspension }
  }

  if (input.event.startsWith("renewal_") && !REMINDER_EVENTS.has(input.event)) {
    return { allowed: false, reason: "renewal_event_not_allowed", existing: null }
  }

  return { allowed: true, reason: null, existing: null }
}

export async function reserveNotificationDelivery(input: {
  customerId?: string | null
  orderId?: string | null
  serviceId?: string | null
  invoiceId?: string | null
  templateId?: string | null
  notificationType?: string | null
  channel: string
  event: string
  scheduledFor?: Date | null
  metadata?: Record<string, unknown>
  now?: Date
}) {
  const customerId = String(input.customerId || "").trim()
  const orderId = String(input.orderId || "").trim() || null
  const serviceId = String(input.serviceId || "").trim() || null
  const invoiceId = String(input.invoiceId || "").trim()
  const templateId = String(input.templateId || "").trim()
  const notificationType = String(input.notificationType || input.event || "").trim()
  const now = input.now || new Date()
  if (!customerId || (!orderId && !serviceId && !invoiceId) || !templateId || !notificationType) {
    return { reserved: false, reason: "missing_identity", row: null as any, duplicatePrevented: false }
  }

  const rate = await rateLimitDecision({ customerId, orderId, serviceId, invoiceId: invoiceId || null, event: input.event, channel: input.channel, now })
  if (!rate.allowed) {
    if (rate.existing?.notificationId) {
      await (prisma as any).notificationLedger.update({
        where: { notificationId: rate.existing.notificationId },
        data: {
          metadata: {
            ...(rate.existing.metadata || {}),
            duplicatePrevented: true,
            lastSkippedAt: now.toISOString(),
            lastSkippedReason: rate.reason || "rate_limited",
          },
        },
      }).catch(() => null)
    }
    return { reserved: false, reason: rate.reason || "rate_limited", row: rate.existing, duplicatePrevented: true }
  }

  const messageHash = notificationMessageHash({ customerId, orderId, serviceId, invoiceId, templateId, channel: input.channel, event: input.event, notificationType, scheduledFor: input.scheduledFor, date: now })
  try {
    const row = await (prisma as any).notificationLedger.create({
      data: {
        customerId,
        orderId,
        serviceId,
        invoiceId: invoiceId || null,
        templateId,
        notificationType,
        channel: input.channel,
        event: input.event,
        scheduledFor: input.scheduledFor || null,
        status: NOTIFICATION_QUEUE_STATES.pending,
        messageHash,
        metadata: { ...(input.metadata || {}), reservedAt: now.toISOString() },
      },
    })
    return { reserved: true, reason: "reserved", row, duplicatePrevented: false }
  } catch (error: any) {
    if (String(error?.code) !== "P2002") throw error
    const existing = await (prisma as any).notificationLedger.findFirst({
      where: {
        OR: [
          { messageHash },
          { customerId, orderId, serviceId, invoiceId: invoiceId || null, templateId, notificationType, event: input.event },
        ],
      },
    }).catch(() => null)
    if (existing?.notificationId) {
      await (prisma as any).notificationLedger.update({
        where: { notificationId: existing.notificationId },
        data: {
          metadata: {
            ...(existing.metadata || {}),
            duplicatePrevented: true,
            lastDuplicateAt: now.toISOString(),
          },
        },
      }).catch(() => null)
    }
    return { reserved: false, reason: "duplicate_successful_notification", row: existing, duplicatePrevented: true }
  }
}

export async function markNotificationDelivery(input: {
  notificationId?: string | null
  status: string
  deliveryId?: string | null
  retryCount?: number | null
  nextRetry?: Date | null
  metadata?: Record<string, unknown>
}) {
  if (!input.notificationId) return null
  const status = normalizeNotificationStatus(input.status)
  return (prisma as any).notificationLedger.update({
    where: { notificationId: input.notificationId },
    data: {
      status,
      deliveryId: input.deliveryId || undefined,
      providerMessageId: input.deliveryId || undefined,
      sentAt: ["sent", "delivered"].includes(status) ? new Date() : undefined,
      retryCount: input.retryCount === null || input.retryCount === undefined ? undefined : input.retryCount,
      nextRetry: input.nextRetry === undefined ? undefined : input.nextRetry,
      metadata: input.metadata || undefined,
    },
  }).catch(() => null)
}

export async function notificationHealthSnapshot() {
  const { start, end } = todayRange()
  const rows = await (prisma as any).notificationLedger.groupBy({
    by: ["status"],
    _count: { _all: true },
  }).catch(() => [])
  const today = await (prisma as any).notificationLedger.groupBy({
    by: ["status"],
    where: { createdAt: { gte: start, lt: end } },
    _count: { _all: true },
  }).catch(() => [])
  const count = (items: any[], status: string) => Number(items.find((item) => item.status === status)?._count?._all || 0)
  const duplicatePrevented = await (prisma as any).notificationLedger.count({
    where: {
      OR: [
        { status: NOTIFICATION_QUEUE_STATES.skippedDuplicate },
        { metadata: { path: ["duplicatePrevented"], equals: true } },
      ],
    },
  }).catch(() => 0)
  return {
    queueSize: count(rows, "pending") + count(rows, "retrying"),
    pending: count(rows, "pending"),
    retrying: count(rows, "retrying"),
    delivered: count(rows, "delivered"),
    failed: count(rows, "failed"),
    duplicatePrevented,
    todaysSent: count(today, "sent") + count(today, "delivered"),
    todaysSkipped: count(today, "skipped_duplicate") + count(today, "skipped_rate_limited"),
    spamPrevented: duplicatePrevented + count(today, "skipped_duplicate") + count(today, "skipped_rate_limited"),
    states: rows,
    today,
  }
}
