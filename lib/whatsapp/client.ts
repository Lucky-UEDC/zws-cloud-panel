import { getEvolutionStatus } from "@/lib/whatsapp/evolution"
import { getWhatsAppSessionStatus } from "@/lib/whatsapp/status"

export type WhatsAppStatus =
  | "idle"
  | "starting"
  | "initializing"
  | "authenticated"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "disconnected"
  | "crashed"
  | "auth_failure"
  | "error"

function removedRuntimeError(action: string) {
  const error = new Error(`${action} is not available. WhatsApp delivery now uses the Evolution API provider.`)
  ;(error as Error & { status?: number }).status = 410
  return error
}

export function detectChromiumExecutablePath() {
  return null
}

export async function initializeWhatsAppRuntime() {
  return getSafeWhatsAppStatus()
}

export async function startWhatsApp() {
  throw removedRuntimeError("WhatsApp Web startup")
}

export async function restartWhatsApp() {
  throw removedRuntimeError("WhatsApp Web restart")
}

export async function runWhatsAppHealthCheck() {
  return getSafeWhatsAppStatus()
}

export async function requestWhatsAppRuntimeAction() {
  throw removedRuntimeError("WhatsApp Web runtime actions")
}

export async function getSafeWhatsAppStatus() {
  const session = await getWhatsAppSessionStatus().catch(async (error: any) => {
    const evolution = await getEvolutionStatus().catch(() => null)
    return {
      connected: false,
      number: null,
      sessionName: null,
      workerHeartbeatFresh: true,
      workerHeartbeatAt: null,
      lastHeartbeatAt: null,
      status: "FAILED",
      effectiveStatus: "FAILED",
      healthy: false,
      healthReason: error?.message || "Evolution API status check failed.",
      lastPositiveSignalAt: null,
      lastMessageSentAt: null,
      lastDeliveryAckAt: null,
      sessionWritable: Boolean((evolution as any)?.configured),
      sendAvailable: false,
      queueHealthy: true,
      deliveryOperational: false,
      ackTimeoutMs: null,
      duplicateRuntimeDetected: false,
      activeProbeOk: false,
      queues: null,
      runtimeStatus: "error",
      authStatus: "unknown",
      sessionInvalidated: false,
      evolution,
      raw: {
        provider: "evolution",
        configured: Boolean((evolution as any)?.configured),
        status: "error",
        currentWAState: "FAILED",
        evolution,
      },
    }
  })

  const raw = (session as any).raw || {}
  const ready = Boolean((session as any).connected)
  return {
    ...raw,
    ...(session as any),
    provider: "evolution",
    status: ready ? "ready" : "disconnected",
    currentWAState: ready ? "CONNECTED" : (session as any).runtimeStatus || "DISCONNECTED",
    sessionInvalidated: false,
    sessionName: (session as any).sessionName || (session as any).evolution?.settings?.instanceName || null,
    connectedNumber: (session as any).number || (session as any).evolution?.connectedNumber || null,
  }
}

export function requireBearerToken(request: Request, expectedToken: string | undefined | null) {
  if (!expectedToken) {
    const error = new Error("Server token is not configured.")
    ;(error as Error & { status?: number }).status = 500
    throw error
  }

  if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
    const error = new Error("Unauthorized")
    ;(error as Error & { status?: number }).status = 401
    throw error
  }
}
