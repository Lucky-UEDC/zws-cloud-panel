import { Country } from "country-state-city"
import { getUserCountry } from "@/lib/regional-pricing"
import { normalizeCountryCode } from "@/lib/pricing-catalog"

function countryFromName(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const upper = raw.toUpperCase()
  const direct = normalizeCountryCode(upper)
  if (direct) return direct
  if (["UK", "U.K.", "UNITED KINGDOM", "GREAT BRITAIN", "BRITAIN"].includes(upper)) return "GB"
  if (["USA", "U.S.A.", "US", "U.S.", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(upper)) return "US"
  const match = Country.getAllCountries().find((country) => country.name.toLowerCase() === raw.toLowerCase())
  return normalizeCountryCode(String(match?.isoCode || "").toUpperCase())
}

export function normalizeBillingCountry(value: unknown) {
  return countryFromName(value)
}

export async function resolveCheckoutCountry(input: {
  request?: Request | { headers?: Headers | null } | null
  billingCountry?: string | null
  customer?: { country?: string | null; billingAddress?: unknown; address?: unknown } | null
}) {
  const addressValue = input.customer?.billingAddress || input.customer?.address
  const billingAddress = addressValue && typeof addressValue === "object" && !Array.isArray(addressValue)
    ? addressValue as Record<string, unknown>
    : {}
  const billingCountry = normalizeBillingCountry(input.billingCountry || input.customer?.country || billingAddress.country)
  if (billingCountry) return billingCountry
  return getUserCountry(input.request || null)
}

export function isIndiaCountry(countryCode?: string | null) {
  return normalizeCountryCode(String(countryCode || "").toUpperCase()) === "IN"
}

export function allowedGatewayCountries(countryCode?: string | null) {
  void countryCode
  return new Set(["razorpay", "phonepe", "cashfree"])
}
