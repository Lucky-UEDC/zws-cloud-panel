import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { badRequest, jsonError, noStoreHeaders, requireGatewayAdmin } from "../../../_shared"
import { getGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { updateGatewayMessage } from "@/lib/whatsapp-gateway/messages"
import { sanitizeErrorMessage } from "@/lib/whatsapp-gateway/errors"
import { assertPublicMediaUrl, MediaUrlValidationError } from "@/lib/whatsapp-gateway/ssrf"
import type { SendResult } from "@/lib/whatsapp-gateway/types"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireGatewayAdmin(request)
    const { id } = await context.params
    const settings = await getGatewaySettings()
    if (!settings.apiBaseUrl) return badRequest("Gateway base URL is not configured")
    if (!settings.enabled) return badRequest("WhatsApp Gateway is not enabled")

    const existing = await prisma.whatsAppGatewayMessage.findUnique({ where: { id } })
    if (!existing) return badRequest("Message not found")
    if (existing.status === "sent") return badRequest("Message was already sent")
    if (existing.messageType === "multiple_media") return badRequest("Multiple media messages cannot be retried from the gateway")

    await updateGatewayMessage(id, { status: "sending", sanitizedError: null, retryCount: { increment: 1 } })

    const provider = new WhatsAppGatewayProvider(settings)
    const base = {
      contactNo: existing.contactNo,
      senderNumber: existing.senderNumber || undefined,
      senderNumberId: existing.senderNumberId || undefined,
      wabaId: existing.wabaId || undefined,
    }

    let result: SendResult
    const startedAt = Date.now()
    try {
      if (existing.mediaUrl && existing.mediaUrl !== "{}") {
        const approved = await assertPublicMediaUrl(existing.mediaUrl, undefined, { allowAnyPolicy: settings.mediaUrlPolicy === "any" }).catch((error) => {
          if (error instanceof MediaUrlValidationError) throw Object.assign(new Error(error.message), { status: 400 })
          throw error
        })
        if (existing.messageType === "image") result = await provider.sendImage({ ...base, caption: existing.message || undefined, mediaUrl: approved })
        else if (existing.messageType === "document") result = await provider.sendDocument({ ...base, message: existing.message || undefined, mediaUrl: approved })
        else if (existing.messageType === "audio") result = await provider.sendAudio({ ...base, mediaUrl: approved })
        else result = await provider.sendVideo({ ...base, message: existing.message || undefined, mediaUrl: approved })
      } else if (existing.messageType === "location" && (existing.location as any)?.latitude !== undefined) {
        const location = existing.location as { latitude: number; longitude: number; name?: string; address?: string }
        result = await provider.sendLocation({ ...base, location })
      } else {
        result = await provider.sendText({ ...base, message: existing.message || "" })
      }
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : "Message failed")
      void updateGatewayMessage(id, { status: "failed", latencyMs: Date.now() - startedAt, sanitizedError: message }).catch(() => undefined)
      const status = (error as { status?: unknown })?.status
      const errorResponse = new Error(message)
      ;(errorResponse as Error & { status?: number }).status = typeof status === "number" && status > 0 ? status : 502
      throw errorResponse
    }

    const latencyMs = Date.now() - startedAt
    const firstResult = result.results?.[0]
    void updateGatewayMessage(id, {
      status: result.success ? "sent" : "failed",
      latencyMs,
      httpStatus: 200,
      externalMessageId: result.id || firstResult?.id || null,
      waMessageId: result.waMessageId || firstResult?.waMessageId || null,
      providerResponse: { success: result.success, message: sanitizeErrorMessage(result.message, "Message submitted") } as never,
      sanitizedError: result.success ? null : sanitizeErrorMessage(result.message),
    }).catch(() => undefined)

    return NextResponse.json({
      ok: true,
      message: {
        id,
        status: result.success ? "sent" : "failed",
        externalMessageId: result.id || firstResult?.id || null,
        waMessageId: result.waMessageId || firstResult?.waMessageId || null,
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return jsonError(error, "Message could not be retried")
  }
}