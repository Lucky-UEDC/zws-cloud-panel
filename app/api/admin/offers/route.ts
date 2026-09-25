import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiError, apiSuccess } from "@/lib/api-response"
import { getAdminFromCookies } from "@/lib/server-auth"
import { normalizeOfferTerms, slugifyOffer } from "@/lib/offers"
import { writeAuditLog } from "@/lib/audit-log"
import { canManageCatalog } from "@/lib/admin-rbac"
import { revalidateProductSurfaces } from "@/lib/product-revalidation"

export const dynamic = "force-dynamic"

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean)
  if (typeof value === "string") return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
  return []
}

function metadataPayload(body: any) {
  const existing = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : {}
  const metadata = metadataPayload(body)
  return {
    ...existing,
    badgeText: stringList(body.badgeText ?? existing.badgeText),
    heroCtaText: String(body.heroCtaText ?? existing.heroCtaText ?? "").trim() || null,
    includedFeatures: stringList(body.includedFeatures ?? existing.includedFeatures),
    builtFor: stringList(body.builtFor ?? existing.builtFor),
    trustPoints: stringList(body.trustPoints ?? existing.trustPoints),
    allowedOsFamilies: stringList(body.allowedOsFamilies ?? existing.allowedOsFamilies).map((item) => item.toLowerCase()),
    previewedAt: body.previewedAt ?? existing.previewedAt ?? null,
  }
}

function offerPayload(body: any) {
  const name = String(body.name || "").trim()
  const slug = slugifyOffer(body.slug || name)
  const terms = normalizeOfferTerms(body.billingTermsAllowed ?? body.allowedBillingTerms)
  const defaultTerm = terms.includes(Number(body.defaultBillingTerm)) ? Number(body.defaultBillingTerm) : terms[0]
  const baseMonthlyPrice = body.baseMonthlyPrice ?? body.originalMonthlyPrice
  const metadata = metadataPayload(body)
  return {
    name,
    slug,
    headline: String(body.headline || name || "").trim() || null,
    description: String(body.description ?? body.subheadline ?? "").trim() || null,
    planLabel: String(body.planLabel || "").trim() || null,
    productId: body.productId ? String(body.productId) : null,
    vcpu: numberValue(body.vcpu),
    ramGb: numberValue(body.ramGb),
    storageGb: numberValue(body.storageGb),
    bandwidthTb: numberValue(body.bandwidthTb, 1),
    storageTier: String(body.storageTier || "").trim() || null,
    storagePoolPolicy: String(body.storagePoolPolicy || "").trim() || null,
    storagePoolId: body.storagePoolId ? String(body.storagePoolId) : null,
    cpuClass: String(body.cpuClass || "").trim() || null,
    nodeClassId: body.nodeClassId ? String(body.nodeClassId) : null,
    region: String(body.region || "").trim() || null,
    osTemplateId: body.osTemplateId || body.defaultOsTemplateId ? String(body.osTemplateId || body.defaultOsTemplateId) : null,
    defaultCpuSockets: body.defaultCpuSockets ? numberValue(body.defaultCpuSockets) : null,
    defaultCoresPerSocket: body.defaultCoresPerSocket ? numberValue(body.defaultCoresPerSocket) : null,
    baseMonthlyPrice: numberValue(baseMonthlyPrice),
    offerMonthlyPrice: numberValue(body.offerMonthlyPrice),
    gstEnabled: body.gstEnabled !== false,
    gstPercent: numberValue(body.gstPercent, 18),
    billingTermsAllowed: terms,
    defaultBillingTerm: defaultTerm,
    maxPurchases: body.maxPurchases ? numberValue(body.maxPurchases) : null,
    startsAt: body.startsAt ? new Date(String(body.startsAt)) : null,
    endsAt: body.endsAt ? new Date(String(body.endsAt)) : null,
    active: Boolean(body.active && metadata.previewedAt),
    featured: Boolean(body.featured),
    metadata,
  }
}

function validateOffer(data: ReturnType<typeof offerPayload>) {
  if (!data.name) return "Offer name is required."
  if (!data.slug) return "Offer slug is required."
  if (data.vcpu <= 0 || data.ramGb <= 0 || data.storageGb <= 0) return "Offer specs must be greater than zero."
  if (data.baseMonthlyPrice <= 0 || data.offerMonthlyPrice <= 0) return "Offer price must be greater than zero."
  if (!Array.isArray(data.billingTermsAllowed) || data.billingTermsAllowed.length === 0) return "At least one billing term is required."
  return null
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) return apiError("unauthorized", "Unauthorized", 401)
  const offers = await prisma.offer.findMany({
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    include: { product: { select: { id: true, name: true } }, nodeClassRef: true, osTemplate: { select: { id: true, name: true } } },
  })
  return apiSuccess({ offers })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) return apiError("unauthorized", "Unauthorized", 401)
  const body = await request.json().catch(() => ({}))
  const data = offerPayload(body)
  const error = validateOffer(data)
  if (error) return apiError("invalid_offer", error, 400)
  try {
    const offer = await prisma.offer.create({ data: data as any })
    await writeAuditLog({ action: "offer_created", actorEmail: String(admin.email), targetType: "offer", targetId: offer.id, newValue: { slug: offer.slug, name: offer.name } })
    revalidateProductSurfaces()
    return apiSuccess({ offer }, 201)
  } catch (error: any) {
    if (error?.code === "P2002") return apiError("slug_exists", "Offer slug already exists.", 409)
    console.error("[ADMIN_OFFERS_POST]", error)
    return apiError("server_error", "Unable to create offer", 500)
  }
}
