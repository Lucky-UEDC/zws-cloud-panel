import { toast } from "sonner"

const THROTTLE_MS = 30_000
const seen = new Map<string, number>()

function now() {
  return Date.now()
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase()
}

export function dedupedAdminErrorToast(input: {
  message: string
  key?: string | null
  ttlMs?: number
}) {
  const ttlMs = Number(input.ttlMs || THROTTLE_MS)
  const key = normalizeKey(String(input.key || input.message || "admin_error"))
  const at = now()
  const lastAt = seen.get(key) || 0

  if (at - lastAt < ttlMs) return false

  seen.set(key, at)
  toast.error(input.message)
  return true
}

export function clearAdminToastDeduper() {
  seen.clear()
}
