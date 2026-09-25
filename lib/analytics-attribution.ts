export type AnalyticsTrafficSource = "Google Search" | "Direct" | "Referral" | "Social" | "Ads" | "Organic"

function text(value: unknown) {
  return String(value || "").trim()
}

export function normalizeTrafficSource(input: { utmSource?: unknown; referrer?: unknown }): AnalyticsTrafficSource {
  const source = text(input.utmSource).toLowerCase()
  const medium = text((input as any).utmMedium).toLowerCase()
  const referrer = text(input.referrer).toLowerCase()
  const haystack = `${source} ${medium} ${referrer}`
  if (/cpc|ppc|paid|ads|adwords|gclid|fbclid|msclkid/.test(haystack)) return "Ads"
  if (/facebook|fb\.|instagram|whatsapp|wa\.me|twitter|x\.com|linkedin|t\.co/.test(haystack)) return "Social"
  if (/google\./.test(referrer) || source === "google") return "Google Search"
  if (/bing\.|duckduckgo\.|yahoo\./.test(referrer) || medium === "organic") return "Organic"
  if (!referrer && !source) return "Direct"
  return "Referral"
}

export function detectCrawler(userAgent: unknown) {
  const ua = text(userAgent).toLowerCase()
  if (ua.includes("googlebot") || ua.includes("adsbot-google")) return "googlebot"
  if (ua.includes("bingbot")) return "bingbot"
  if (ua.includes("facebookexternalhit") || ua.includes("facebot")) return "facebook crawler"
  if (ua.includes("twitterbot")) return "twitter crawler"
  if (ua.includes("search.google.com")) return "search.google.com"
  return null
}

export function extractUtmFromPath(pathOrUrl: unknown) {
  const raw = text(pathOrUrl)
  if (!raw) return { utmSource: null as string | null, utmMedium: null as string | null }
  try {
    const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, publicOrigin() || "https://example.com")
    return {
      utmSource: text(url.searchParams.get("utm_source")) || null,
      utmMedium: text(url.searchParams.get("utm_medium")) || null,
    }
  } catch {
    return { utmSource: null as string | null, utmMedium: null as string | null }
  }
}
import { publicOrigin } from "@/lib/public-url"
