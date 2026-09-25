import { City, Country, State } from "country-state-city"
import { currencyForCountry, currencySymbol, localeForCountry } from "@/lib/geo-currency"

export type GeoSource = "server" | "cloudflare" | "ip" | "locale" | "timezone" | "default"

export type ResolvedLocation = {
  country: string
  countryCode: string
  dialCode: string
  currency: string
  symbol: string
  locale: string
  state: string
  stateCode: string
  city: string
  postalCode: string
  timezone: string
  ip: string
  source: GeoSource
  fallbackReason?: string
}

type HeaderReader = Pick<Headers, "get">

type IpLookupResult = {
  countryCode?: string
  country?: string
  state?: string
  city?: string
  postalCode?: string
  timezone?: string
}

type ResolveLocationOptions = {
  lookupIp?: (ip: string) => Promise<IpLookupResult | null>
  debug?: boolean
}

const DEFAULT_COUNTRY_CODE = "IN"
const INVALID_COUNTRY_CODES = new Set(["", "XX", "T1"])

function header(headers: HeaderReader, name: string) {
  return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || ""
}

function clean(value: string | null | undefined) {
  return String(value || "").trim()
}

function cleanCountryCode(value: string | null | undefined) {
  const code = clean(value).toUpperCase()
  if (!/^[A-Z]{2}$/.test(code) || INVALID_COUNTRY_CODES.has(code)) return ""
  return Country.getCountryByCode(code) ? code : ""
}

function normalizeDialCode(phonecode: string | null | undefined) {
  const digits = clean(phonecode).replace(/\D/g, "")
  return digits ? `+${digits}` : ""
}

function requestIp(headers: HeaderReader) {
  return clean(header(headers, "cf-connecting-ip"))
    || clean(header(headers, "x-forwarded-for")).split(",")[0]?.trim()
    || clean(header(headers, "x-real-ip"))
    || ""
}

function serverCountry(headers: HeaderReader) {
  const source = clean(header(headers, "x-zws-geo-source")).toLowerCase()
  if (source === "default") return ""
  return cleanCountryCode(header(headers, "x-zws-country"))
    || cleanCountryCode(header(headers, "x-country-code"))
    || cleanCountryCode(header(headers, "x-country"))
}

function vercelCountry(headers: HeaderReader) {
  return cleanCountryCode(header(headers, ["x", "vercel", "ip", "country"].join("-")))
}

function timezoneValue(headers: HeaderReader) {
  return clean(header(headers, "x-zws-timezone"))
    || clean(header(headers, "x-zws-browser-timezone"))
    || clean(header(headers, "x-timezone"))
    || clean(header(headers, "cf-timezone"))
}

function timezoneCountry(timezone: string) {
  const value = timezone.toLowerCase()
  if (!value) return ""
  if (value.includes("kolkata") || value.includes("calcutta")) return "IN"
  if (value.includes("new_york") || value.includes("los_angeles") || value.includes("chicago") || value.includes("denver")) return "US"
  if (value.includes("london")) return "GB"
  if (value.includes("berlin")) return "DE"
  if (value.includes("paris")) return "FR"
  if (value.includes("tokyo")) return "JP"
  if (value.includes("dubai")) return "AE"
  if (value.includes("singapore")) return "SG"
  if (value.includes("sydney") || value.includes("melbourne")) return "AU"
  if (value.includes("toronto") || value.includes("vancouver")) return "CA"
  return ""
}

function matchStateCode(countryCode: string, stateName: string) {
  const wanted = clean(stateName).toLowerCase()
  if (!wanted) return ""
  const states = State.getStatesOfCountry(countryCode)
  return states.find((entry) => {
    const name = entry.name.toLowerCase()
    return name === wanted || name.includes(wanted) || wanted.includes(name) || entry.isoCode.toLowerCase() === wanted
  })?.isoCode || ""
}

function matchCity(countryCode: string, stateCode: string, cityName: string) {
  const wanted = clean(cityName)
  if (!wanted || !stateCode) return wanted
  const lower = wanted.toLowerCase()
  return City.getCitiesOfState(countryCode, stateCode).find((entry) => entry.name.toLowerCase() === lower)?.name || wanted
}

