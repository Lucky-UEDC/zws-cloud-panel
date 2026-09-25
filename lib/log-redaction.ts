const SENSITIVE_KEY_PATTERN = /(access[_-]?token|auth|authorization|bearer|challenge|client[_-]?secret|cookie|credential|id[_-]?token|key|nonce|otp|pass(word)?|phone|pin|refresh[_-]?token|reset|salt|secret|session|signature|token|verifier|webhook)/i

const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]"],
  [/\b(PVEAPIToken=)[^\s"'<>;]+/gi, "$1[REDACTED]"],
  [/\b(PVEAuthCookie=)[^;\s"'<>]+/gi, "$1[REDACTED]"],
  [/\b((?:access[_-]?token|auth|authorization|challenge|client[_-]?secret|code|credential|id[_-]?token|key|nonce|otp|password|refresh[_-]?token|reset[_-]?token|salt|secret|session|signature|token|verifier|webhook)[\]'"`.:=\s]+)[^,\s'"`&?}]{4,}/gi, "$1[REDACTED]"],
  [/([?&](?:code|token|secret|session|state|verifier|otp|password|reset)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b\d{6}\b/g, "[OTP_REDACTED]"],
]

function redactString(value: string) {
  return SECRET_VALUE_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value)
}

export function redactForLog<T>(value: T, depth = 0): T {
  if (value == null) return value
  if (typeof value === "string") return redactString(value) as T
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: process.env.ZWS_API_ERROR_TRACE === "1" ? redactString(value.stack || "") : undefined,
    } as T
  }
  if (depth > 6) return "[REDACTED_DEPTH]" as T
  if (Array.isArray(value)) return value.map((entry) => redactForLog(entry, depth + 1)) as T
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactForLog(nested, depth + 1)
    }
    return output as T
  }
  return value
}

export function safeErrorForLog(error: unknown) {
  return redactForLog(error instanceof Error ? error : { message: String(error) })
}
