import crypto from "node:crypto"
import type { NextRequest } from "next/server"
import type { DeviceContext } from "@/lib/auth/mfa/types"
import { extractClientIp, getRequestContext } from "@/lib/request-context"

export function extractRequestIp(request: NextRequest | Request) {
  return extractClientIp(request)
}

export async function getRequestDeviceContext(request: NextRequest | Request): Promise<DeviceContext> {
  const context = await getRequestContext(request)

  return {
    ip: context.ip,
    city: context.city,
    region: context.region,
    country: context.country,
    timezone: context.timezone,
    asn: context.asn,
    provider: context.provider,
    proxy: context.proxy,
    vpn: context.vpn,
    tor: context.tor,
    relay: context.relay,
    browser: context.browser,
    browserVersion: context.browserVersion,
    os: context.os,
    osVersion: context.osVersion,
    deviceType: context.deviceType,
    platform: context.platform,
    cpuArchitecture: context.cpuArchitecture,
    userAgent: context.userAgent,
  }
}

export function deviceFingerprint(input: DeviceContext) {
  return crypto.createHash("sha256").update([
    input.browser,
    input.browserVersion || "",
    input.os,
    input.osVersion || "",
    input.deviceType,
    input.platform || "",
    input.cpuArchitecture || "",
  ].join("|")).digest("hex")
}
