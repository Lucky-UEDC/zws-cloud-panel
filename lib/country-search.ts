export type CountrySearchOption = {
  value: string
  name: string
  isoCode: string
  dialCode: string
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function dialDigits(value: string) {
  return String(value || "").replace(/\D/g, "")
}

export function filterCountrySearchOptions<T extends CountrySearchOption>(options: T[], query: string): T[] {
  const rawQuery = String(query || "").trim()
  if (!rawQuery) return options

  const normalizedQuery = normalizeText(rawQuery)
  const upperQuery = rawQuery.toUpperCase()
  const digits = dialDigits(rawQuery)
  const isIsoQuery = /^[A-Z]{2}$/.test(upperQuery)
  const isDialQuery = rawQuery.startsWith("+") || (/^\d+$/.test(rawQuery) && digits.length > 0)
  const indiaShortcut = normalizedQuery === "ind"

  return options.filter((option) => {
    const iso = String(option.isoCode || option.value || "").toUpperCase()
    const dial = dialDigits(option.dialCode)

    if (indiaShortcut) return iso === "IN"
    if (isIsoQuery) return iso === upperQuery
    if (isDialQuery) return dial === digits || (digits.length >= 2 && dial.startsWith(digits))

    const name = normalizeText(option.name)
    const tokens = name.split(/\s+/).filter(Boolean)
    return Boolean(normalizedQuery && (name === normalizedQuery || name.startsWith(normalizedQuery) || tokens.includes(normalizedQuery)))
  })
}
