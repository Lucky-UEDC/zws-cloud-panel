import { NextRequest, NextResponse } from "next/server"
import { sendNotification } from "@/lib/notifications/service"
import type { NotificationChannel, NotificationType } from "@/lib/notifications/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const NOTIFICATION_TYPES = new Set<NotificationType>(["otp", "order", "login", "notification"])
const CHANNELS = new Set<NotificationChannel>(["email", "whatsapp"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function statusFromError(error: unknown) {
  const status = (error as { status?: unknown })?.status
  return typeof status === "number" ? status : 500
}

function badRequest(message: string) {
  const error = new Error(message)
  ;(error as Error & { status?: number }).status = 400
  throw error
}

function parsePayload(value: unknown) {
  if (!isRecord(value)) badRequest("Body must be a JSON object.")
  const body = value as Record<string, unknown>

  const user = body.user
  if (!isRecord(user)) badRequest("user must be an object.")
  const parsedUser = user as Record<string, unknown>

  const type = body.type
  if (!NOTIFICATION_TYPES.has(type as NotificationType)) {
    badRequest("type must be otp, order, login, or notification.")
  }

  const channelsRaw: unknown[] = Array.isArray(body.channels) ? body.channels : ["email", "whatsapp"]
  const channels = channelsRaw.map(String).filter((channel: string): channel is NotificationChannel => CHANNELS.has(channel as NotificationChannel))
  if (!channels.length) badRequest("At least one valid channel is required.")

  const data = isRecord(body.data) ? body.data : {}

  return {
    user: {
      id: typeof parsedUser.id === "string" ? parsedUser.id : null,
      email: typeof parsedUser.email === "string" ? parsedUser.email : null,
      phone: typeof parsedUser.phone === "string" ? parsedUser.phone : null,
      name: typeof parsedUser.name === "string" ? parsedUser.name : null,
    },
    type: type as NotificationType,
    channels,
    data,
  }
}

export async function POST(request: NextRequest) {
  try {
    const { requireBearerToken } = await import("@/lib/whatsapp/client")
    requireBearerToken(request, process.env.NOTIFICATION_SEND_TOKEN || process.env.INTERNAL_API_SECRET)
    const payload = parsePayload(await request.json())
    const result = await sendNotification(payload)
    return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ ok: false, error: message }, { status: statusFromError(error), headers: { "Cache-Control": "no-store" } })
  }
}
