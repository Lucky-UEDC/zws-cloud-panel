import { prisma } from "@/lib/db"

export async function recordPaymentWebhookLog(input: {
  gateway: string
  eventId: string
  eventType?: string | null
  status: string
  payload?: unknown
  response?: unknown
}) {
  const eventId = String(input.eventId || "").trim()
  if (!eventId) return null
  return (prisma as any).paymentWebhookLog.create({
    data: {
      gateway: String(input.gateway || "unknown").toLowerCase(),
      eventId,
      eventType: input.eventType || null,
      status: input.status,
      payload: (input.payload || null) as any,
      response: (input.response || null) as any,
    },
  }).catch(() => null)
}
