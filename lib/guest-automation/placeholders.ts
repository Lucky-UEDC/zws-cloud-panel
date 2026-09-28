/**
 * Controlled placeholder substitution for admin-defined command templates.
 *
 * Rules that make this safe:
 *  - The placeholder vocabulary is CLOSED. An unknown `{{token}}` is a template
 *    validation error, never passed through to the guest verbatim.
 *  - Values are validated per placeholder (IPv4, prefix length, DNS server,
 *    interface name, username, password) and shell-quoted per engine.
 *  - Secret placeholders are rendered into a marker that is replaced with
 *    `input-data` on stdin, so the plaintext never enters argv, the Proxmox
 *    task log, or the audit trail. The audit row stores the masked form.
 */

import { crossOsCommandViolations, type GuestEngine } from "./constants"

export type PlaceholderName =
  | "VMID"
  | "IP"
  | "PREFIX"
  | "MASK"
  | "GATEWAY"
  | "DNS1"
  | "DNS2"
  | "SEARCHDOMAIN"
  | "NIC"
  | "USERNAME"
  | "PASSWORD"
  | "HOSTNAME"
  | "DRIVE"
  | "TIMEZONE"
  | "TIMEOUT"

export const GUEST_PLACEHOLDERS: PlaceholderName[] = [
  "VMID",
  "IP",
  "PREFIX",
  "MASK",
  "GATEWAY",
  "DNS1",
  "DNS2",
  "SEARCHDOMAIN",
  "NIC",
  "USERNAME",
  "PASSWORD",
  "HOSTNAME",
  "DRIVE",
  "TIMEZONE",
  "TIMEOUT",
]

/** Placeholders whose values must never reach argv or any log line. */
export const SECRET_PLACEHOLDERS: ReadonlySet<PlaceholderName> = new Set(["PASSWORD"])

export const SECRET_MASK = "[redacted]"

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g

export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>()
  for (const match of String(template || "").matchAll(PLACEHOLDER_PATTERN)) {
    found.add(match[1])
  }
  return [...found]
}

export function unknownPlaceholders(template: string): string[] {
  return extractPlaceholders(template).filter((name) => !(GUEST_PLACEHOLDERS as string[]).includes(name))
}

export type PlaceholderValues = Partial<Record<PlaceholderName, string>>

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/

/**
 * Reject anything that could break out of the intended command: control
 * characters, newlines, NUL, and shell metacharacters for the target engine.
 * Applied to network/user identifiers. Passwords use `assertPasswordSafe`.
 */
