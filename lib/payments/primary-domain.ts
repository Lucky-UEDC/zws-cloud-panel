import { prisma } from "@/lib/db"
import { configuredSiteDomain, publicOrigin } from "@/lib/public-url"

function normalizeDomain(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
}

export async function getPrimaryPaymentDomain() {
  const envDomain = normalizeDomain(configuredSiteDomain())
  const envBaseUrl = String(publicOrigin() || "").replace(/\/$/, "")
  const primary = await prisma.domainConfig.findFirst({
    where: { isPrimary: true, isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, domain: true, appBaseUrl: true },
  })
  if (primary) {
    return {
      id: primary.id,
      domain: envDomain || normalizeDomain(primary.domain),
      appBaseUrl: envBaseUrl || String(primary.appBaseUrl || `https://${primary.domain}`).replace(/\/$/, ""),
    }
  }

  const fallback = await prisma.domainConfig.findFirst({
    where: { isActive: true },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    select: { id: true, domain: true, appBaseUrl: true },
  })

  if (!fallback) return null
  return {
    id: fallback.id,
    domain: envDomain || normalizeDomain(fallback.domain),
    appBaseUrl: envBaseUrl || String(fallback.appBaseUrl || `https://${fallback.domain}`).replace(/\/$/, ""),
  }
}

export function normalizePaymentDomain(value: string | null | undefined) {
  return normalizeDomain(value)
}
