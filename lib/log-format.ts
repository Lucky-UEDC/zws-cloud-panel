export const LOG_CATEGORIES = ["SYSTEM", "ADMIN", "SUPPORT", "CUSTOMER", "SECURITY", "BILLING", "PAYMENT", "SEO", "WHATSAPP", "AUTOMATION"] as const

export type LogCategory = (typeof LOG_CATEGORIES)[number]

const categoryAliases: Record<string, LogCategory> = {
  admin: "ADMIN",
  "admin action": "ADMIN",
  auth: "SECURITY",
  authentication: "SECURITY",
  billing: "BILLING",
  database: "SYSTEM",
  email: "SYSTEM",
  gateway: "PAYMENT",
  invoice: "PAYMENT",
  payment: "PAYMENT",
  provisioning: "AUTOMATION",
  system: "SYSTEM",
  "system error": "SYSTEM",
  user: "CUSTOMER",
  customer: "CUSTOMER",
  support: "SUPPORT",
  seo: "SEO",
  cms: "SEO",
  blog: "SEO",
  whatsapp: "WHATSAPP",
  webhook: "AUTOMATION",
  automation: "AUTOMATION",
  vm: "AUTOMATION",
  network: "AUTOMATION",
}

function splitWords(value: string) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._:-]+/g, " ")
    .replace(/[-/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function humanizeLogLabel(value: unknown) {
  const text = splitWords(String(value || "Activity event")).toLowerCase()
  if (!text) return "Activity event"
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function normalizeLogCategory(value: unknown): LogCategory {
  const raw = String(value || "").trim()
  const first = raw.split(/[._:-]/)[0] || raw
  const normalized = splitWords(first).toLowerCase()
  return categoryAliases[normalized] || "SYSTEM"
}

export function normalizeLogSeverity(value: unknown) {
  const text = String(value || "INFO").trim().toUpperCase()
  if (text === "WARN") return "WARNING"
  if (["INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"].includes(text)) return text
  return "INFO"
}

export function metadataSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .slice(0, 4)
  return entries.map(([key, item]) => `${humanizeLogLabel(key)}: ${String(item).slice(0, 80)}`).join(" · ")
}

const CLIENT_EVENT_MESSAGES: Record<string, string> = {
  admin_vm_action_executed: "Server action completed",
  billing_initialized: "Billing setup completed",
  credentials_generated: "Access credentials generated",
  ip_assigned: "IP address assigned",
  vm_created: "Server created",
  vm_provisioned: "Server activated",
}

const CLIENT_INTERNAL_PATTERN = /\b(?:automation|backend|cluster|cloud[- ]?init|job|lxc|node|provisioning engine|proxmox|qemu|queue|realm|storage pool|template clone|upid|vmid|vncproxy|vncwebsocket)\b|api2\/json|pveapitoken|root@pam/i

function genericClientActivityMessage(input: string) {
  if (/network/i.test(input)) return "Network setup is being verified"
  if (/reinstall/i.test(input)) return "Server reinstall is in progress"
  if (/delete|terminate|remove/i.test(input)) return "Server removal is in progress"
  if (/stop|shutdown/i.test(input)) return "Server stop request completed"
  if (/start|boot/i.test(input)) return "Server start request completed"
  if (/payment|invoice|billing/i.test(input)) return "Billing status updated"
  if (/credential|password|access/i.test(input)) return "Access credentials updated"
  if (/ip|address/i.test(input)) return "IP address updated"
  return "Server activity updated"
}

export function clientActivityMessage(value: unknown) {
  const raw = String(value || "").replace(/\s+/g, " ").trim()
  if (!raw) return "Server activity updated"
  const eventKey = raw.toLowerCase().replace(/[\s.:-]+/g, "_")
  if (CLIENT_EVENT_MESSAGES[eventKey]) return CLIENT_EVENT_MESSAGES[eventKey]
  if (/linux network verification retry attempt \d+\s*\/\s*\d+/i.test(raw)) return "Network setup is being verified"
  if (/retry attempt \d+\s*\/\s*\d+|polling attempt|heartbeat/i.test(raw)) return genericClientActivityMessage(raw)
  if (CLIENT_INTERNAL_PATTERN.test(raw)) return genericClientActivityMessage(raw)
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(raw)) return genericClientActivityMessage(raw)
  return raw
    .replace(/\bretry attempt \d+\s*\/\s*\d+\b/gi, "")
    .replace(/\b(?:job|queue|automation)\s*(?:id)?\s*[:#-]?\s*[a-z0-9_-]+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "Server activity updated"
}

export function clientActivityTitle(value: unknown) {
  const message = clientActivityMessage(value)
  if (/network/i.test(message)) return "Network update"
  if (/billing|invoice|payment/i.test(message)) return "Billing update"
  if (/credential|access/i.test(message)) return "Access update"
  if (/reinstall/i.test(message)) return "Server reinstall"
  if (/removal|delete|terminate/i.test(message)) return "Server removal"
  return "Server activity"
}

export function clientActivityCategory(value: unknown) {
  const category = normalizeLogCategory(value)
  return category === "AUTOMATION" || category === "SYSTEM" || category === "ADMIN" ? "SERVER" : category
}