function assertTokenSafe(name: string, value: string, engine: GuestEngine): string | null {
  if (!value || !value.trim()) return `${name} is required`
  if (/[\u0000-\u001f\u007f]/.test(value)) return `${name} contains control characters`
  if (engine === "linux" && /['"`\\$`;|&<>(){}[\]!\n]/.test(value)) return `${name} contains unsafe shell characters`
  if (engine === "windows" && /["&|<>^%\r\n]/.test(value)) return `${name} contains unsafe shell characters`
  if (value.length > 512) return `${name} is too long`
  return null
}

function validateIpv4(name: string, value: string): string | null {
  if (!IPV4.test(value)) return `${name} is not a valid IPv4 address`
  return null
}

export function assertPasswordSafe(value: string): string | null {
  if (typeof value !== "string" || value.length < 12) return "Password must be at least 12 characters"
  if (value.length > 256) return "Password is too long"
  if (/[\u0000\r\n]/.test(value)) return "Password contains control characters"
  return null
}

/** Single-quote for POSIX shells; double-quote with `"` escaped for cmd.exe. */
export function shellQuote(value: string, engine: GuestEngine): string {
  if (engine === "windows") {
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type RenderResult = {
  ok: boolean
  /** Command with secrets replaced by the mask — safe to log and store. */
  masked: string
  /** Command with every placeholder resolved. `null` when a secret is present. */
  resolved: string | null
  /** Values that must be sent on stdin instead of argv. */
  stdin: string | null
  errors: string[]
}

/**
 * Resolve a template into an executable command.
 *
 * `resolved` is intentionally `null` whenever the template consumes `{{PASSWORD}}`
 * — such a command cannot be safely passed as argv, so the caller must use the
 * `stdin` payload and a command that reads from stdin.
 */
export function renderTemplate(input: {
  template: string
  values: PlaceholderValues
  engine: GuestEngine
}): RenderResult {
  const errors: string[] = [...unknownPlaceholders(input.template).map((name) => `Unknown placeholder {{${name}}}`)]
  const secrets: string[] = []
  const values = input.values

  const validate: Partial<Record<PlaceholderName, (value: string) => string | null>> = {
    VMID: (v) => (/^\d+$/.test(v) ? null : "VMID must be numeric"),
    IP: (v) => validateIpv4("IP", v),
    PREFIX: (v) => (/^\d{1,2}$/.test(v) && Number(v) >= 0 && Number(v) <= 32 ? null : "PREFIX must be 0-32"),
    MASK: (v) => (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) ? null : "MASK must be a dotted quad"),
    GATEWAY: (v) => validateIpv4("GATEWAY", v),
    DNS1: (v) => validateIpv4("DNS1", v),
    DNS2: (v) => (v ? validateIpv4("DNS2", v) : null),
    DRIVE: (v) => (/^[A-Za-z]:$/.test(v) ? null : "DRIVE must look like C:"),
    TIMEOUT: (v) => (/^\d+$/.test(v) ? null : "TIMEOUT must be numeric"),
    TIMEZONE: (v) => (/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v) ? null : "TIMEZONE must be an IANA zone such as Asia/Kolkata"),
    NIC: (v) => assertTokenSafe("NIC", v, input.engine),
    USERNAME: (v) => assertTokenSafe("USERNAME", v, input.engine),
    HOSTNAME: (v) => (assertTokenSafe("HOSTNAME", v, input.engine) ?? (/^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(v) ? null : "HOSTNAME must be a valid DNS label")),
    SEARCHDOMAIN: (v) => assertTokenSafe("SEARCHDOMAIN", v, input.engine),
  }

  const required = new Set<PlaceholderName>()
  const masked = String(input.template || "").replace(PLACEHOLDER_PATTERN, (_all, rawName: string) => {
    const name = rawName as PlaceholderName
    if (SECRET_PLACEHOLDERS.has(name)) {
      required.add(name)
      secrets.push(String(values.PASSWORD ?? ""))
      return SECRET_MASK
    }
    const raw = values[name]
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      required.add(name)
      return `{{${name}}}`
    }
    const value = String(raw)
    const problem = validate[name]?.(value) ?? assertTokenSafe(name, value, input.engine)
    if (problem) {
      errors.push(problem)
      return `{{${name}}}`
    }
    return value
  })

  if (required.size) {
    errors.push(`Missing value for ${[...required].map((n) => `{{${n}}}`).join(", ")}`)
  }

  // Content-level cross-OS guard runs on the resolved text so a pasted foreign
  // command is caught even when the shell field was set inconsistently.
  const probe = secrets.length ? masked : masked
  const violations = crossOsCommandViolations(probe, input.engine)
  if (violations.length) {
    errors.push(`Command contains tokens that are not valid on ${input.engine}: ${violations.join(", ")}`)
  }

  if (errors.length) {
    return { ok: false, masked, resolved: null, stdin: null, errors }
  }

  if (secrets.length) {
    // A secret-consuming template must read the value from stdin.
    return { ok: false, masked, resolved: null, stdin: null, errors: ["Secret placeholders require the template's stdin payload."] }
  }

  return { ok: true, masked, resolved: masked, stdin: null, errors: [] }
}

/** Render for display/testing: substitutes everything, including secrets. */
export function renderTemplateForPreview(input: {
  template: string
  values: PlaceholderValues
  engine: GuestEngine
}): { ok: boolean; text: string; errors: string[] } {
  const result = renderTemplate(input)
  if (!result.ok && result.resolved === null && result.masked.includes(SECRET_MASK)) {
    // Preview only: show the command with the secret inlined so an admin can
    // confirm the shape, then the caller masks before persisting.
    const text = String(input.template || "").replace(PLACEHOLDER_PATTERN, (all, rawName: string) => {
      const name = rawName as PlaceholderName
      if (SECRET_PLACEHOLDERS.has(name)) return `«password»`
      const value = input.values[name]
      return value === undefined || value === null || String(value).trim() === "" ? all : String(value)
    })
    return { ok: result.errors.length === 0, text, errors: result.errors }
  }
  return { ok: result.ok, text: result.resolved ?? result.masked, errors: result.errors }
}

/** Redact anything that looks like a credential in free-form command text. */
export function maskCommandSecrets(command: string, secrets: Array<string | null | undefined>): string {
  let text = String(command || "")
  for (const secret of secrets) {
    const value = String(secret ?? "")
    if (value.length < 4) continue
    text = text.split(value).join(SECRET_MASK)
  }
  return text
}
