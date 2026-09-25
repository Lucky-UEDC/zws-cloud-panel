import type { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { configuredSiteDomain, normalizeHost, publicOrigin } from "@/lib/public-url"

export type ResolvedRequestDomain = {
  domain: string
  domainConfig: any
  baseUrl: string
  isPrimary: boolean
  gatewayConfigs: any[]
}

export function getRequestHost(input: NextRequest | Request | Headers | { headers: Headers; url?: string }) {
  const headers = input instanceof Headers ? input : input.headers
  const forwardedHost = headers.get("x-forwarded-host")
  const host = headers.get("host")
  return normalizeHost(forwardedHost || host || "")
}

export function getRequestProto(input: NextRequest | Request | Headers | { headers: Headers; url?: string }) {
  const headers = input instanceof Headers ? input : input.headers
  return String(headers.get("x-forwarded-proto") || "").split(",")[0] || "https"
}

function withoutWww(host: string) {
  return host.startsWith("www.") ? host.slice(4) : host
}

export async function resolveRequestDomain(request: NextRequest | Request): Promise<ResolvedRequestDomain> {
  const configuredDomain = configuredSiteDomain()
  const requestHost = withoutWww(getRequestHost(request))
  const domain = requestHost || configuredDomain
  const origin = requestHost ? `${getRequestProto(request)}://${requestHost}` : publicOrigin()
  let domainConfig: any = null

  try {
    domainConfig = await prisma.domainConfig.findFirst({
      where: {
        isActive: true,
        OR: [
          domain ? { domain } : undefined,
          domain ? { domain: withoutWww(domain) } : undefined,
        ].filter(Boolean) as any,
      },
      include: { gatewayConfigs: { where: { enabled: true }, orderBy: { priority: "asc" } } },
    })

    if (!domainConfig) {
      domainConfig = await prisma.domainConfig.findFirst({
        where: { isPrimary: true, isActive: true },
        include: { gatewayConfigs: { where: { enabled: true }, orderBy: { priority: "asc" } } },
      })
      if (domain) console.warn("domain_config_missing_fallback_primary", { domain })
    }
  } catch (error: any) {
    console.warn("domain_resolver_failed", { domain, message: error?.message })
  }

  const resolvedDomain = domainConfig?.domain || domain
  const baseUrl = String(origin || domainConfig?.appBaseUrl || (resolvedDomain ? `https://${resolvedDomain}` : "")).replace(/\/$/, "")

  return {
    domain: resolvedDomain,
    domainConfig,
    baseUrl,
    isPrimary: Boolean(domainConfig?.isPrimary),
    gatewayConfigs: domainConfig?.gatewayConfigs || [],
  }
}

export function isPaymentSafePath(pathname: string) {
  return (
    pathname.startsWith("/phonepe/") ||
    pathname.startsWith("/api/phonepe/") ||
    pathname === "/api/payments/webhook" ||
    pathname === "/api/webhooks/phonepe" ||
    pathname === "/api/webhooks/cashfree" ||
    pathname.startsWith("/payment/phonepe/") ||
    pathname.startsWith("/payment/status")
  )
}
