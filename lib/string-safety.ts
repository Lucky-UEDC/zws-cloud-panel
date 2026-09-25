const DEFAULT_MAX_STRING_LENGTH = 5000

export function truncateLargeString(value: string | null | undefined, maxLength = DEFAULT_MAX_STRING_LENGTH) {
  if (typeof value !== "string") return value ?? null
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`
}
