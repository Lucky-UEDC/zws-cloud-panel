import { normalizeCountryCode } from "@/lib/pricing-catalog"

export type ProductGeoVisibility = {
  mode: "global" | "country_restricted"
  allowedCountries: string[]
  blockedCountries: string[]
}

function metadata(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function codeList(value: unknown) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : []
  return Array.from(new Set(list.map((item) => normalizeCountryCode(String(item || "").toUpperCase())).filter(Boolean)))
}

export function normalizeProductGeoVisibility(value: unknown): ProductGeoVisibility {
  const raw = metadata(value)
  const geo = metadata(raw.geoVisibility || raw.geo || {})
  const allowedCountries = codeList(geo.allowedCountries || raw.allowedCountries)
  const blockedCountries = codeList(geo.blockedCountries || raw.blockedCountries)
  const mode = String(geo.mode || raw.visibilityMode || "").toLowerCase() === "country_restricted" || allowedCountries.length || blockedCountries.length
    ? "country_restricted"
    : "global"
  return { mode, allowedCountries, blockedCountries }
}

export function productVisibleInCountry(product: { metadata?: unknown } | Record<string, unknown>, countryCode: string) {
  const code = normalizeCountryCode(String(countryCode || "").toUpperCase()) || "IN"
  const visibility = normalizeProductGeoVisibility(product.metadata)
  if (visibility.mode === "global") return true
  if (visibility.blockedCountries.includes(code)) return false
  if (visibility.allowedCountries.length) return visibility.allowedCountries.includes(code)
  return true
}

export function assertProductVisibleInCountry(product: { metadata?: unknown; name?: string | null }, countryCode: string) {
  if (productVisibleInCountry(product, countryCode)) return
  throw Object.assign(new Error("This product is not available in your country."), {
    code: "PRODUCT_GEO_RESTRICTED",
    status: 403,
  })
}
