import crypto from "node:crypto"
import { prisma } from "@/lib/db"

function cleanPart(value: unknown) {
  return String(value || "none")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "none"
}

export function outboundDedupeKey(input: {
  channel: string
  eventType: string
  templateKey?: string | null
  customerId?: string | null
  orderId?: string | null
  vpsInstanceId?: string | null
  invoiceId?: string | null
  cycleKey?: string | null
}) {
  return [
    input.channel,
    input.eventType,
    input.templateKey,
    input.customerId,
    input.orderId,
    input.vpsInstanceId,
    input.invoiceId,
    input.cycleKey,
  ].map(cleanPart).join(":")
}

export async function reserveOutboundEventDelivery(input: {
  channel: string
  eventType: string
  templateKey?: string | null
  customerId?: string | null
  orderId?: string | null
  vpsInstanceId?: string | null
  invoiceId?: string | null
  cycleKey?: string | null
  metadata?: Record<string, unknown>
}) {
  const dedupeKey = outboundDedupeKey(input)
  try {
    const row = await (prisma as any).outboundEventDelivery.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        dedupeKey,
        channel: input.channel,
        eventType: input.eventType,
        templateKey: input.templateKey || null,
        customerId: input.customerId || null,
        orderId: input.orderId || null,
        vpsInstanceId: input.vpsInstanceId || null,
        invoiceId: input.invoiceId || null,
        cycleKey: input.cycleKey || null,
        status: "reserved",
        metadata: input.metadata || {},
      },
    })
    return { reserved: true, dedupeKey, row }
  } catch (error: any) {
    if (String(error?.code) === "P2002") {
      await (prisma as any).outboundEventDelivery.update({
        where: { dedupeKey },
        data: { lastSeenAt: new Date(), metadata: { ...(input.metadata || {}), duplicateSuppressedAt: new Date().toISOString() } },
      }).catch(() => null)
      return { reserved: false, dedupeKey, row: null }
    }
    throw error
  }
}

export async function markOutboundEventDelivery(input: {
  dedupeKey: string
  status: string
  providerMessageId?: string | null
  metadata?: Record<string, unknown>
}) {
  await (prisma as any).outboundEventDelivery.update({
    where: { dedupeKey: input.dedupeKey },
    data: {
      status: input.status,
      providerMessageId: input.providerMessageId || null,
      lastSeenAt: new Date(),
      metadata: input.metadata || {},
    },
  }).catch(() => null)
}
