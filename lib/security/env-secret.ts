/**
 * Shared runtime-secret resolution.
 *
 * Every caller that previously degraded to a hardcoded development secret
 * must go through here. In production a missing secret throws instead of
 * silently weakening to a predictable value; in development it falls back
 * to the provided dev-only value so local workflows keep working.
 */

const PRODUCTION = process.env.NODE_ENV === "production"

/**
 * Returns the first configured secret among `keys`.
 *
 * @param keys       Environment variable names, first match wins (same order).
 * @param devFallback Development-only fallback; returned only when NODE_ENV != production.
 * @param minLength  Minimum length a candidate value must have to be accepted.
 * @throws Error in production when no configured value of sufficient length exists.
 */
export function requireSecret(keys: string[], devFallback: string, minLength = 1): string {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim()
    if (value.length >= minLength) return value
  }
  if (PRODUCTION) {
    throw new Error(`Missing required secret environment variable(s): ${keys.join(", ")}`)
  }
  return devFallback
}

/**
 * Non-throwing variant for optional secrets; returns "" or the default.
 */
export function optionalSecret(keys: string[], fallback = "", minLength = 1): string {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim()
    if (value.length >= minLength) return value
  }
  return fallback
}