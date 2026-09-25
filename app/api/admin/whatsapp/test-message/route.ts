import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"
import { getAdminFromCookies } from "@/lib/server-auth"
import { badRequest, jsonError, noStoreHeaders, requireWhatsAppAdmin } from "../_shared"
import { DEFAULT_EVOLUTION_TEST_RECIPIENT, getEvolutionSettings, sendEvolutionText, verifyEvolutionApi } from "@/lib/whatsapp/evolution"
import {
  createWhatsAppMessageLifecycle,
  transitionWhatsAppMessage,
  waitForWhatsAppDeliveryAck,
} from "@/lib/whatsapp/diagnostics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: NextRequest) {
  try {
    await requireWhatsAppAdmin(request)

    const body = await request.json().catch(() => ({}))
    const settings = await getEvolutionSettings()
    const phone = textValue(body?.phone) || DEFAULT_EVOLUTION_TEST_RECIPIENT || settings.testRecipient
    const message = textValue(body?.message)

    if (!phone) badRequest("A test phone number is required.")
    if (!message) badRequest("Message is required.")
    if (message.length > 4000) badRequest("Message must be 4000 characters or fewer.")

    await verifyEvolutionApi()
    const lifecycle = await createWhatsAppMessageLifecycle({
      to: phone,
      messageType: "text",
      category: "transactional",
      templateKey: "admin_test",
      metadata: { source: "admin_whatsapp_test", directProviderSend: true },
    })
    await transitionWhatsAppMessage({
      messageLogId: lifecycle.row.id,
      status: "sending",
      metadata: { source: "admin_whatsapp_test", directProviderSend: true },
    })

    const sent = await sendEvolutionText({ to: phone, message })
    await transitionWhatsAppMessage({
      messageLogId: lifecycle.row.id,
      status: "whatsapp_server_ack",
      providerMessageId: sent.messageId,
      providerResponse: sent.providerResponse as any,
      metadata: { source: "admin_whatsapp_test", directProviderSend: true },
    })
    await (prisma as any).whatsAppDeliveryLog.create({
      data: {
        messageLogId: lifecycle.row.id,
        phoneHash: sent.phoneHash || lifecycle.normalized.phoneHash,
        maskedPhone: sent.toMasked,
        whatsappMessageId: sent.messageId,
        providerMessageId: sent.messageId,
        ack: 1,
        status: "whatsapp_server_ack",
        providerResponse: sent.providerResponse as any,
        createdAt: new Date(),
      },
    }).catch(() => null)

    const delivery = await waitForWhatsAppDeliveryAck({
      providerMessageId: sent.messageId,
      minAck: 2,
      timeoutMs: Number(body?.ackTimeoutMs || 15_000),
    })
    const resolvedDelivery = delivery.timedOut && Number(delivery.ack || 0) < 1
      ? { ...delivery, ack: 1, status: "whatsapp_server_ack" as const, providerResponse: { ...(delivery.providerResponse || {}), warning: "Delivery ACK timeout; Evolution accepted the message." } }
      : delivery

    const admin = await getAdminFromCookies()
    await createPanelLog({
      category: "Admin Action",
      message: "whatsapp_test_message_sent",
      actorType: "admin",
      actorEmail: String(admin?.email || "server-token"),
      metadata: { to: sent.toMasked, messageId: sent.messageId || null, status: resolvedDelivery.status, ack: resolvedDelivery.ack },
    }).catch(() => null)

    return NextResponse.json(
      {
        ok: true,
        provider: "evolution",
        result: "Test Message Sent",
        status: resolvedDelivery.status,
        toMasked: sent.toMasked,
        messageId: sent.messageId,
        messageLogId: lifecycle.row.id,
        deliveryStatus: resolvedDelivery.status,
        delivered: Number(resolvedDelivery.ack) >= 2,
        providerResponse: resolvedDelivery.providerResponse || sent.providerResponse || null,
        timestamp: new Date().toISOString(),
      },
      { headers: noStoreHeaders },
    )
  } catch (error) {
    return jsonError(error)
  }
}
