import { prisma } from "@/lib/db"
import { calculateOrderPricing } from "@/lib/order-pricing"

export const OFFER_TERMS = [1, 3, 6, 12, 24, 36] as const

export function slugifyOffer(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

export function normalizeOfferTerms(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [1]
  const terms = raw.map((item) => Number(item)).filter((item) => OFFER_TERMS.includes(item as any))
  return Array.from(new Set(terms.length ? terms : [1])).sort((a, b) => a - b)
}

export function offerAvailability(offer: {
  active: boolean
  startsAt?: Date | string | null
  endsAt?: Date | string | null
  maxPurchases?: number | null
  purchasesCount?: number | null
}) {
  const now = Date.now()
  if (!offer.active) return { available: false, reason: "Offer is no longer available." }
  if (offer.startsAt && new Date(offer.startsAt).getTime() > now) return { available: false, reason: "Offer is no longer available." }
  if (offer.endsAt && new Date(offer.endsAt).getTime() < now) return { available: false, reason: "Offer is no longer available." }
  if (offer.maxPurchases && Number(offer.purchasesCount || 0) >= offer.maxPurchases) return { available: false, reason: "Offer is no longer available." }
  return { available: true, reason: null }
}

export function snapshotOffer(offer: any) {
  return {
    id: offer.id,
    name: offer.name,
    slug: offer.slug,
    headline: offer.headline,
    planLabel: offer.planLabel,
    vcpu: Number(offer.vcpu || 0),
    ramGb: Number(offer.ramGb || 0),
    storageGb: Number(offer.storageGb || 0),
    bandwidthTb: Number(offer.bandwidthTb || 0),
    baseMonthlyPrice: Number(offer.baseMonthlyPrice || 0),
    offerMonthlyPrice: Number(offer.offerMonthlyPrice || 0),
    gstEnabled: Boolean(offer.gstEnabled),
    gstPercent: Number(offer.gstPercent || 18),
    billingTermsAllowed: normalizeOfferTerms(offer.billingTermsAllowed),
    defaultBillingTerm: Number(offer.defaultBillingTerm || 1),
    nodeClassId: offer.nodeClassId || null,
    storagePoolId: offer.storagePoolId || null,
    osTemplateId: offer.osTemplateId || null,
    capturedAt: new Date().toISOString(),
  }
}

export function calculateOfferPricing(offer: any, termMonths: number, couponDiscount = 0) {
  const base = Number(offer.baseMonthlyPrice || 0)
  const final = Number(offer.offerMonthlyPrice || base)
  const discountPercent = base > final ? Math.round(((base - final) / base) * 100) : 0
  return calculateOrderPricing({
    monthlyBase: base,
    monthlyFinal: final,
    termMonths,
    discountPercent,
    couponDiscount,
    gstEnabled: Boolean(offer.gstEnabled),
    gstPercent: Number(offer.gstPercent || 18),
    lineItems: [
      { label: "vCPU", amount: 0, included: true, recurring: true },
      { label: "RAM", amount: 0, included: true, recurring: true },
      { label: "Storage", amount: 0, included: true, recurring: true },
      { label: "Bandwidth", amount: 0, included: true, recurring: true },
    ],
  })
}

export async function getPublicOffer(slug: string) {
  return prisma.offer.findUnique({
    where: { slug },
    include: {
      osTemplate: true,
      nodeClassRef: true,
      proxmoxNodeStoragePool: true,
    },
  })
}

