import { NextResponse } from "next/server"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { createGatewayMessage, updateGatewayMessage } from "@/lib/whatsapp-gateway/messages"
import { attachContactIdFactory } from "@/lib/whatsapp-gateway/contacts"
import { assertPublicMediaUrl, MediaUrlValidationError } from "@/lib/whatsapp-gateway/ssrf"
import { gatewayLocalMediaUploadSchema, gatewaySendDraftSchema } from "@/lib/whatsapp-gateway/validate"
import { sanitizeErrorMessage } from "@/lib/whatsapp-gateway/errors"
import type { SendResult, WhatsAppGatewayMessageType } from "@/lib/whatsapp-gateway/types"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { gatewayLoggingEnabled, logGatewayEvent } from "@/lib/whatsapp-gateway/audit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_BODY_BYTES = 8 * 1024 * 1024

async function requireEnabled(settings: Awaited<ReturnType<typeof getGatewaySettings>>) {
  if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
  if (!settings.enabled) return badRequest("WhatsApp Gateway is not enabled")
  return undefined as never
}

async function validateMediaUrl(rawUrl: string | undefined, policy: "public" | "any") {
  if (!rawUrl) return rawUrl
  try {
    return await assertPublicMediaUrl(rawUrl, undefined, { allowAnyPolicy: policy === "any" })
  } catch (error) {
    if (error instanceof MediaUrlValidationError) return badRequest(error.message)
    return badRequest("Media URL could not be validated")
  }
}

type NormalizedSend = {
  messageType: WhatsAppGatewayMessageType
  contactNo: string
  contactId?: string
  senderNumber?: string
  senderNumberId?: string
  wabaId?: string
  message?: string
  mediaUrl?: string
  mediaUrls?: string[]
  mediaName?: string
  location?: { latitude: number; longitude: number; name?: string; address?: string }
}

function dispatchSend(provider: WhatsAppGatewayProvider, input: NormalizedSend): Promise<SendResult> {
  const base = { contactNo: input.contactNo, senderNumber: input.senderNumber, senderNumberId: input.senderNumberId, wabaId: input.wabaId }
  switch (input.messageType) {
    case "text":
      return provider.sendText({ ...base, message: input.message || "" })
    case "image":
      return provider.sendImage({ ...base, caption: input.message, mediaUrl: input.mediaUrl })
    case "document":
      return provider.sendDocument({ ...base, message: input.message, mediaUrl: input.mediaUrl })
    case "audio":
      return provider.sendAudio({ ...base, mediaUrl: input.mediaUrl })
    case "video":
      return provider.sendVideo({ ...base, message: input.message, mediaUrl: input.mediaUrl })
    case "multiple_media":
      return provider.sendMultipleMedia({ ...base, mediaUrls: input.mediaUrls || [], message: input.message })
    case "location":
      return provider.sendLocation({ ...base, location: input.location ?? { latitude: 0, longitude: 0 } })
    default:
      return Promise.reject(new Error(`Unsupported message type: ${input.messageType}`))
  }
}

