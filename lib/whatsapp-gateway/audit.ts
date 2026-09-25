import { createPanelLog } from "@/lib/panel-log"
import { sanitizeErrorMessage } from "@/lib/whatsapp-gateway/errors"
import type { WhatsAppGatewaySettings } from "@/lib/whatsapp-gateway/settings"

export function gatewayLoggingEnabled(settings: WhatsAppGatewaySettings) {
  return settings.loggingEnabled !== false
}

export async function logGatewayEvent(input: {
  settings: WhatsAppGatewaySettings
  message: string
  metadata?: Record<string, unknown>
  level?: "info" | "warn" | "error"
  actorEmail?: string | null
}) {
  if (!input.settings.loggingEnabled) return
  const safeMetadata: Record<string, unknown> = {}
  if (input.metadata) {
    for (const [key, value] of Object.entries(input.metadata)) {
      safeMetadata[key] = typeof value === "string" ? sanitizeErrorMessage(value) : value
    }
  }
  await createPanelLog({
    level: input.level ?? "info",
    category: "WHATSAPP",
    message: input.message,
    metadata: safeMetadata,
    actorType: "admin",
    actorEmail: input.actorEmail ?? null,
  }).catch(() => undefined)
}