import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { SiteShell } from "@/components/layout/site-shell"
import { Container } from "@/components/layout/container"
import { OfferCheckout } from "@/components/offers/offer-checkout"
import { getPublicOperatingSystems } from "@/lib/public-operating-systems"
import { calculateOfferPricing, getPublicOffer, offerAvailability } from "@/lib/offers"
import { Button } from "@/components/ui/button"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string") return value.split("\n").map((item) => item.trim()).filter(Boolean)
  return []
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown, fallback = 0) {
  const next = Number(value ?? fallback)
  return Number.isFinite(next) ? next : fallback
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function safeDateIso(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizeOfferForClient(offer: any, terms: number[]) {
  return {
    id: safeText(offer?.id),
    name: safeText(offer?.name, "Launch Offer"),
    slug: safeText(offer?.slug),
    headline: safeText(offer?.headline) || null,
    description: safeText(offer?.description) || null,
    planLabel: safeText(offer?.planLabel) || null,
    vcpu: numberValue(offer?.vcpu),
    ramGb: numberValue(offer?.ramGb),
    storageGb: numberValue(offer?.storageGb),
    bandwidthTb: numberValue(offer?.bandwidthTb),
    baseMonthlyPrice: numberValue(offer?.baseMonthlyPrice),
    offerMonthlyPrice: numberValue(offer?.offerMonthlyPrice),
    gstEnabled: offer?.gstEnabled !== false,
    gstPercent: numberValue(offer?.gstPercent, 18),
    billingTermsAllowed: terms,
    defaultBillingTerm: terms.includes(numberValue(offer?.defaultBillingTerm, 1)) ? numberValue(offer?.defaultBillingTerm, 1) : terms[0] || 1,
    defaultOsTemplateId: safeText(offer?.osTemplateId) || null,
    allowedOsFamilies: stringArray(metadataObject(offer?.metadata).allowedOsFamilies),
    endsAt: safeDateIso(offer?.endsAt),
  }
}

function normalizeTerms(value: unknown, fallbackTerm: unknown) {
  const terms = Array.isArray(value)
    ? value.map((item) => numberValue(item)).filter((item) => item > 0)
    : [numberValue(fallbackTerm, 1)]
  return Array.from(new Set(terms.length ? terms : [1]))
}

function normalizeTemplatesForClient(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((template: any) => ({
    id: safeText(template?.representativeTemplateId) || safeText(template?.id),
    representativeTemplateId: safeText(template?.representativeTemplateId) || null,
    name: safeText(template?.name, "Linux"),
    slug: safeText(template?.slug) || null,
    osType: safeText(template?.osType) || null,
    category: safeText(template?.category) || null,
    family: safeText(template?.family || template?.osFamily) || null,
    familyLabel: safeText(template?.familyLabel) || null,
    familyDescription: safeText(template?.familyDescription) || null,
    version: safeText(template?.version || template?.osVersion) || null,
    defaultUsername: safeText(template?.defaultUsername, "root"),
    recommended: Boolean(template?.recommended || template?.isRecommended),
    isDefault: Boolean(template?.isDefault),
    iconUrl: safeText(template?.iconUrl) || null,
    eolWarningText: safeText(template?.eolWarningText) || null,
    proxmoxTemplateName: safeText(template?.proxmoxTemplateName) || null,
  })).filter((template) => template.id && template.name)
}

function logOfferPageError(slug: string, phase: string, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error || "Unknown error"))
  console.error("[offer_page_load_failed]", {
    slug,
    phase,
    message: err.message,
    stack: err.stack,
  })
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const offer = await getPublicOffer(slug).catch(() => null)
  if (!offer) return buildPageMetadata({
    title: "Offer unavailable",
    description: "This offer is unavailable.",
    path: `/offer/${slug}`,
    robots: { index: false, follow: false },
  })
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: String(offer.planLabel || offer.name),
    description: `Configure this ${site.brandName} promotional compute offer with operating system, credentials, billing, and secure checkout.`,
    path: `/offer/${slug}`,
    robots: { index: true, follow: true },
  })
}

export default async function OfferPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await getPublicOffer(slug).catch((error) => {
    logOfferPageError(slug, "offer_fetch", error)
    return null
  })
  if (!offer) notFound()
  const availability = offerAvailability(offer)
  const rawOperatingSystems = await getPublicOperatingSystems().catch((error) => {
    logOfferPageError(slug, "os_templates_fetch", error)
    return []
  })
  const terms = normalizeTerms(offer.billingTermsAllowed, offer.defaultBillingTerm)
  const safeOffer = normalizeOfferForClient(offer, terms)
  const operatingSystems = normalizeTemplatesForClient(rawOperatingSystems)
  const pricing = (() => {
    try {
      return calculateOfferPricing(offer, safeOffer.defaultBillingTerm)
    } catch (error) {
      logOfferPageError(slug, "pricing", error)
      return { payableToday: safeOffer.offerMonthlyPrice }
    }
  })()

  return (
    <SiteShell>
      <section className="py-10 sm:py-14">
        <Container>
          {availability.available ? (
            <OfferCheckout
              offer={safeOffer}
              operatingSystems={operatingSystems}
              paymentAvailable
            />
          ) : (
            <UnavailableOffer reason={availability.reason || "This offer is no longer available."} />
          )}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Offer",
              "name": offer.name,
              "price": String(pricing.payableToday),
              "priceCurrency": "INR",
              "availability": availability.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            }) }}
          />
        </Container>
      </section>
    </SiteShell>
  )
}

function UnavailableOffer({ reason }: { reason: string }) {
  return (
    <div className="glass mx-auto max-w-2xl rounded-2xl p-8 text-center">
      <h1 className="text-3xl font-semibold">This offer is no longer available</h1>
      <p className="mt-3 text-muted-foreground">{reason}</p>
      <Button asChild className="mt-6">
        <Link href="/compute-instances">Back to Compute Instances</Link>
      </Button>
    </div>
  )
}
