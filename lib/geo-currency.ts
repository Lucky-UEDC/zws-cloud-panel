export type GeoCurrencyContext = {
  country: string
  currency: string
  symbol: string
  locale: string
  source: string
}

export function normalizeIsoCountry(value: unknown) {
  const code = String(value || "").trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : ""
}

export function countryFromAcceptLanguage(value: string | null | undefined) {
  for (const entry of String(value || "").split(",")) {
    const tag = entry.trim().split(";")[0] || ""
    const parts = tag.split("-")
    const region = parts.length > 1 ? parts[parts.length - 1] : ""
    const code = normalizeIsoCountry(region)
    if (code) return code
  }
  return ""
}

export function countryFromTimezone(value: string | null | undefined) {
  const timezone = String(value || "").toLowerCase()
  if (timezone.includes("berlin")) return "DE"
  if (timezone.includes("london")) return "GB"
  if (timezone.includes("new_york") || timezone.includes("los_angeles") || timezone.includes("chicago")) return "US"
  if (timezone.includes("tokyo")) return "JP"
  if (timezone.includes("kolkata") || timezone.includes("calcutta")) return "IN"
  if (timezone.includes("dubai")) return "AE"
  if (timezone.includes("singapore")) return "SG"
  return ""
}

export function currencyForCountry(countryCode: string) {
  void countryCode
  return "INR"
}

export function localeForCountry(countryCode: string, currencyCode?: string | null) {
  void countryCode
  void currencyCode
  return "en-IN"
}

export function currencySymbol(currencyCode: string) {
  void currencyCode
  return "\u20b9"
}

function cookieValue(cookieHeader: string | null | undefined, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return String(cookieHeader || "").match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))?.[1] || ""
}

export function resolveGeoCurrencyFromHeaders(headers: Headers | null | undefined): GeoCurrencyContext {
  const header = (name: string) => headers?.get(name) || ""
  const countryCandidates: Array<[string, string]> = [
    ["cf-ipcountry", normalizeIsoCountry(header("cf-ipcountry"))],
    [["x", "vercel", "ip", "country"].join("-"), normalizeIsoCountry(header(["x", "vercel", "ip", "country"].join("-")))],
    ["timezone", countryFromTimezone(header(["x", "vercel", "ip", "timezone"].join("-")) || header("x-timezone"))],
    ["cookie", normalizeIsoCountry(decodeURIComponent(cookieValue(header("cookie"), "country") || ""))],
  ]
  const [source, country] = countryCandidates.find(([, value]) => Boolean(value)) || ["default", "IN"]
  const currency = currencyForCountry(country)
  return { country, currency, symbol: currencySymbol(currency), locale: localeForCountry(country, currency), source }
}
