export function buildSupportCode(prefix = "SUP") {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`
}

export function safeApiErrorMessage(error: unknown, fallback: string) {
  const raw = String((error as any)?.message || "").trim()
  if (!raw) return fallback
  if (/prisma|sql|query|stack|constraint|p20\d+/i.test(raw)) return fallback
  return raw
}
