import { createPanelLog } from "@/lib/panel-log"
import { sendEmail } from "@/lib/mailer"
import { maskWhatsAppPhone, normalizeWhatsAppPhone, normalizeWhatsAppNumber } from "@/lib/whatsapp/format"
import {
  classifyWhatsAppError,
  safeErrorMessage,
  safeStackTrace,
  transitionWhatsAppMessage,
  writeWhatsAppErrorLog,
  type WhatsAppLifecycleStatus,
} from "@/lib/whatsapp/diagnostics"
import { getEvolutionSettings, sendEvolutionMedia, sendEvolutionText } from "@/lib/whatsapp/evolution"

export { maskWhatsAppPhone, normalizeWhatsAppNumber, normalizeWhatsAppPhone }

type WhatsAppSendBase = {
  to: string
  timeoutMs?: number
  skipRegistrationCheck?: boolean
  customerId?: string | null
  orderId?: string | null
  invoiceId?: string | null
  ticketId?: string | null
  campaignId?: string | null
  campaignLogId?: string | null
  templateKey?: string | null
  category?: string | null
  queueName?: string | null
  queueJobId?: string | number | null
  messageLogId?: string | null
  provider?: string | null
  metadata?: Record<string, unknown>
}

type WhatsAppMediaKind = "document" | "image" | "audio" | "video" | "sticker"

async function transition(input: WhatsAppSendBase, status: WhatsAppLifecycleStatus, extra: Record<string, unknown> = {}) {
  await transitionWhatsAppMessage({
    messageLogId: input.messageLogId || null,
    campaignLogId: input.campaignLogId || null,
    campaignId: input.campaignId || null,
    status,
    providerMessageId: typeof extra.providerMessageId === "string" ? extra.providerMessageId : undefined,
    providerResponse: extra.providerResponse as any,
    queueName: input.queueName || null,
    queueJobId: input.queueJobId || null,
    metadata: { provider: "evolution", ...(input.metadata || {}), ...extra },
  })
}

