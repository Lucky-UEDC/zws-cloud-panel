export class WhatsAppGatewayError extends Error {
  readonly status: number
  readonly code: string
  readonly providerMessage?: string

  constructor(message: string, options: { status?: number; code?: string; providerMessage?: string } = {}) {
    super(message)
    this.name = "WhatsAppGatewayError"
    this.status = options.status ?? 0
    this.code = options.code ?? "GATEWAY_ERROR"
    this.providerMessage = options.providerMessage
  }
}

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(Bearer|Basic)\s+\S+/gi, "[REDACTED]"],
  [/(x-(?:api-)?key|authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password)['\"]?\s*[:=]\s*(?:['\"])?[^\s'\",;:]+/gi, "$1: [REDACTED]"],
]

export function sanitizeErrorMessage(value: unknown, fallback = "Unknown provider error"): string {
  let message = String(value ?? "").trim()
  if (!message) return fallback
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, replacement)
  }
  if (message.length > 2000) message = `${message.slice(0, 2000)}…`
  return message
}

export function pickProviderError(body: unknown, status: number, fallback: string): string {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const candidates = [
    typeof record.message === "string" ? record.message : undefined,
    typeof record.error === "string" ? record.error : typeof record.error === "object" ? JSON.stringify(record.error) : undefined,
    typeof record.detail === "string" ? record.detail : typeof record.detail === "object" ? JSON.stringify(record.detail) : undefined,
  ].filter(Boolean)
  return sanitizeErrorMessage(candidates[0] || fallback)
}

export function isTransientStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504 || status === 429
}

export function sanitizeErrorForLogs(value: unknown, fallback = "Unknown error"): string {
  return sanitizeErrorMessage(value, fallback)
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof WhatsAppGatewayError) return error.status === 0 || isTransientStatus(error.status)
  if (error instanceof TypeError) return true
  return false
}