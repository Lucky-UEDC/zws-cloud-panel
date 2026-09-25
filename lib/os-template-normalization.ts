const FAMILY_LABELS: Record<string, string> = {
  almalinux: "AlmaLinux",
  centos: "CentOS",
  debian: "Debian",
  rocky: "Rocky Linux",
  ubuntu: "Ubuntu",
  windows: "Windows Server",
}

const FAMILY_PATTERNS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "windows", label: "Windows Server", pattern: /\b(windows|windows\s*server|winserver|win\s*server|win)(?:\b|\d)/i },
  { key: "ubuntu", label: "Ubuntu", pattern: /\bubuntu\b/i },
  { key: "debian", label: "Debian", pattern: /\bdebian\b/i },
  { key: "almalinux", label: "AlmaLinux", pattern: /\b(alma\s*linux|almalinux|alma)\b/i },
  { key: "rocky", label: "Rocky Linux", pattern: /\b(rocky\s*linux|rockylinux|rocky)\b/i },
  { key: "centos", label: "CentOS", pattern: /\bcent\s*os\b|\bcentos\b/i },
]

export type NormalizedOsTemplate = {
  family: string
  familyKey: string
  version: string
  slug: string
  name: string
}

export function slugifyOsValue(input: string) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function readableName(input: string) {
  return String(input || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function isWindowsTemplateName(input: unknown) {
  const raw = String(input || "").toLowerCase()
  const readable = readableName(raw)
  const compact = raw.replace(/[^a-z0-9]+/g, "")
  return (
    /\b(windows|windows\s*server|winserver|win\s*server|win)(?:\b|\d)/i.test(readable) ||
    compact.includes("windowsserver") ||
    compact.includes("windows") ||
    compact.includes("winserver") ||
    /^win\d/.test(compact)
  )
}

function detectFamily(input: string) {
  const readable = readableName(input)
  for (const family of FAMILY_PATTERNS) {
    if (family.pattern.test(readable)) return { key: family.key, label: family.label }
  }
  return { key: "linux", label: "Linux" }
}

function detectVersion(input: string) {
  const raw = String(input || "")
  if (isWindowsTemplateName(raw)) {
    const windowsYear = raw.match(/(?:^|[^0-9])(20\d{2})(?:$|[^0-9])/)
    if (windowsYear) return windowsYear[1]
  }
  const splitMinor = raw.match(/\b(\d{2})[\s._-]+(\d{2})\b/i)
  if (splitMinor) return `${splitMinor[1]}.${splitMinor[2]}`
  const readable = readableName(input)
  const lts = readable.match(/\b(\d{2}\.\d{2})\s*(lts)?\b/i)
  if (lts) return `${lts[1]}${lts[2] ? " LTS" : ""}`.trim()
  const semantic = readable.match(/\b(\d+(?:\.\d+){1,2})\b/)
  if (semantic) return semantic[1]
  const major = readable.match(/\b(7|8|9|10|11|12|13|20|22|23|24|25|26|27|28|29|30)\b/)
  return major?.[1] || "Latest"
}

export function normalizeOsTemplate(templateName: string): NormalizedOsTemplate {
  const raw = String(templateName || "").trim()
  const family = detectFamily(raw)
  const version = detectVersion(raw)
  const label = FAMILY_LABELS[family.key] || family.label
  const name = version && version !== "Latest" ? `${label} ${version}` : label
  return {
    family: label,
    familyKey: family.key,
    version,
    slug: slugifyOsValue(`${family.key}-${version}`),
    name,
  }
}

export function normalizeOsFamily(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return "Linux"
  return detectFamily(raw).label
}

export function canonicalOsFamily(value: unknown) {
  const key = detectFamily(String(value || "")).key
  if (key === "almalinux") return "alma"
  if (["windows", "ubuntu", "debian", "centos", "rocky"].includes(key)) return key
  return "linux"
}

export function normalizeOsVersion(value: unknown) {
  return detectVersion(String(value || ""))
}

export function defaultUsernameForOs(value: unknown) {
  return isWindowsTemplateName(value) || normalizeOsFamily(value) === "Windows Server" ? "Administrator" : "root"
}
