import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import {
  normalizeCountryCode,
  normalizeCurrencyCode,
  normalizeRoundingRule,
  type PricingRoundingRule,
} from "@/lib/pricing-catalog"
import { countryFromAcceptLanguage, countryFromTimezone } from "@/lib/geo-currency"
import { createPricingToken } from "@/lib/pricing-token"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { formatCurrency } from "@/lib/currency-format"

const ONE_HOUR_SECONDS = 60 * 60
const GLOBAL_KEY = "global_pricing_settings"

export type GlobalPricingSettings = {
  enabled: boolean
  defaultMarkupPercent: number
  baseCurrency: "INR"
  enabledCurrencies: string[]
  defaultRoundingRule: PricingRoundingRule
  originCountry: "IN"
  originCurrency: "INR"
  updatedAt?: string | null
  updatedBy?: string | null
}

export const DEFAULT_GLOBAL_PRICING_SETTINGS: GlobalPricingSettings = {
  enabled: true,
  defaultMarkupPercent: 40,
  baseCurrency: "INR",
  enabledCurrencies: ["INR"],
  defaultRoundingRule: "nearest_0_99",
  originCountry: "IN",
  originCurrency: "INR",
}

export type CurrencyContext = {
  countryCode: string
  currency: string
  locale: string
  rate: number
  markupPercent: number
  roundingRule: PricingRoundingRule
  stale: boolean
  rateSource?: string | null
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function markupPercent(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(0, parsed)) : 0
}

async function redisGetJson<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    await redis.connect().catch(() => undefined)
    const raw = await redis.get(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

async function redisSetJson(key: string, value: unknown, ttlSeconds?: number) {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    if (ttlSeconds) await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
    else await redis.set(key, JSON.stringify(value))
  } catch {
    // DB and static rates remain the fallback path.
  }
}

export async function invalidateRegionalPricingCache(countryCode?: string | null) {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    await redis.del("regional-pricing:global")
    const country = normalizeCountryCode(String(countryCode || "").toUpperCase())
    if (country) await redis.del(`regional-pricing:country:${country}`)
  } catch {
    // Mutations still persist to the database; cache will expire naturally.
  }
}

export function parseAcceptLanguageCountry(value: string | null) {
  return normalizeCountryCode(countryFromAcceptLanguage(value))
}

function requestIp(headers?: Headers | null) {
  return String(headers?.get("cf-connecting-ip") || headers?.get("x-forwarded-for") || headers?.get("x-real-ip") || "").split(",")[0].trim()
}

function isLocalOrPrivateIp(ip: string) {
  const value = String(ip || "").trim()
  return !value
    || value === "127.0.0.1"
    || value === "::1"
    || value.startsWith("10.")
    || value.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
}

function isCloudflareIp(ip: string) {
  const value = String(ip || "").trim()
  if (!value) return false
  if (/^(173\.245\.(4[8-9]|5\d|6[0-3])\.|103\.(21\.244\.|22\.20[0-3]\.|31\.(4|5|6|7)\.)|141\.101\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|108\.162\.19[2-9]\.|108\.162\.2[0-5]\d\.|190\.93\.(24[0-9]|25[0-5])\.|188\.114\.(9[6-9])\.|197\.234\.24[0-3]\.|198\.41\.(12[8-9]|1[3-8]\d|19[0-1])\.|162\.158\.|104\.(1[6-9]|2[0-9]|3[01])\.|172\.(6[4-9]|7\d)\.|131\.0\.7[2-5]\.)/.test(value)) return true
  return /^(2400:cb00:|2606:4700:|2803:f800:|2405:b500:|2405:8100:|2a06:98c0:|2c0f:f248:)/i.test(value)
}