export async function POST(request: Request) {
  try {
    await requireGatewayAdmin(request)

    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > MAX_BODY_BYTES) return badRequest("Payload too large")

    const contentType = request.headers.get("content-type") || ""
    const isMultipart = contentType.toLowerCase().includes("multipart/form-data")
    const settings = await getGatewaySettings()
    await requireEnabled(settings)
    const provider = new WhatsAppGatewayProvider(settings)
    const sentBy = (await getAdminFromCookies())?.email ?? null

    let normalized: NormalizedSend
    let localMedia: { file: File; mimeType: string } | null = null

    if (isMultipart) {
      const form = await request.formData()
      const file = form.get("file_url")
      if (!(file instanceof File)) return badRequest("file_url must be a file upload")
      const fields: Record<string, string> = {}
      for (const key of ["fileName", "mimeType", "whatsappPhoneNumberId", "contactId", "message", "messageType"]) {
        const value = form.get(key)
        if (typeof value === "string") fields[key] = value
      }
      const parsed = gatewayLocalMediaUploadSchema.safeParse({
        ...fields,
        messageType: form.get("messageType") || fields.messageType,
        fileName: file.name || fields.fileName,
        mimeType: file.type || fields.mimeType,
      })
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return badRequest(issue ? issue.message : "Invalid multipart upload")
      }
      const contact = await prisma.whatsAppGatewayContact.findUnique({ where: { id: parsed.data.contactId } })
      if (!contact) return badRequest("Contact not found")
      if (file.size > MAX_BODY_BYTES) return badRequest("File too large")

      normalized = {
        messageType: parsed.data.messageType,
        contactNo: contact.phoneNumber,
        senderNumber: undefined,
        senderNumberId: parsed.data.whatsappPhoneNumberId,
        message: parsed.data.message,
        mediaName: parsed.data.fileName,
      }
      localMedia = { file, mimeType: parsed.data.mimeType }
    } else {
      const body = await request.json().catch(() => badRequest("Invalid JSON body"))
      const parsed = gatewaySendDraftSchema.safeParse(body)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        return badRequest(issue ? issue.message : "Invalid message payload")
      }
      const data = parsed.data
      if (data.messageType === "local_media") {
        return badRequest("Local media uploads require a file (use multipart/form-data)")
      }

      const policy = settings.mediaUrlPolicy
      const approvedMediaUrls: string[] = []
      if (data.mediaUrls) {
        for (const raw of data.mediaUrls) {
          const approved = await validateMediaUrl(raw, policy)
          if (approved) approvedMediaUrls.push(approved)
        }
      }
      const approvedMediaUrl = await validateMediaUrl(data.mediaUrl, policy)
      const contactResolver = attachContactIdFactory()
      const contact = await contactResolver.resolve(data.contactNo, body?.contactName, body?.contactEmail, sentBy)

      normalized = {
        messageType: data.messageType as WhatsAppGatewayMessageType,
        contactNo: contact.digits,
        contactId: contact.contactId ?? undefined,
        senderNumber: data.senderNumber || settings.defaultSenderNumber || undefined,
        senderNumberId: data.senderNumberId || settings.defaultSenderNumberId || undefined,
        wabaId: data.wabaId || settings.defaultWabaId || undefined,
        message: data.message,
        mediaUrl: approvedMediaUrl,
        mediaUrls: approvedMediaUrls.length ? approvedMediaUrls : undefined,
        mediaName: data.mediaName,
        location: data.location,
      }
    }

    const idempotencyKey = request.headers.get("idempotency-key")
    if (idempotencyKey) {
      const recent = await prisma.whatsAppGatewayMessage.findFirst({
        where: { provider: "whatsapp_gateway", gatewayId: idempotencyKey, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
      })
      if (recent) {
        return NextResponse.json(
          { ok: true, duplicate: true, message: { id: recent.id, status: recent.status, createdAt: recent.createdAt } },
          { headers: noStoreHeaders },
        )
      }
    }

    const record = await createGatewayMessage({
      provider: "whatsapp_gateway",
      contactNo: normalized.contactNo,
      contactId: normalized.contactId,
      messageType: normalized.messageType,
      message: normalized.message,
      mediaUrl: normalized.mediaUrl,
      mediaName: normalized.mediaName,
      mediaMimeType: localMedia?.mimeType,
      location: normalized.location,
      senderNumber: normalized.senderNumber,
      senderNumberId: normalized.senderNumberId,
      wabaId: normalized.wabaId,
      sentBy,
    })
    if (idempotencyKey) {
      await updateGatewayMessage(record.id, { gatewayId: idempotencyKey })
    }

    const startedAt = Date.now()
    let result: SendResult
    try {
      if (localMedia) {
        result = await provider.sendLocalMedia({
          file: localMedia.file,
          fileName: normalized.mediaName || "upload",
          mimeType: localMedia.mimeType,
          whatsappPhoneNumberId: normalized.senderNumberId || "",
          contactId: normalized.contactNo,
          message: normalized.message,
          provider: "business_api",
          messageType: normalized.messageType,
        })
      } else {
        result = await dispatchSend(provider, normalized)
      }
    } catch (error) {
      const latencyMs = Date.now() - startedAt
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : "Message failed")
      void updateGatewayMessage(record.id, {
        status: "failed",
        latencyMs,
        sanitizedError: message,
      }).catch(() => undefined)
      const status = (error as { status?: unknown })?.status
      const errorResponse = new Error(message)
      ;(errorResponse as Error & { status?: number }).status = typeof status === "number" && status > 0 ? status : 502
      throw errorResponse
    }

    const latencyMs = Date.now() - startedAt
    const firstResult = result.results?.[0]
    void updateGatewayMessage(record.id, {
      status: result.success ? "sent" : "failed",
      latencyMs,
      httpStatus: 200,
      externalMessageId: result.id || firstResult?.id || null,
      waMessageId: result.waMessageId || firstResult?.waMessageId || null,
      providerResponse: { success: result.success, message: sanitizeErrorMessage(result.message, "Message submitted") } as never,
      sanitizedError: result.success ? null : sanitizeErrorMessage(result.message),
    }).catch(() => undefined)

    if (gatewayLoggingEnabled(settings)) {
      void logGatewayEvent({
        settings,
        level: result.success ? "info" : "warn",
        message: `WhatsApp Gateway message ${result.success ? "sent" : "failed"} (${normalized.messageType})`,
        metadata: {
          maskedContact: record.maskedContact,
          messageType: normalized.messageType,
          status: result.success ? "sent" : "failed",
          latencyMs,
          externalMessageId: result.id || firstResult?.id,
        },
        actorEmail: sentBy,
      })
    }

    return NextResponse.json({
      ok: true,
      message: {
        id: record.id,
        status: result.success ? "sent" : "failed",
        externalMessageId: result.id || firstResult?.id || null,
        waMessageId: result.waMessageId || firstResult?.waMessageId || null,
        provider: { success: result.success, message: result.message },
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error, "Message could not be sent")
  }
}