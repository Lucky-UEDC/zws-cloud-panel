import { Country } from "country-state-city"

export type PricingCountry = {
  code: string
  name: string
  flag: string
  currency: string
  label: string
}

const countries = Country.getAllCountries()
  .map((country) => {
    const code = String(country.isoCode || "").trim().toUpperCase()
    const name = String(country.name || "").trim()
    if (!/^[A-Z]{2}$/.test(code) || !name) return null
    const flag = isoFlag(code)
    return { code, name, flag, currency: "INR", label: `${flag ? `${flag} ` : ""}${name}` }
  })
  .filter((country): country is PricingCountry => Boolean(country))
  .sort((a, b) => a.name.localeCompare(b.name))

const byCode = new Map(countries.map((country) => [country.code, country]))
const validCurrencies = new Set(["INR"])

export const PRICING_COUNTRIES = countries

export const ROUNDING_RULES = ["nearest_0_99", "nearest_0_49", "nearest_integer", "custom_decimal"] as const
export type PricingRoundingRule = (typeof ROUNDING_RULES)[number]

export function isoFlag(countryCode: string) {
  const code = String(countryCode || "").trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ""
  return Array.from(code).map((char) => String.fromCodePoint(127397 + char.charCodeAt(0))).join("")
}

export function normalizeCountryCode(value: unknown) {
  const text = String(value || "").trim()
  return /^[A-Z]{2}$/.test(text) && byCode.has(text) ? text : ""
}

export function assertCountryCode(value: unknown) {
  const raw = String(value || "").trim()
  if (!/^[A-Z]{2}$/.test(raw)) {
    throw Object.assign(new Error("Country must be a valid uppercase ISO-3166 alpha-2 code."), { code: "INVALID_COUNTRY", status: 400 })
  }
  if (!byCode.has(raw)) {
    throw Object.assign(new Error("Country is not supported."), { code: "INVALID_COUNTRY", status: 400 })
  }
  return raw
}

export function normalizeCurrencyCode(value: unknown) {
  const text = String(value || "").trim().toUpperCase()
  return /^[A-Z]{3}$/.test(text) && validCurrencies.has(text) ? text : ""
}

export function assertCurrencyCode(value: unknown) {
  const code = normalizeCurrencyCode(value)
  if (!code) {
    throw Object.assign(new Error("Currency must be a valid ISO-4217 code."), { code: "INVALID_CURRENCY", status: 400 })
  }
  return code
}

export function getCountryCurrency(countryCode: unknown) {
  assertCountryCode(countryCode)
  return "INR"
}

export function getCountryInfo(countryCode: unknown) {
  const code = assertCountryCode(countryCode)
  return byCode.get(code)!
}

export function normalizeRoundingRule(value: unknown): PricingRoundingRule {
  const rule = String(value || "nearest_0_99").trim()
  return (ROUNDING_RULES as readonly string[]).includes(rule) ? rule as PricingRoundingRule : "nearest_0_99"
}

export function assertRoundingRule(value: unknown): PricingRoundingRule {
  const rule = String(value || "").trim()
  if (!(ROUNDING_RULES as readonly string[]).includes(rule)) {
    throw Object.assign(new Error("Unsupported rounding mode."), { code: "INVALID_ROUNDING", status: 400 })
  }
  return rule as PricingRoundingRule
}
