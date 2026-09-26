function text(value: unknown) {
  return String(value || "").trim()
}

export function hostnameFromIp(ipAddress: unknown) {
  const ip = text(ipAddress)
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return null
  const octets = ip.split(".").map((part) => Number(part))
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return `ip-${octets.join("-")}`
}

export function internalVmHostname(input: unknown, fallback?: unknown) {
  if (typeof input === "string") return hostnameFromIp(input) || text(input) || text(fallback) || null
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {}
  return hostnameFromIp(row.ipAddress || row.primaryIp || row.assignedIp) || text(row.hostname || row.name || fallback) || null
}

export function instanceDisplayName(input: unknown, fallback?: unknown) {
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {}
  // IP-only policy: always prefer the canonical ip-X-X-X-X form (derived from the IP, or the ip-format
  // hostname column) over any stored display name, so every VM — including pre-existing ones — shows the
  // IP hostname rather than a legacy zws.*/user name.
  // Infrastructure identifiers (vmid/id/node/storage) are deliberately NOT part of the display chain.
  return text(internalVmHostname(row) || row.name || row.instanceName || fallback) || "VM"
}

const SERVER_TAG_MAX_LENGTH = 64

/**
 * Server Tag (customer-managed friendly identity, spec Part 1.3).
 *
 * Optional, human-readable, short and safe. Allows letters, numbers, spaces,
 * hyphens and underscores; strips control characters and anything else;
 * collapses whitespace; trimmed; capped at 64 characters. Returns "" when no
 * usable tag remains. This NEVER touches the system-managed hostname.
 */
export function normalizeServerTag(value: unknown): string {
  const raw = String(value ?? "")
  if (!raw.trim()) return ""
  const noControl = raw.replace(/[\u0000-\u001f\u007f]/g, " ")
  // Keep only safe characters: letters, digits, space, hyphen, underscore.
  const cleaned = noControl.replace(/[^a-zA-Z0-9 _-]/g, " ")
  return cleaned.replace(/\s+/g, " ").trim().slice(0, SERVER_TAG_MAX_LENGTH)
}

/** Whether a submitted tag was rejected outright (nothing usable remained). */
export function isRejectedServerTag(value: unknown): boolean {
  const raw = String(value ?? "").trim()
  return Boolean(raw) && !normalizeServerTag(raw)
}

/**
 * Customer-facing VM display identity (spec Parts 1.6 / 1.7 / 7).
 * Order of preference: Server Tag (customer-managed) → canonical IP hostname.
 * Internal infrastructure identifiers are never used as a primary label.
 */
export function friendlyVmDisplayName(input: unknown, fallback?: unknown) {
  const row = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const tag = normalizeServerTag(row.displayTag || row.serverTag)
  if (tag) return tag
  return instanceDisplayName(row, fallback)
}
