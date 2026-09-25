import { getEvolutionStatus } from "@/lib/whatsapp/evolution"
import { getWhatsAppQueueStats } from "@/lib/whatsapp/queue"

export type WhatsAppPublicStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "FAILED"
  | "DISCONNECTED"
  | "RECONNECTING"

export async function getWhatsAppSessionStatus() {
  const [evolution, queues] = await Promise.all([
    getEvolutionStatus().catch((error: any) => ({
      provider: "evolution",
      configured: false,
      connected: false,
      status: "FAILED",
      connectionState: "error",
      error: error?.message || String(error),
      settings: null,
      raw: null,
    })),
    getWhatsAppQueueStats().catch(() => null),
  ])
  const connected = Boolean(evolution.connected)
  return {
    connected,
    number: (evolution as any).connectedNumber || (evolution as any).settings?.connectedNumber || null,
    sessionName: (evolution as any).settings?.instanceName || null,
    workerHeartbeatFresh: true,
    workerHeartbeatAt: null,
    lastHeartbeatAt: null,
    status: connected ? "CONNECTED" : (evolution as any).status || "DISCONNECTED",
    effectiveStatus: connected ? "CONNECTED" : (evolution as any).status || "DISCONNECTED",
    healthy: connected,
    healthReason: connected ? "evolution_connected" : (evolution as any).error || (evolution as any).connectionState || "evolution_not_connected",
    lastPositiveSignalAt: null,
    lastMessageSentAt: null,
    lastDeliveryAckAt: null,
    sessionWritable: Boolean((evolution as any).configured),
    sendAvailable: connected,
    queueHealthy: queues ? Object.values(queues as any).every((queue: any) => !queue?.paused) : true,
    deliveryOperational: connected,
    ackTimeoutMs: null,
    duplicateRuntimeDetected: false,
    activeProbeOk: connected,
    queues,
    runtimeStatus: (evolution as any).connectionState || (connected ? "open" : "closed"),
    authStatus: connected ? "valid" : "unknown",
    sessionInvalidated: false,
    evolution,
    raw: {
      provider: "evolution",
      configured: (evolution as any).configured,
      status: connected ? "ready" : "disconnected",
      currentWAState: connected ? "CONNECTED" : (evolution as any).connectionState || "DISCONNECTED",
      evolution,
    },
  }
}

export function toWhatsAppPublicStatus(status?: string | null): WhatsAppPublicStatus {
  const normalized = String(status || "").toLowerCase()
  if (["open", "connected", "online", "ready"].includes(normalized)) return "CONNECTED"
  if (["connecting", "starting"].includes(normalized)) return "CONNECTING"
  if (["reconnecting"].includes(normalized)) return "RECONNECTING"
  if (["failed", "error"].includes(normalized)) return "FAILED"
  return "DISCONNECTED"
}

export async function canSendWhatsAppSessionOtp() {
  const status = await getWhatsAppSessionStatus()
  return {
    ok: status.connected,
    status,
    reason: status.connected ? null : `Evolution API is ${status.status}.`,
  }
}
