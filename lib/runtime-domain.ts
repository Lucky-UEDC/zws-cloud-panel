function cleanOrigin(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function withHttps(value: string) {
  const cleaned = value.trim()
  if (!cleaned) return ""
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
}

function cleanDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase()
}

export function getAppUrl() {
  return (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL
  )
}

export function getSiteDomain() {
  return process.env.SITE_DOMAIN
}

export function getNormalizedAppUrl(env: Record<string, string | undefined> = process.env) {
  const raw = env.APP_URL || env.NEXT_PUBLIC_APP_URL || ""
  return cleanOrigin(withHttps(raw))
}

export function getNormalizedSiteDomain(env: Record<string, string | undefined> = process.env) {
  return cleanDomain(env.SITE_DOMAIN || "")
}

export function getRequiredAppUrl(env: Record<string, string | undefined> = process.env) {
  const origin = getNormalizedAppUrl(env)
  if (!origin) throw new Error("APP_URL or NEXT_PUBLIC_APP_URL must be configured.")
  return origin
}