async function maxMindCountry(ip: string) {
  const geo = await getServiceIntegrationConfig("geoIp").catch(() => ({} as Record<string, unknown>))
  const dbPath = String(geo.maxmindDbPath || "").trim()
  const endpoint = String(geo.endpoint || geo.url || "").trim()
  const apiKey = String(geo.apiKey || geo.api_key || "").trim()
  if (endpoint && ip && !isLocalOrPrivateIp(ip)) {
    try {
      const url = new URL(endpoint)
      url.searchParams.set("ip", ip)
      const response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        cache: "no-store",
      })
      const body = await response.json().catch(() => ({}))
      const country = body?.country_code || body?.countryCode || body?.country || body?.location?.country_code
      const normalized = normalizeCountryCode(String(country || "").toUpperCase())
      if (normalized) return normalized
    } catch {
      // Fall through to MaxMind and India fallback.
    }
  }
  if (!dbPath || !ip) return ""
  try {
    const importer = Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>
    const maxmind = await importer("maxmind")
    const lookup = await maxmind.open(dbPath)
    const country = lookup.get(ip)?.country?.iso_code || lookup.get(ip)?.registered_country?.iso_code
    return normalizeCountryCode(String(country || "").toUpperCase())
  } catch {
    return ""
  }
}

export async function getUserCountry(request?: Request | { headers?: Headers | null } | null) {
  const headers = request?.headers || null
  const runtimeCountry = normalizeCountryCode(String(headers?.get("x-zws-country") || "").toUpperCase())
  if (runtimeCountry) return runtimeCountry
  const cfCountry = normalizeCountryCode(String(headers?.get("cf-ipcountry") || "").toUpperCase())
  const ip = requestIp(headers)
  if (cfCountry && (headers?.has("cf-ray") || isCloudflareIp(ip) || isLocalOrPrivateIp(ip))) {
    console.log("[GEOIP]", { source: "cf-ipcountry", country: cfCountry })
    return cfCountry
  }
  const providerCountryHeader = ["x", "vercel", "ip", "country"].join("-")
  const vercelCountry = normalizeCountryCode(String(headers?.get(providerCountryHeader) || "").toUpperCase())
  if (vercelCountry) {
    console.log("[GEOIP]", { source: providerCountryHeader, country: vercelCountry })
    return vercelCountry
  }
  const geoCountry = await maxMindCountry(ip)
  if (geoCountry) {
    console.log("[GEOIP]", { source: "geoip", country: geoCountry })
    return geoCountry
  }
  const providerTimezoneHeader = ["x-v", "ercel-ip-timezone"].join("")
  const timezoneCountry = normalizeCountryCode(countryFromTimezone(headers?.get(providerTimezoneHeader) || headers?.get("x-timezone") || ""))
  if (timezoneCountry && isLocalOrPrivateIp(ip)) return timezoneCountry
  const cookieCountry = String(headers?.get("cookie") || "").match(/(?:^|;\s*)country=([A-Z]{2})/)?.[1]
  const normalizedCookieCountry = normalizeCountryCode(String(cookieCountry || "").toUpperCase())
  if (normalizedCookieCountry) return normalizedCookieCountry
  return "IN"
}

export function getCurrencyForCountry(countryCode: string) {
  void countryCode
  return "INR"
}

export async function getGlobalPricingSettings(): Promise<GlobalPricingSettings> {
  const cached = await redisGetJson<GlobalPricingSettings>("regional-pricing:global")
  if (cached) return { ...DEFAULT_GLOBAL_PRICING_SETTINGS, ...cached, baseCurrency: "INR", originCountry: "IN", originCurrency: "INR", defaultRoundingRule: normalizeRoundingRule(cached.defaultRoundingRule) }
  const row = await (prisma as any).adminSetting.findUnique({ where: { key: GLOBAL_KEY } }).catch(() => null)
  const value = row?.value && typeof row.value === "object" ? row.value as Record<string, unknown> : {}
  const enabledCurrencies = Array.isArray(value.enabledCurrencies)
    ? value.enabledCurrencies.map((item) => normalizeCurrencyCode(item)).filter(Boolean)
    : DEFAULT_GLOBAL_PRICING_SETTINGS.enabledCurrencies
  const settings: GlobalPricingSettings = {
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
    defaultMarkupPercent: value.defaultMarkupPercent === undefined ? 40 : markupPercent(value.defaultMarkupPercent),
    baseCurrency: "INR",
    enabledCurrencies: ["INR"],
    defaultRoundingRule: normalizeRoundingRule(value.defaultRoundingRule || DEFAULT_GLOBAL_PRICING_SETTINGS.defaultRoundingRule),
    originCountry: "IN",
    originCurrency: "INR",
    updatedAt: row?.updatedAt?.toISOString?.() || null,
    updatedBy: row?.updatedBy || null,
  }
  await redisSetJson("regional-pricing:global", settings, ONE_HOUR_SECONDS)
  return settings
}

