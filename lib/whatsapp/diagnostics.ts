import crypto from "node:crypto"
import os from "node:os"
import { prisma } from "@/lib/db"
import { normalizeStrictPhoneNumber } from "@/lib/phone-number"
import { truncateLargeString } from "@/lib/string-safety"
import { WhatsAppOtpError } from "@/lib/whatsapp/otp-errors"
import { requireSecret } from "@/lib/security/env-secret"

export const WHATSAPP_RUNTIME_ID = "primary"

export type WhatsAppLifecycleStatus =
  | "queued"
  | "processing"
  | "browser_connecting"
  | "browser_ready"
  | "sending"
  | "sent"
  | "whatsapp_server_ack"
  | "whatsapp_device_ack"
  | "delivered"
  | "read"
  | "failed"
  | "retrying"
  | "abandoned"
  | "played"

export type WhatsAppFailureClassification = {
  errorCode: string
  failureReason: string
  retryable: boolean
}

export function normalizeWhatsAppNumber(input: string, defaultCountry?: string | null) {
  const withoutJid = String(input || "").trim().replace(/@c\.us$/i, "")
  try {
    const normalized = normalizeStrictPhoneNumber(withoutJid, defaultCountry)
    return {
      digits: normalized.digits,
      jid: `${normalized.digits}@c.us`,
      maskedPhone: maskWhatsAppPhone(normalized.digits),
      phoneHash: hashWhatsAppPhone(normalized.digits),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Phone number must be a valid E.164 mobile number."
    throw new WhatsAppOtpError({
      code: "invalid_phone",
      stage: "phone_normalization",
      message,
      status: 400,
      retryable: false,
    })
  }
}

export function maskWhatsAppPhone(input: string) {
  const digits = String(input || "").replace(/\D/g, "")
  if (digits.length <= 4) return "****"
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`
}

export function hashWhatsAppPhone(input: string) {
  const digits = String(input || "").replace(/\D/g, "")
  const secret = requireSecret(["AUTH_SECRET", "NEXTAUTH_SECRET", "WHATSAPP_ADMIN_TOKEN"], "zws")
  return crypto.createHash("sha256").update(`${secret}:${digits}`).digest("hex")
}

function redactString(value: string) {
  return truncateLargeString(value, 5000)
    ?.replaceAll(process.cwd(), "[app]")
    .replace(/\.wwebjs_auth[^\s"',)]*/gi, "[whatsapp-session]")
    .replace(/(bearer\s+)[a-z0-9._\-+/=]+/gi, "$1[redacted]")
    .replace(/(token|secret|password|auth|session)["':=\s]+[a-z0-9._\-+/=]{8,}/gi, "$1=[redacted]")
    .replace(/\b(\d{2})\d{6,11}(\d{2})\b/g, "$1******$2")
    .replace(/\b\d{6}\b/g, "[otp-redacted]") || value
}

export function redactWhatsAppPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "string") return redactString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((entry) => redactWhatsAppPayload(entry))
  if (typeof value !== "object") return String(value)

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/otp|token|secret|password|auth|session|cookie|apiKey|apikey/i.test(key)) {
      output[key] = "[redacted]"
      continue
    }
    if (/phone|number|to/i.test(key) && typeof nested === "string") {
      output[key] = maskWhatsAppPhone(nested)
      continue
    }
    output[key] = redactWhatsAppPayload(nested)
  }
  return output
}

export function safeErrorMessage(error: unknown) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

export function safeStackTrace(error: unknown) {
  if (!(error instanceof Error) || !error.stack) return null
  return redactString(error.stack)
}

export function classifyWhatsAppError(error: unknown): WhatsAppFailureClassification {
  const message = safeErrorMessage(error)
  const lower = message.toLowerCase()

  if (/phone number|malformed|invalid jid|invalid wid|wid|not registered|country code|leading zero/.test(lower)) {
    return { errorCode: "INVALID_RECIPIENT", failureReason: "invalid_jid", retryable: false }
  }
  if (/rate|too many|429|throttle/.test(lower)) {
    return { errorCode: "RATE_LIMIT", failureReason: "rate_limit", retryable: true }
  }
  if (/auth|unauth|unpaired|logout|invalidated/.test(lower)) {
    return { errorCode: "AUTH_STATE_INVALID", failureReason: "auth_state_invalid", retryable: false }
  }
  if (/browser|chromium|puppeteer|target closed|page crashed|process|executable/.test(lower)) {
    return { errorCode: "BROWSER_FAILURE", failureReason: "chromium_crash", retryable: true }
  }
  if (/session|ready|disconnected|closed|timeout|timed out/.test(lower)) {
    return { errorCode: "SESSION_NOT_READY", failureReason: "session_not_ready", retryable: true }
  }
  if (/network|econn|socket|dns|redis|connection|offline/.test(lower)) {
    return { errorCode: "TEMPORARY_NETWORK", failureReason: "temporary_network", retryable: true }
  }
  if (/media|file|enoent|mime/.test(lower)) {
    return { errorCode: "MEDIA_FAILURE", failureReason: "media_failure", retryable: false }
  }
  return { errorCode: "WHATSAPP_SEND_FAILED", failureReason: "provider_error", retryable: true }
}

export function ackToWhatsAppStatus(ack: unknown): WhatsAppLifecycleStatus {
  const value = Number(ack)
  if (value < 0) return "failed"
  if (value === 0) return "queued"
  if (value === 1) return "whatsapp_server_ack"
  if (value === 2) return "whatsapp_device_ack"
  if (value === 3) return "read"
  if (value >= 4) return "played"
  return "whatsapp_server_ack"
}

export function lifecycleTimestampField(status: WhatsAppLifecycleStatus) {
  if (status === "queued") return "queuedAt"
  if (status === "processing") return "processingAt"
  if (status === "browser_connecting") return "processingAt"
  if (status === "browser_ready") return "processingAt"
  if (status === "sending") return "sendingAt"
  if (status === "sent" || status === "whatsapp_server_ack") return "sentAt"
  if (status === "delivered" || status === "whatsapp_device_ack") return "deliveredAt"
  if (status === "read" || status === "played") return "readAt"
  if (status === "failed") return "failedAt"
  if (status === "abandoned") return "abandonedAt"
  return null
}

export function isFinalWhatsAppDeliveryStatus(status: WhatsAppLifecycleStatus) {
  return ["whatsapp_device_ack", "delivered", "read", "played"].includes(status)
}

export function isWhatsAppAckSuccessStatus(status: WhatsAppLifecycleStatus) {
  return ["whatsapp_server_ack", "whatsapp_device_ack", "delivered", "read", "played"].includes(status)
}

export async function writeWhatsAppLog(input: {
  level?: "info" | "warn" | "error"
  event: string
  status?: string | null
  message?: string | null
  customerId?: string | null
  campaignId?: string | null
  campaignLogId?: string | null
  messageLogId?: string | null
  queueName?: string | null
  queueJobId?: string | number | null
  phoneHash?: string | null
  maskedPhone?: string | null
  failureReason?: string | null
  metadata?: Record<string, unknown>
}) {
  return (prisma as any).whatsAppLog.create({
    data: {
      level: input.level || "info",
      event: input.event,
      status: input.status || null,
      message: null,
      customerId: input.customerId || null,
      campaignId: input.campaignId || null,
      campaignLogId: input.campaignLogId || null,
      messageLogId: input.messageLogId || null,
      queueName: input.queueName || null,
      queueJobId: input.queueJobId ? String(input.queueJobId) : null,
      phoneHash: input.phoneHash || null,
      maskedPhone: input.maskedPhone || null,
      failureReason: input.failureReason || null,
      metadata: (redactWhatsAppPayload(input.metadata || {}) || {}) as any,
    },
  }).catch(() => null)
}

export async function writeWhatsAppQueueLog(input: {
  queueName: string
  queueJobId?: string | number | null
  event: string
  status?: string | null
  customerId?: string | null
  campaignId?: string | null
  campaignLogId?: string | null
  messageLogId?: string | null
  phoneHash?: string | null
  maskedPhone?: string | null
  attempt?: number
  latencyMs?: number | null
  processingMs?: number | null
  failureReason?: string | null
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  return (prisma as any).whatsAppQueueLog.create({
    data: {
      queueName: input.queueName,
      queueJobId: input.queueJobId ? String(input.queueJobId) : null,
      event: input.event,
      status: input.status || null,
      customerId: input.customerId || null,
      campaignId: input.campaignId || null,
      campaignLogId: input.campaignLogId || null,
      messageLogId: input.messageLogId || null,
      phoneHash: input.phoneHash || null,
      maskedPhone: input.maskedPhone || null,
      attempt: Number(input.attempt || 0),
      latencyMs: Number.isFinite(input.latencyMs) ? Number(input.latencyMs) : null,
      processingMs: Number.isFinite(input.processingMs) ? Number(input.processingMs) : null,
      failureReason: input.failureReason || null,
      payload: (redactWhatsAppPayload(input.payload || {}) || {}) as any,
      metadata: (redactWhatsAppPayload(input.metadata || {}) || {}) as any,
    },
  }).catch(() => null)
}

export async function writeWhatsAppErrorLog(input: {
  error: unknown
  queueName?: string | null
  queueJobId?: string | number | null
  customerId?: string | null
  campaignId?: string | null
  campaignLogId?: string | null
  messageLogId?: string | null
  phoneHash?: string | null
  maskedPhone?: string | null
  metadata?: Record<string, unknown>
}) {
  const classification = classifyWhatsAppError(input.error)
  const message = safeErrorMessage(input.error)
  return (prisma as any).whatsAppErrorLog.create({
    data: {
      errorCode: classification.errorCode,
      failureReason: classification.failureReason,
      message: truncateLargeString(String(redactWhatsAppPayload(message)), 4000) || "WhatsApp error",
      stackTrace: safeStackTrace(input.error),
      queueName: input.queueName || null,
      queueJobId: input.queueJobId ? String(input.queueJobId) : null,
      customerId: input.customerId || null,
      campaignId: input.campaignId || null,
      campaignLogId: input.campaignLogId || null,
      messageLogId: input.messageLogId || null,
      phoneHash: input.phoneHash || null,
      maskedPhone: input.maskedPhone || null,
      retryable: classification.retryable,
      metadata: (redactWhatsAppPayload(input.metadata || {}) || {}) as any,
    },
  }).catch(() => null)
}

export async function writeWhatsAppSessionLog(input: {
  event: string
  status?: string | null
  waState?: string | null
  reason?: string | null
  reconnectCount?: number
  browserPid?: number | null
  browserMemoryMb?: number | null
  browserUptimeSec?: number | null
  authStatus?: string | null
  sessionInvalidated?: boolean
  metadata?: Record<string, unknown>
}) {
  return (prisma as any).whatsAppSessionLog.create({
    data: {
      event: input.event,
      status: input.status || null,
      waState: input.waState || null,
      reason: input.reason ? truncateLargeString(String(redactWhatsAppPayload(input.reason)), 2000) : null,
      reconnectCount: Number(input.reconnectCount || 0),
      browserPid: Number.isInteger(input.browserPid) ? input.browserPid : null,
      browserMemoryMb: Number.isInteger(input.browserMemoryMb) ? input.browserMemoryMb : null,
      browserUptimeSec: Number.isInteger(input.browserUptimeSec) ? input.browserUptimeSec : null,
      authStatus: input.authStatus || null,
      sessionInvalidated: Boolean(input.sessionInvalidated),
      metadata: (redactWhatsAppPayload(input.metadata || {}) || {}) as any,
    },
  }).catch(() => null)
}

export async function upsertWhatsAppRuntimeState(input: Record<string, unknown>) {
  const data = sanitizeRuntimeState(input)
  return (prisma as any).whatsAppRuntimeState.upsert({
    where: { id: WHATSAPP_RUNTIME_ID },
    create: { id: WHATSAPP_RUNTIME_ID, ...data },
    update: data,
  }).catch(() => null)
}

function sanitizeRuntimeState(input: Record<string, unknown>) {
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value instanceof Date || value === null || value === undefined) {
      data[key] = value
      continue
    }
    if (typeof value === "boolean" || typeof value === "number") {
      data[key] = value
      continue
    }
    if (key === "metadata") {
      data[key] = (redactWhatsAppPayload(value || {}) || {}) as any
      continue
    }
    if (typeof value === "string") {
      data[key] = /error|reason|qrData/i.test(key) ? redactWhatsAppPayload(value) : value
      continue
    }
    data[key] = redactWhatsAppPayload(value)
  }
  return data
}

export async function createWhatsAppMessageLifecycle(input: {
  to: string
  messageType?: string | null
  category?: string | null
  templateKey?: string | null
  templateName?: string | null
  templateVersionId?: string | null
  templateLanguage?: string | null
  queueName?: string | null
  queueJobId?: string | number | null
  customerId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  ticketId?: string | null
  campaignId?: string | null
  campaignLogId?: string | null
  metadata?: Record<string, unknown>
}) {
  const normalized = normalizeWhatsAppNumber(input.to)
  const row = await (prisma as any).whatsAppMessageLog.create({
    data: {
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      invoiceId: input.invoiceId || null,
      ticketId: input.ticketId || null,
      campaignId: input.campaignId || null,
      campaignLogId: input.campaignLogId || null,
      toMasked: normalized.maskedPhone,
      phoneHash: normalized.phoneHash,
      messageType: input.messageType || "text",
      category: input.category || "transactional",
      templateKey: input.templateKey || null,
      templateName: input.templateName || null,
      templateVersionId: input.templateVersionId || null,
      templateLanguage: input.templateLanguage || null,
      queueName: input.queueName || null,
      queueJobId: input.queueJobId ? String(input.queueJobId) : null,
      status: "queued",
      queuedAt: new Date(),
      metadata: (redactWhatsAppPayload(input.metadata || {}) || {}) as any,
    },
  })
  await writeWhatsAppLog({
    event: "message.queued",
    status: "queued",
    messageLogId: row.id,
    customerId: input.customerId || null,
    campaignId: input.campaignId || null,
    campaignLogId: input.campaignLogId || null,
    queueName: input.queueName || null,
    queueJobId: input.queueJobId || null,
    phoneHash: normalized.phoneHash,
    maskedPhone: normalized.maskedPhone,
    metadata: input.metadata || {},
  })
  return { row, normalized }
}

export async function transitionWhatsAppMessage(input: {
  messageLogId?: string | null
  campaignLogId?: string | null
  campaignId?: string | null
  status: WhatsAppLifecycleStatus
  providerMessageId?: string | null
  providerResponse?: Record<string, unknown> | null
  failureReason?: string | null
  errorMessage?: string | null
  stackTrace?: string | null
  retryCount?: number | null
  queueName?: string | null
  queueJobId?: string | number | null
  metadata?: Record<string, unknown>
}) {
  const persistedStatus = input.status === "whatsapp_device_ack" ? "delivered" : input.status
  const timestampField = lifecycleTimestampField(input.status)
  const now = new Date()
  const data: Record<string, unknown> = {
    status: persistedStatus,
    ...(timestampField ? { [timestampField]: now } : {}),
    ...(input.providerMessageId ? { providerMessageId: input.providerMessageId, whatsappMessageId: input.providerMessageId } : {}),
    ...(input.providerResponse ? { providerResponse: redactWhatsAppPayload(input.providerResponse) } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    ...(input.errorMessage ? { errorMessage: truncateLargeString(String(redactWhatsAppPayload(input.errorMessage)), 4000) } : {}),
    ...(input.stackTrace ? { stackTrace: input.stackTrace } : {}),
    ...(Number.isInteger(input.retryCount) ? { retryCount: input.retryCount } : {}),
    ...(input.queueName ? { queueName: input.queueName } : {}),
    ...(input.queueJobId ? { queueJobId: String(input.queueJobId) } : {}),
  }

  const message = input.messageLogId
    ? await (prisma as any).whatsAppMessageLog.update({ where: { id: input.messageLogId }, data }).catch(() => null)
    : null

  if (input.campaignLogId) {
    await (prisma as any).whatsAppCampaignLog.update({
      where: { id: input.campaignLogId },
      data: {
        ...data,
        ...(input.status === "queued" ? { pendingAt: now } : {}),
      },
    }).catch(() => null)
  }

  await writeWhatsAppLog({
    level: input.status === "failed" || input.status === "abandoned" ? "warn" : "info",
    event: `message.${input.status}`,
    status: persistedStatus,
    messageLogId: input.messageLogId || null,
    campaignId: input.campaignId || null,
    campaignLogId: input.campaignLogId || null,
    queueName: input.queueName || null,
    queueJobId: input.queueJobId || null,
    phoneHash: message?.phoneHash || null,
    maskedPhone: message?.toMasked || null,
    failureReason: input.failureReason || null,
    metadata: input.metadata || {},
  })

  return message
}

type PendingAck = {
  minAck: number
  resolve: (value: WhatsAppAckWaitResult) => void
  timer: NodeJS.Timeout
}

export type WhatsAppAckWaitResult = {
  providerMessageId: string
  ack: number
  status: WhatsAppLifecycleStatus
  final: boolean
  timedOut?: boolean
  providerResponse?: Record<string, unknown>
}

const pendingAckWaiters = new Map<string, Set<PendingAck>>()

function ackValueForStatus(status: WhatsAppLifecycleStatus) {
  if (status === "failed") return -1
  if (status === "whatsapp_server_ack" || status === "sent") return 1
  if (status === "whatsapp_device_ack" || status === "delivered") return 2
  if (status === "read") return 3
  if (status === "played") return 4
  return 0
}

function settlePendingAck(providerMessageId: string, ack: number, providerResponse?: Record<string, unknown>) {
  const waiters = pendingAckWaiters.get(providerMessageId)
  if (!waiters?.size) return
  const status = ackToWhatsAppStatus(ack)
  for (const waiter of Array.from(waiters)) {
    if (ack < 0 || ack >= waiter.minAck) {
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve({
        providerMessageId,
        ack,
        status,
        final: ack < 0 || ack >= waiter.minAck,
        providerResponse,
      })
    }
  }
  if (!waiters.size) pendingAckWaiters.delete(providerMessageId)
}

async function latestAckForProviderMessage(providerMessageId: string) {
  const delivery = await (prisma as any).whatsAppDeliveryLog.findFirst({
    where: { providerMessageId },
    orderBy: { createdAt: "desc" },
    select: { ack: true, status: true, providerResponse: true },
  }).catch(() => null)
  if (!delivery) return null
  const ack = Number.isInteger(delivery.ack) ? Number(delivery.ack) : ackValueForStatus(delivery.status)
  return {
    providerMessageId,
    ack,
    status: ackToWhatsAppStatus(ack),
    final: ack < 0,
    providerResponse: delivery.providerResponse && typeof delivery.providerResponse === "object" ? delivery.providerResponse as Record<string, unknown> : {},
  } satisfies WhatsAppAckWaitResult
}

export async function waitForWhatsAppDeliveryAck(input: {
  providerMessageId: string
  minAck?: number
  timeoutMs?: number
  pollMs?: number
}): Promise<WhatsAppAckWaitResult> {
  const providerMessageId = String(input.providerMessageId || "").trim()
  if (!providerMessageId) throw new Error("WhatsApp provider message ID is required before waiting for ACK.")
  const minAck = Math.max(1, Number(input.minAck || 2))
  const timeoutMs = Math.max(1_000, Number(input.timeoutMs || process.env.WHATSAPP_ACK_TIMEOUT_MS || 90_000))
  const pollMs = Math.max(250, Number(input.pollMs || process.env.WHATSAPP_ACK_POLL_MS || 1_000))
  const existing = await latestAckForProviderMessage(providerMessageId)
  if (existing && (existing.ack < 0 || existing.ack >= minAck)) return { ...existing, final: true }

  return new Promise((resolve) => {
    let settled = false
    let interval: NodeJS.Timeout | null = null
    const waiters = pendingAckWaiters.get(providerMessageId) || new Set<PendingAck>()
    pendingAckWaiters.set(providerMessageId, waiters)
    let waiter: PendingAck

    const cleanup = () => {
      if (settled) return false
      settled = true
      if (interval) clearInterval(interval)
      waiters.delete(waiter)
      if (!waiters.size) pendingAckWaiters.delete(providerMessageId)
      return true
    }

    waiter = {
      minAck,
      resolve: (value) => {
        if (!cleanup()) return
        resolve(value)
      },
      timer: setTimeout(() => {
        if (!cleanup()) return
        resolve({
          providerMessageId,
          ack: 0,
          status: "queued",
          final: false,
          timedOut: true,
        })
      }, timeoutMs),
    }
    waiters.add(waiter)

    interval = setInterval(() => {
      void latestAckForProviderMessage(providerMessageId).then((ack) => {
        if (!ack) return
        if (ack.ack < 0 || ack.ack >= minAck) waiter.resolve({ ...ack, final: true })
      }).catch(() => null)
    }, pollMs)
  })
}

export async function recordWhatsAppDeliveryAck(input: {
  providerMessageId: string
  ack: number
  providerResponse?: Record<string, unknown>
}) {
  const status = ackToWhatsAppStatus(input.ack)
  const now = new Date()
  const log = await (prisma as any).whatsAppMessageLog.findFirst({
    where: {
      OR: [
        { providerMessageId: input.providerMessageId },
        { whatsappMessageId: input.providerMessageId },
      ],
    },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)

  const campaignLog = log?.campaignLogId
    ? await (prisma as any).whatsAppCampaignLog.findUnique({ where: { id: log.campaignLogId } }).catch(() => null)
    : null

  await (prisma as any).whatsAppDeliveryLog.create({
    data: {
      messageLogId: log?.id || null,
      campaignId: log?.campaignId || campaignLog?.campaignId || null,
      campaignLogId: log?.campaignLogId || null,
      customerId: log?.customerId || campaignLog?.customerId || null,
      phoneHash: log?.phoneHash || campaignLog?.phoneHash || null,
      maskedPhone: log?.toMasked || campaignLog?.toMasked || null,
      whatsappMessageId: input.providerMessageId,
      providerMessageId: input.providerMessageId,
      ack: input.ack,
      status,
      providerResponse: (redactWhatsAppPayload(input.providerResponse || {}) || {}) as any,
      deliveredAt: status === "whatsapp_device_ack" || status === "delivered" || status === "read" || status === "played" ? now : null,
      readAt: status === "read" || status === "played" ? now : null,
    },
  }).catch(() => null)

  if (log?.id && (isWhatsAppAckSuccessStatus(status) || status === "failed")) {
    await transitionWhatsAppMessage({
      messageLogId: log.id,
      campaignLogId: log.campaignLogId || null,
      campaignId: log.campaignId || null,
      status,
      providerMessageId: input.providerMessageId,
      providerResponse: input.providerResponse || {},
    })
  }

  settlePendingAck(input.providerMessageId, input.ack, input.providerResponse || {})

  if (log?.campaignId) await syncWhatsAppCampaignCounters(log.campaignId)
}

export async function syncWhatsAppCampaignCounters(campaignId: string) {
  const statuses = ["queued", "processing", "browser_connecting", "browser_ready", "sending", "sent", "whatsapp_server_ack", "whatsapp_device_ack", "delivered", "read", "played", "failed", "retrying", "abandoned", "pending"]
  const counts = await Promise.all(statuses.map((status) =>
    (prisma as any).whatsAppCampaignLog.count({ where: { campaignId, status } }).catch(() => 0),
  ))
  const byStatus = Object.fromEntries(statuses.map((status, index) => [status, counts[index] || 0]))
  const retryAgg = await (prisma as any).whatsAppCampaignLog.aggregate({
    where: { campaignId },
    _sum: { retryCount: true },
  }).catch(() => ({ _sum: { retryCount: 0 } }))
  const total = await (prisma as any).whatsAppCampaignLog.count({ where: { campaignId } }).catch(() => 0)
  const pending = Number(byStatus.pending || 0) + Number(byStatus.queued || 0) + Number(byStatus.retrying || 0)
  const processing = Number(byStatus.processing || 0) + Number(byStatus.browser_connecting || 0) + Number(byStatus.browser_ready || 0) + Number(byStatus.sending || 0)
  const sent = Number(byStatus.sent || 0) + Number(byStatus.whatsapp_server_ack || 0) + Number(byStatus.whatsapp_device_ack || 0) + Number(byStatus.delivered || 0) + Number(byStatus.read || 0) + Number(byStatus.played || 0)
  const failed = Number(byStatus.failed || 0)
  const abandoned = Number(byStatus.abandoned || 0)
  const done = total > 0 && pending + processing === 0

  return (prisma as any).whatsAppCampaign.update({
    where: { id: campaignId },
    data: {
      total,
      queued: Number(byStatus.queued || 0),
      processing,
      pending,
      sent,
      delivered: Number(byStatus.whatsapp_device_ack || 0) + Number(byStatus.delivered || 0) + Number(byStatus.read || 0) + Number(byStatus.played || 0),
      read: Number(byStatus.read || 0) + Number(byStatus.played || 0),
      failed,
      retries: Number(retryAgg?._sum?.retryCount || 0),
      abandoned,
      status: done ? "completed" : "running",
      completedAt: done ? new Date() : null,
    },
  }).catch(() => null)
}

export async function getWhatsAppRuntimeState() {
  return (prisma as any).whatsAppRuntimeState.findUnique({ where: { id: WHATSAPP_RUNTIME_ID } }).catch(() => null)
}

export async function getWhatsAppAnalytics() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [sentToday, failedToday, deliveredToday, readToday, otpSent, otpFailed, campaignSent, campaignFailed] = await Promise.all([
    (prisma as any).whatsAppMessageLog.count({ where: { status: { in: ["whatsapp_server_ack", "delivered", "read", "played"] }, createdAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppMessageLog.count({ where: { status: { in: ["failed", "abandoned"] }, createdAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppMessageLog.count({ where: { status: { in: ["delivered", "read"] }, deliveredAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppMessageLog.count({ where: { status: { in: ["read", "played"] }, readAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppMessageLog.count({ where: { category: "auth", status: { in: ["whatsapp_server_ack", "delivered", "read", "played"] }, createdAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppMessageLog.count({ where: { category: "auth", status: { in: ["failed", "abandoned"] }, createdAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppCampaignLog.count({ where: { status: { in: ["whatsapp_server_ack", "delivered", "read", "played"] }, createdAt: { gte: today } } }).catch(() => 0),
    (prisma as any).whatsAppCampaignLog.count({ where: { status: { in: ["failed", "abandoned"] }, createdAt: { gte: today } } }).catch(() => 0),
  ])
  return {
    sentToday,
    failedToday,
    deliveredToday,
    readToday,
    otpSuccessRate: otpSent + otpFailed ? Math.round((otpSent / (otpSent + otpFailed)) * 100) : 100,
    campaignSuccessRate: campaignSent + campaignFailed ? Math.round((campaignSent / (campaignSent + campaignFailed)) * 100) : 100,
  }
}

export function getProcessMemoryMb(pid?: number | null) {
  if (!pid || pid === process.pid) return Math.round(process.memoryUsage().rss / 1024 / 1024)
  return null
}

export function workerMetadata() {
  return {
    hostname: os.hostname(),
    processPid: process.pid,
    nodeVersion: process.version,
    uptimeSec: Math.round(process.uptime()),
  }
}
