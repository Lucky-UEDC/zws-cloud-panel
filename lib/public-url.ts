import { getNormalizedAppUrl, getNormalizedSiteDomain } from "@/lib/runtime-domain"

function cleanHost(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .toLowerCase()
}

export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return ""
  const first = raw.split(",")[0] || ""
  return cleanHost(first)
}

export function configuredSiteDomain(env: Record<string, string | undefined> = process.env) {
  const siteDomain = getNormalizedSiteDomain(env)
  if (siteDomain) return siteDomain
  return cleanHost(getNormalizedAppUrl(env))
}

export function publicOrigin(env: Record<string, string | undefined> = process.env) {
  return getNormalizedAppUrl(env)
}

export function requirePublicOrigin(env: Record<string, string | undefined> = process.env) {
  const origin = publicOrigin(env)
  if (!origin) throw new Error("APP_URL or NEXT_PUBLIC_APP_URL must be configured.")
  return origin
}