function buildLocation(input: {
  countryCode: string
  state?: string
  city?: string
  postalCode?: string
  timezone?: string
  ip?: string
  source: GeoSource
  fallbackReason?: string
}): ResolvedLocation {
  const countryCode = cleanCountryCode(input.countryCode) || DEFAULT_COUNTRY_CODE
  const country = Country.getCountryByCode(countryCode) || Country.getCountryByCode(DEFAULT_COUNTRY_CODE)!
  const stateCode = matchStateCode(country.isoCode, input.state || "")
  const state = stateCode ? State.getStateByCodeAndCountry(stateCode, country.isoCode)?.name || clean(input.state) : clean(input.state)

  return {
    country: country.name,
    countryCode: country.isoCode,
    dialCode: normalizeDialCode(country.phonecode),
    currency: currencyForCountry(country.isoCode),
    symbol: currencySymbol(currencyForCountry(country.isoCode)),
    locale: localeForCountry(country.isoCode, currencyForCountry(country.isoCode)),
    state,
    stateCode,
    city: matchCity(country.isoCode, stateCode, input.city || ""),
    postalCode: clean(input.postalCode),
    timezone: clean(input.timezone) || (country.isoCode === DEFAULT_COUNTRY_CODE ? "Asia/Kolkata" : ""),
    ip: clean(input.ip),
    source: input.source,
    fallbackReason: input.fallbackReason,
  }
}

async function defaultIpLookup(ip: string): Promise<IpLookupResult | null> {
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return null
    const data = await response.json()
    return {
      countryCode: cleanCountryCode(data?.country_code),
      country: clean(data?.country_name),
      state: clean(data?.region),
      city: clean(data?.city),
      postalCode: clean(data?.postal),
      timezone: clean(data?.timezone),
    }
  } catch {
    return null
  }
}

export async function resolveLocation(headers: HeaderReader, options: ResolveLocationOptions = {}): Promise<ResolvedLocation> {
  const ip = requestIp(headers)
  const hasPublicLookupIp = Boolean(ip && !["127.0.0.1", "::1"].includes(ip))
  const trustedServerCountry = serverCountry(headers)
  const cfCountry = cleanCountryCode(header(headers, "cf-ipcountry"))
  const providerCountry = vercelCountry(headers)
  const cfCity = clean(header(headers, "cf-ipcity"))
  const cfRegion = clean(header(headers, "cf-region"))
  const cfPostalCode = clean(header(headers, "cf-postal-code"))
  const timezone = timezoneValue(headers)

  let resolved: ResolvedLocation

  if (cfCountry) {
    resolved = buildLocation({
      countryCode: cfCountry,
      state: cfRegion,
      city: cfCity,
      postalCode: cfPostalCode,
      timezone,
      ip,
      source: "cloudflare",
    })
  } else if (providerCountry) {
    resolved = buildLocation({
      countryCode: providerCountry,
      timezone,
      ip,
      source: "server",
    })
  } else if (trustedServerCountry) {
    resolved = buildLocation({
      countryCode: trustedServerCountry,
      state: cfRegion,
      city: cfCity,
      postalCode: cfPostalCode,
      timezone,
      ip,
      source: "server",
    })
  } else {
    const lookup = hasPublicLookupIp
      ? await (options.lookupIp || defaultIpLookup)(ip)
      : null
    const lookupCountry = cleanCountryCode(lookup?.countryCode)

    if (lookupCountry) {
      resolved = buildLocation({
        countryCode: lookupCountry,
        state: lookup?.state,
        city: lookup?.city,
        postalCode: lookup?.postalCode,
        timezone: lookup?.timezone || timezone,
        ip,
        source: "ip",
      })
    } else {
      const timezoneFallback = timezoneCountry(timezone)
      if (timezoneFallback && !hasPublicLookupIp) {
        resolved = buildLocation({
          countryCode: timezoneFallback,
          timezone,
          ip,
          source: "timezone",
          fallbackReason: "timezone_country",
        })
      } else {
        resolved = buildLocation({
          countryCode: DEFAULT_COUNTRY_CODE,
          timezone,
          ip,
          source: "default",
          fallbackReason: "no_geo_signal",
        })
      }
    }
  }

  if (options.debug || process.env.GEO_DEBUG === "1") {
    console.log("[GEO]", {
      ip,
      serverCountry: trustedServerCountry || null,
      cfCountry: cfCountry || null,
      providerCountry: providerCountry || null,
      cfCity: cfCity || null,
      cfRegion: cfRegion || null,
      resolvedCountry: resolved.country,
      resolvedCountryCode: resolved.countryCode,
      resolvedDialCode: resolved.dialCode,
      resolvedCurrency: resolved.currency,
      resolvedLocale: resolved.locale,
      source: resolved.source,
      fallbackReason: resolved.fallbackReason || null,
    })
  }

  return resolved
}
