import { normalizeCountryCode } from "@/lib/pricing-catalog"

export type TaxPolicy = {
  countryCode: string
  label: "GST" | "VAT" | "Tax"
  percent: number
  enabled: boolean
}

export function getTaxPolicy(countryCode?: string | null): TaxPolicy {
  const country = normalizeCountryCode(String(countryCode || "").toUpperCase()) || "IN"
  if (country === "IN") return { countryCode: country, label: "GST", percent: 18, enabled: true }
  return { countryCode: country, label: "Tax", percent: 0, enabled: false }
}