async function sendResolvedMessage(input: WhatsAppSendBase & {
  messageType: string
  send: () => Promise<{ ok: true; status: string; messageId: string; toMasked: string; phoneHash?: string; providerResponse?: unknown; timestamp: string }>
}) {
  let toMasked = input.to ? maskWhatsAppPhone(input.to) : "****"
  try {
    const normalized = normalizeWhatsAppNumber(input.to)
    toMasked = normalized.maskedPhone
    const deliverySettings = await getEvolutionSettings().catch(() => null)
    if (deliverySettings && deliverySettings.enabled === false) {
      await transition(input, "failed", {
        failureReason: "delivery_disabled_by_admin",
        errorMessage: "WhatsApp delivery is disabled by the master switch.",
        failsafe: "disabled",
      })
      throw new Error("WhatsApp delivery is disabled by the master switch.")
    }
    await transition(input, "sending", { messageType: input.messageType })
    const sent = await input.send()
    if (!sent.messageId) throw new Error("Evolution API did not return a provider message ID.")
    await transition(input, "whatsapp_server_ack", {
      messageType: input.messageType,
      providerMessageId: sent.messageId,
      providerResponse: sent.providerResponse || null,
      phoneHash: sent.phoneHash || normalized.phoneHash,
    })
    await createPanelLog({
      category: "Email",
      level: "info",
      message: "whatsapp_message_delivered_to_evolution",
      customerId: input.customerId || null,
      orderId: input.orderId || null,
      paymentId: null,
      metadata: {
        to: sent.toMasked,
        messageId: sent.messageId,
        deliveryStatus: "whatsapp_server_ack",
        messageType: input.messageType,
        channel: "whatsapp",
        provider: "evolution",
        ...(input.metadata || {}),
      },
    }).catch(() => null)

    return {
      ok: true as const,
      status: "whatsapp_server_ack",
      messageId: sent.messageId,
      toMasked: sent.toMasked,
      ack: "server",
      deliveryStatus: "whatsapp_server_ack",
      timestamp: sent.timestamp,
    }
  } catch (error) {
    const classification = classifyWhatsAppError(error)
    const message = safeErrorMessage(error)
    await transitionWhatsAppMessage({
      messageLogId: input.messageLogId || null,
      campaignLogId: input.campaignLogId || null,
      campaignId: input.campaignId || null,
      status: classification.retryable ? "retrying" : "abandoned",
      failureReason: classification.failureReason,
      errorMessage: message,
      stackTrace: safeStackTrace(error),
      queueName: input.queueName || null,
      queueJobId: input.queueJobId || null,
      metadata: { errorCode: classification.errorCode, retryable: classification.retryable, messageType: input.messageType, provider: "evolution", ...(input.metadata || {}) },
    })
    await writeWhatsAppErrorLog({
      error,
      queueName: input.queueName || null,
      queueJobId: input.queueJobId || null,
      customerId: input.customerId || null,
      campaignId: input.campaignId || null,
      campaignLogId: input.campaignLogId || null,
      messageLogId: input.messageLogId || null,
      maskedPhone: toMasked,
      metadata: { messageType: input.messageType, provider: "evolution", ...(input.metadata || {}) },
    })
    const failsafe = await getEvolutionSettings().catch(() => null).then((settings) =>
      settings?.enabled === false
        ? { mode: "disabled" as const, notifyAdminEmail: "" }
        : settings?.failsafe || { mode: "none" as const, notifyAdminEmail: "" }
    )
    if (failsafe.mode === "mark_failed") {
      await transition(input, "failed", { failureReason: classification.failureReason, errorMessage: message, failsafe: "mark_failed" }).catch(() => null)
    }
    if (failsafe.mode === "notify_admin" && failsafe.notifyAdminEmail) {
      await sendEmail({
        type: "admin",
        to: failsafe.notifyAdminEmail,
        subject: "WhatsApp provider failure",
        text: `WhatsApp message delivery failed.\n\nTo: ${toMasked}\nError: ${message}\nErrorCode: ${classification.errorCode}\nRetryable: ${classification.retryable}\nMessageType: ${input.messageType}`,
        logMessage: "whatsapp_failsafe_admin_notification",
        metadata: { channel: "whatsapp", failsafe: true, errorCode: classification.errorCode, retryable: classification.retryable },
      }).catch(() => null)
    }
    throw error
  }
}

export async function sendWhatsAppText(input: WhatsAppSendBase & {
  message: string
}) {
  return sendResolvedMessage({
    ...input,
    messageType: "text",
    send: () => sendEvolutionText({ to: input.to, message: input.message }),
  })
}

export async function sendWhatsAppMessage(number: string, message: string) {
  const sent = await sendWhatsAppText({
    to: number,
    message,
    category: "transactional",
    skipRegistrationCheck: true,
    metadata: { source: "evolution_direct_send" },
  })
  console.info("[WA] Evolution message sent", { to: sent.toMasked, messageId: sent.messageId || null })
  return sent
}

export async function sendWhatsAppMedia(input: WhatsAppSendBase & {
  filePath: string
  caption?: string | null
  mediaType?: WhatsAppMediaKind
}) {
  const mediaType = input.mediaType || "document"
  return sendResolvedMessage({
    ...input,
    messageType: mediaType,
    send: () => sendEvolutionMedia({ to: input.to, filePath: input.filePath, caption: input.caption, mediaType }),
  })
}

export async function sendWhatsAppDocument(input: WhatsAppSendBase & {
  filePath: string
  caption?: string | null
}) {
  return sendWhatsAppMedia({ ...input, mediaType: "document" })
}

export async function sendWhatsAppImage(input: WhatsAppSendBase & {
  filePath: string
  caption?: string | null
}) {
  return sendWhatsAppMedia({ ...input, mediaType: "image" })
}
