import crypto from "node:crypto"

export type SecurityFieldKind =
  | "name"
  | "company"
  | "email"
  | "phone"
  | "subject"
  | "message"
  | "address"
  | "search"
  | "metadata"
  | "id"

export type PayloadDetection = {
  dangerous: boolean
  attackTypes: string[]
  reason?: string
  normalized: string
  sample: string
  hash: string
}

const MAX_LENGTH: Record<SecurityFieldKind, number> = {
  name: 80,
  company: 120,
  email: 254,
  phone: 24,
  subject: 160,
  message: 3000,
  address: 180,
  search: 120,
  metadata: 500,
  id: 120,
}

const SAFE_TEXT = /^[\p{L}\p{N}\s.,!?:;/@&+\-]+$/u
const SAFE_SHORT_TEXT = /^[\p{L}\p{N}\s.,&+\-]+$/u
const SAFE_ID = /^[a-zA-Z0-9_.:\-]+$/
const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i
const PHONE_RE = /^\+?[0-9]{8,15}$/

const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  [/<\s*\/?\s*[a-z][^>]*>/i, "html_injection"],
  [/<\s*script\b/i, "xss_script"],
  [/\bon(?:error|load|click|mouseover|focus|submit|animationstart)\s*=/i, "xss_event_handler"],
  [/\bjavascript\s*:/i, "xss_javascript_url"],
  [/\b(?:iframe|svg|img|object|embed|link|meta|style|base)\b/i, "html_injection"],
  [/\beval\s*\(/i, "script_injection"],
  [/\b(?:function|setTimeout|setInterval|Function)\s*\(/i, "script_injection"],
  [/\$\s*\{|\{\{|\}\}/, "template_injection"],
  [/(?:%3c|%3e|%22|%27|&#x?0*3c;?|&#x?0*3e;?|&lt;|&gt;|\\u003c|\\x3c)/i, "encoded_payload"],
  [/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u, "control_character"],
  [/(?:'|")\s*(?:or|and)\s+(?:'|")?\w+(?:'|")?\s*=\s*(?:'|")?\w+/i, "sql_injection"],
  [/\bunion\s+select\b|\bdrop\s+table\b|\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w+\s+set\b/i, "sql_injection"],
  [/(?:--|\/\*|\*\/|;)\s*(?:select|drop|insert|update|delete|alter|create)\b/i, "sql_injection"],
  [/\r|\n(?=.*:)/, "header_injection"],
]

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);?/g, (_, code) => {
      const n = Number(code)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => {
      const n = Number.parseInt(code, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _
    })
}

export function normalizeSecurityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim()
}

export function payloadHash(value: unknown) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex")
}

export function detectPayload(value: unknown): PayloadDetection {
  const raw = String(value ?? "")
  const normalized = normalizeSecurityText(raw)
  const decoded = decodeHtmlEntities(normalized)
  const decodedUri = (() => {
    try {
      return decodeURIComponent(decoded)
    } catch {
      return decoded
    }
  })()
  const scan = `${raw}\n${normalized}\n${decoded}\n${decodedUri}`
  const attackTypes = Array.from(new Set(DANGEROUS_PATTERNS.filter(([pattern]) => pattern.test(scan)).map(([, type]) => type)))
  return {
    dangerous: attackTypes.length > 0,
    attackTypes,
    reason: attackTypes[0],
    normalized,
    sample: normalized.slice(0, 500),
    hash: payloadHash(normalized),
  }
}

function allowedForKind(kind: SecurityFieldKind, value: string) {
  if (!value) return true
  if (kind === "email") return EMAIL_RE.test(value)
  if (kind === "phone") return PHONE_RE.test(value)
  if (kind === "id") return SAFE_ID.test(value)
  if (kind === "name") return /^[\p{L}\p{N}\s]+$/u.test(value)
  if (kind === "company") return SAFE_SHORT_TEXT.test(value)
  if (kind === "subject" || kind === "message" || kind === "address" || kind === "search" || kind === "metadata") {
    return SAFE_TEXT.test(value)
  }
  return false
}

export function validateSecurityField(value: unknown, kind: SecurityFieldKind, label: string = kind) {
  const normalized = normalizeSecurityText(value)
  const detection = detectPayload(normalized)
  if (detection.dangerous) {
    return { ok: false as const, value: normalized, error: `${label} contains unsafe content.`, detection }
  }
  if (normalized.length > MAX_LENGTH[kind]) {
    return { ok: false as const, value: normalized, error: `${label} is too long.`, detection }
  }
  if (!allowedForKind(kind, normalized)) {
    return { ok: false as const, value: normalized, error: `${label} contains unsupported characters.`, detection: { ...detection, dangerous: true, attackTypes: ["unsafe_characters"], reason: "unsafe_characters" } }
  }
  return { ok: true as const, value: normalized, detection }
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function escapeSerializable<T>(value: T): T {
  if (typeof value === "string") return escapeHtml(value) as T
  if (Array.isArray(value)) return value.map((item) => escapeSerializable(item)) as T
  if (value instanceof Date) return value as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, escapeSerializable(entry)])) as T
  }
  return value
}
