import type { ConsoleFrontendMode } from "@/lib/console-mode"

export type ConsoleConnectionStage =
  | "connecting_node"
  | "authenticating_session"
  | "preparing_display"
  | "fetching_framebuffer"
  | "ready"

export type ConsoleFailureCode =
  | "node_offline"
  | "vm_offline"
  | "authentication_failed"
  | "session_expired"
  | "framebuffer_timeout"
  | "transport_failed"
  | "unknown"

export type ConsoleMetricFreshness = "live" | "stale" | "offline"

export type ConsoleOverview = {
  success: true
  id: string
  serverName: string
  status: string
  node: string | null
  datacenter: string | null
  vmid: number
  ipAddress: string | null
  os: string
  osFamily: string
  uptimeSeconds: number
  metrics: {
    cpuPercent: number
    ramPercent: number
    ramUsedBytes: number
    ramTotalBytes: number
    diskPercent: number
    diskUsedBytes: number
    diskTotalBytes: number
    networkInBytes: number
    networkOutBytes: number
  }
  freshness: ConsoleMetricFreshness
  observedAt: string
  availableModes: ConsoleFrontendMode[]
  defaultMode: ConsoleFrontendMode | null
}

export const CONSOLE_STAGE_COPY: Record<ConsoleConnectionStage, string> = {
  connecting_node: "Connecting to node",
  authenticating_session: "Authenticating VM session",
  preparing_display: "Preparing display",
  fetching_framebuffer: "Fetching framebuffer",
  ready: "Console ready",
}

export const CONSOLE_STAGE_ORDER: ConsoleConnectionStage[] = [
  "connecting_node",
  "authenticating_session",
  "preparing_display",
  "fetching_framebuffer",
  "ready",
]

export function classifyConsoleFailure(code: unknown, message: unknown): ConsoleFailureCode {
  const value = `${String(code || "")} ${String(message || "")}`.toLowerCase()
  if (/vm_not_running|server offline|vm offline|not running|stopped/.test(value)) return "vm_offline"
  if (/node_unreachable|node offline|target_not_found|econnrefused|enotfound/.test(value)) return "node_offline"
  if (/securityfailure|authentication failed|unauthorized|permission denied|401|403/.test(value)) return "authentication_failed"
  if (/expired|invalid session|ticket.*invalid/.test(value)) return "session_expired"
  if (/framebuffer.*timeout|awaiting visible framebuffer/.test(value)) return "framebuffer_timeout"
  if (/websocket|transport|disconnect|vncproxy|termproxy|timeout/.test(value)) return "transport_failed"
  return "unknown"
}

export function consoleFailureLabel(code: ConsoleFailureCode) {
  if (code === "node_offline") return "Node Offline"
  if (code === "vm_offline") return "VM Offline"
  if (code === "authentication_failed") return "Authentication Failed"
  if (code === "session_expired") return "Session Expired"
  if (code === "framebuffer_timeout") return "Framebuffer Timeout"
  if (code === "transport_failed") return "Console Connection Failed"
  return "Console Unavailable"
}

export function boundedPercent(value: unknown) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, number))
}
