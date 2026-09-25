import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

export class MediaUrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MediaUrlValidationError"
  }
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip)
  if (!version) return false

  if (version === 4) {
    const [a, b] = String(ip).split(".").map(Number)
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0 && (String(ip).split(".")[2] === "0" || Number(String(ip).split(".")[2]) === 0 && Number(String(ip).split(".")[3]) === 0)) return true
    if (a >= 224) return true
    return false
  }

  if (version === 6) {
    const lower = String(ip).toLowerCase()
    if (lower === "::" || lower === "::1") return true
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true
    if (lower.startsWith("fe80") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true
    if (lower.startsWith("ff")) return true
    if (/^::ffff:/.test(lower)) {
      const mapped = lower.replace(/^::ffff:/, "")
      return isPrivateAddress(mapped)
    }
    return false
  }

  return false
}

export type DnsResolver = typeof lookup

export async function assertPublicMediaUrl(rawUrl: unknown, resolver: DnsResolver = lookup, opts: { allowAnyPolicy?: boolean } = {}): Promise<string> {
  const candidate = String(rawUrl ?? "").trim()
  if (!candidate) throw new MediaUrlValidationError("Media URL is required")

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new MediaUrlValidationError("Invalid media URL")
  }

  if (!/^https?:$/i.test(url.protocol)) throw new MediaUrlValidationError("Media URL must use http or https")
  if (url.username || url.password) throw new MediaUrlValidationError("Media URLs must not embed credentials")
  if (!url.hostname) throw new MediaUrlValidationError("Invalid media URL host")

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) throw new MediaUrlValidationError("Media URL points to a private or reserved network address")
    return url.toString()
  }

  if (opts.allowAnyPolicy) return url.toString()

  const addresses = await resolver(url.hostname, { all: true, verbatim: true }).catch(() => [])
  if (!addresses.length) throw new MediaUrlValidationError("Unable to resolve media URL host")
  for (const entry of addresses) {
    const address = typeof entry === "string" ? entry : entry.address
    if (isPrivateAddress(address)) throw new MediaUrlValidationError("Media URL resolves to a private or reserved network address")
  }

  return url.toString()
}

export function describeMediaUrlErrors(urls: unknown[]): string[] {
  return urls.map((item) => {
    try {
      assertPublicMediaUrl(item)
      return ""
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid media URL"
    }
  })
}