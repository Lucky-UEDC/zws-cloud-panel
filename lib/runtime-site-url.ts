import { getNormalizedAppUrl } from "@/lib/runtime-domain"

function firstHeaderValue(value: string | null) {
  return String(value || "").split(",")[0]?.trim() || ""
}

function cleanOrigin(origin: string) {
  return origin.replace(/\/+$/, "")
}

function isLocalHost(host: string) {
  return /^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/i.test(String(host || "").trim())
}

function localPublicOriginsAllowed() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" || process.env.ALLOW_LOCAL_PUBLIC_ORIGIN === "true"
}

function originFromRaw(value: string | null | undefined) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(candidate)
    if (isLocalHost(url.host) && !localPublicOriginsAllowed()) return ""
    return cleanOrigin(`${url.protocol}//${url.host}`)
  } catch {
    return ""
  }
}

export function getBaseUrl(req?: Request | { headers?: Headers | null } | null) {
  const headers = req?.headers || null
  const forwardedHost = firstHeaderValue(headers?.get("x-forwarded-host") || null)
  const requestHost = firstHeaderValue(headers?.get("host") || null)
  for (const host of [forwardedHost, requestHost]) {
    if (!host) continue
    if (isLocalHost(host) && !localPublicOriginsAllowed()) continue
    const protocol = firstHeaderValue(headers?.get("x-forwarded-proto") || null) || "https"
    const origin = originFromRaw(`${protocol}://${host}`)
    if (origin) return origin
  }
  const configured = originFromRaw(process.env.APP_URL) || originFromRaw(process.env.NEXT_PUBLIC_APP_URL)
  if (configured) return configured
  if (localPublicOriginsAllowed()) return originFromRaw(`http://localhost:${process.env.PORT || "3000"}`)
  throw new Error("APP_URL or NEXT_PUBLIC_APP_URL must be configured for public URL generation.")
}

export function getAppUrl() {
  const configured = getNormalizedAppUrl()
  if (configured) return configured
  if (localPublicOriginsAllowed()) return originFromRaw(`http://localhost:${process.env.PORT || "3000"}`)
  throw new Error("APP_URL or NEXT_PUBLIC_APP_URL must be configured.")
}

export function paymentWebhookUrl(gateway: string, baseUrl: string) {
  const origin = cleanOrigin(baseUrl)
  const code = String(gateway || "").toLowerCase()
  return `${origin}/api/webhooks/${encodeURIComponent(code)}`
}

export function paymentCallbackUrl(gateway: string, baseUrl: string) {
  void gateway
  return `${cleanOrigin(baseUrl)}/payment/status?order_id={order_id}`
}

export function getWebhookUrl(gateway: string, req?: Request | { headers?: Headers | null } | null) {
  return paymentWebhookUrl(gateway, getBaseUrl(req || null))
}

export function getCheckoutUrl(path = "/checkout", req?: Request | { headers?: Headers | null } | null) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${getBaseUrl(req || null)}${normalizedPath}`
}
