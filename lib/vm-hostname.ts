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
  return text(internalVmHostname(row) || row.name || row.instanceName || row.vmid || row.id || fallback) || "VM"
}