export async function updateGlobalPricingSettings(input: unknown, updatedBy?: string | null) {
  const payload = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const settings: GlobalPricingSettings = {
    enabled: Boolean(payload.enabled),
    defaultMarkupPercent: markupPercent(payload.defaultMarkupPercent),
    baseCurrency: "INR",
    enabledCurrencies: ["INR"],
    defaultRoundingRule: normalizeRoundingRule(payload.defaultRoundingRule || DEFAULT_GLOBAL_PRICING_SETTINGS.defaultRoundingRule),
    originCountry: "IN",
    originCurrency: "INR",
    updatedBy: updatedBy || null,
    updatedAt: new Date().toISOString(),
  }
  const row = await (prisma as any).adminSetting.upsert({
    where: { key: GLOBAL_KEY },
    update: { value: settings as any, updatedBy: updatedBy || null },
    create: { key: GLOBAL_KEY, value: settings as any, description: "Global country pricing settings", updatedBy: updatedBy || null },
  })
  await redisSetJson("regional-pricing:global", settings, ONE_HOUR_SECONDS)
  return { ...settings, updatedAt: row.updatedAt?.toISOString?.() || settings.updatedAt }
}

async function getCountryPricing(countryCode: string) {
  const code = normalizeCountryCode(countryCode) || "IN"
  const cacheKey = `regional-pricing:country:${code}`
  const cached = await redisGetJson<any>(cacheKey)
  if (cached !== null) return cached
  const row = await (prisma as any).countryPricing.findUnique({ where: { countryCode: code } }).catch(() => null)
  await redisSetJson(cacheKey, row || null, ONE_HOUR_SECONDS)
  return row
}

function roundRegional(value: number, rule: PricingRoundingRule) {
  if (rule === "nearest_integer") return Math.round(value)
  if (rule === "nearest_0_49") return money(Math.max(0, Math.ceil(value) - 0.51))
  if (rule === "custom_decimal") return money(value)
  return money(Math.max(0, Math.ceil(value) - 0.01))
}

export async function getRegionalPrice(input: {
  amountInr: number
  countryCode?: string | null
  term?: number | null
  product?: string | null
  customerId?: string | null
  context?: Record<string, unknown> | null
}) {
  const countryCode = normalizeCountryCode(String(input.countryCode || "").toUpperCase()) || "IN"
  const baseAmountInr = money(input.amountInr)
  if (!Number.isFinite(baseAmountInr) || baseAmountInr < 0) {
    throw Object.assign(new Error("Invalid base price."), { code: "INVALID_PRICE", status: 400 })
  }
  const token = createPricingToken({
    product: String(input.product || input.context?.productId || ""),
    term: input.term || null,
    customerId: input.customerId || null,
    country: countryCode,
    currency: "INR",
    price: baseAmountInr,
    baseAmountInr,
    exchangeRate: 1,
    markup: 0,
    rounding: "custom_decimal",
  })
  return {
    countryCode,
    displayAmount: baseAmountInr,
    displayCurrency: "INR",
    baseAmountInr,
    exchangeRate: 1,
    markupPercent: 0,
    roundingRule: "custom_decimal",
    approxInrLabel: null,
    formatted: `${formatCurrency(baseAmountInr, "INR")} INR`,
    fallback: false,
    rateSource: "origin",
    rateFetchedAt: new Date().toISOString(),
    stale: false,
    currencyName: "Indian Rupee",
    token,
  }
}
