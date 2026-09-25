import { isIP } from "node:net"
import { UAParser } from "ua-parser-js"
import { resolveLocation } from "@/lib/geo/resolve-location"

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
]

type HeaderReader = Pick<Headers, "get">

function firstHeader(headers: HeaderReader, name: string) {
  return headers.get(name) || headers.get(name.toLowerCase()) || headers.get(name.toUpperCase()) || ""
}

function cleanIp(value: string | null | undefined) {
  const candidate = String(value || "").split(",")[0]?.trim().replace(/^::ffff:/, "") || ""
  return isIP(candidate) ? candidate : ""
}

function publicForwardedIp(value: string | null | undefined) {
  for (const part of String(value || "").split(",")) {
    const candidate = part.trim().replace(/^::ffff:/, "")
    if (isIP(candidate) && publicIp(candidate)) return candidate
  }
  return ""
}

function publicIp(value: string) {
  if (!value) return ""
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(value)) ? "" : value
}

export function extractClientIp(headersOrRequest: HeaderReader | Request) {
  const headers = "headers" in headersOrRequest ? headersOrRequest.headers : headersOrRequest
  return (
    publicIp(cleanIp(firstHeader(headers, "cf-connecting-ip"))) ||
    publicForwardedIp(firstHeader(headers, "x-forwarded-for")) ||
    publicIp(cleanIp(firstHeader(headers, "x-real-ip"))) ||
    cleanIp((headersOrRequest as any).ip) ||
    "unknown"
  )
}

async function lookupIpIntel(ip: string) {
  if (!ip || ip === "unknown" || PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip))) return null
  const token = process.env.IPINFO_TOKEN
  const url = `https://ipinfo.io/${encodeURIComponent(ip)}/json${token ? `?token=${encodeURIComponent(token)}` : ""}`
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export async function getRequestContext(request: Request) {
  const ip = extractClientIp(request)
  const userAgent = request.headers.get("user-agent") || ""
  const parsed = new UAParser(userAgent).getResult()
  const [location, intel] = await Promise.all([
    resolveLocation(request.headers).catch(() => null),
    lookupIpIntel(ip).catch(() => null),
  ])
  const org = String(intel?.org || "")
  const privacy = intel?.privacy || {}
  const browser = parsed.browser.name || "Unknown browser"
  const os = parsed.os.name || "Unknown OS"
  const deviceType = parsed.device.type || (/(mobile|android|iphone)/i.test(userAgent) ? "mobile" : "desktop")
  const device = `${browser} on ${os}`
  const provider = org || null
  const proxy = Boolean(privacy?.vpn || privacy?.proxy || privacy?.tor || privacy?.relay || /hosting|cloud|digitalocean|amazon|google|microsoft|ovh|hetzner/i.test(org))

  return {
    ip,
    country: location?.countryCode || intel?.country || null,
    countryName: location?.country || null,
    region: location?.state || intel?.region || null,
    city: location?.city || intel?.city || null,
    timezone: location?.timezone || intel?.timezone || null,
    asn: org.split(" ")[0] || null,
    provider,
    proxy,
    vpn: Boolean(privacy?.vpn),
    tor: Boolean(privacy?.tor),
    relay: Boolean(privacy?.relay),
    browser,
    browserVersion: parsed.browser.version || null,
    os,
    osVersion: parsed.os.version || null,
    device,
    deviceType,
    platform: parsed.device.vendor || parsed.cpu.architecture || deviceType,
    cpuArchitecture: parsed.cpu.architecture || null,
    userAgent,
    geoSource: location?.source || (intel ? "ip" : "default"),
  }
}
