import { prisma } from "@/lib/db"

export const DEFAULT_WHATSAPP_SESSION_NAME = process.env.WHATSAPP_CLIENT_ID || "zws-primary"

export type WhatsAppSessionStatus =
  | "connected"
  | "starting"
  | "authenticated"
  | "qr"
  | "disconnected"
  | "auth_failure"
  | "error"
  | "idle"

export async function upsertWhatsAppSession(input: {
  sessionName?: string | null
  status: WhatsAppSessionStatus | string
  lastConnected?: Date | null
}) {
  const sessionName = String(input.sessionName || DEFAULT_WHATSAPP_SESSION_NAME)
  return (prisma as any).whatsAppSession.upsert({
    where: { sessionName },
    create: {
      sessionName,
      status: input.status,
      lastConnected: input.lastConnected || (input.status === "connected" ? new Date() : null),
    },
    update: {
      status: input.status,
      ...(input.lastConnected || input.status === "connected" ? { lastConnected: input.lastConnected || new Date() } : {}),
    },
  }).catch(() => null)
}

export function sessionStatusFromRuntime(status?: string | null): WhatsAppSessionStatus {
  if (status === "ready") return "connected"
  if (status === "authenticated") return "authenticated"
  if (status === "qr") return "qr"
  if (status === "auth_failure") return "auth_failure"
  if (status === "disconnected" || status === "reconnecting" || status === "degraded") return "disconnected"
  if (status === "starting" || status === "initializing") return "starting"
  if (status === "error" || status === "crashed") return "error"
  return "idle"
}
