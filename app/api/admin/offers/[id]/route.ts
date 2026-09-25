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

function metadataPatch(body: any, current: unknown) {
  const existing = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {}
  const next: Record<string, unknown> = { ...existing }
  if (body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)) Object.assign(next, body.metadata)
  for (const key of ["badgeText", "includedFeatures", "builtFor", "trustPoints", "allowedOsFamilies"]) {
    if (body[key] !== undefined) next[key] = key === "allowedOsFamilies" ? stringList(body[key]).map((item) => item.toLowerCase()) : stringList(body[key])
  }
  if (body.heroCtaText !== undefined) next.heroCtaText = String(body.heroCtaText || "").trim() || null
  if (body.previewedAt !== undefined) next.previewedAt = body.previewedAt || null
  return next
}

function updatePayload(body: any, before: any) {
  const termInput = body.billingTermsAllowed === undefined ? body.allowedBillingTerms : body.billingTermsAllowed
  const terms = termInput === undefined ? undefined : normalizeOfferTerms(termInput)
  const data: Record<string, any> = {}
  for (const key of ["name", "headline", "planLabel", "storageTier", "storagePoolPolicy", "cpuClass", "region"]) {
    if (body[key] !== undefined) data[key] = String(body[key] || "").trim() || null
  }
  if (body.description !== undefined || body.subheadline !== undefined) data.description = String(body.description ?? body.subheadline ?? "").trim() || null
  if (body.slug !== undefined) data.slug = slugifyOffer(body.slug)
  for (const key of ["productId", "storagePoolId", "nodeClassId", "osTemplateId"]) {
    if (body[key] !== undefined) data[key] = body[key] ? String(body[key]) : null
  }
  if (body.defaultOsTemplateId !== undefined) data.osTemplateId = body.defaultOsTemplateId ? String(body.defaultOsTemplateId) : null
  for (const key of ["vcpu", "ramGb", "storageGb", "defaultCpuSockets", "defaultCoresPerSocket", "maxPurchases", "defaultBillingTerm"]) {
    if (body[key] !== undefined) data[key] = body[key] === "" || body[key] === null ? null : numberValue(body[key])
  }
  for (const key of ["bandwidthTb", "baseMonthlyPrice", "offerMonthlyPrice", "gstPercent"]) {
    if (body[key] !== undefined) data[key] = numberValue(body[key])
  }
  if (body.originalMonthlyPrice !== undefined) data.baseMonthlyPrice = numberValue(body.originalMonthlyPrice)
  if (body.gstEnabled !== undefined) data.gstEnabled = Boolean(body.gstEnabled)
  if (body.active !== undefined) {
    const currentMetadata = before.metadata && typeof before.metadata === "object" && !Array.isArray(before.metadata) ? before.metadata as Record<string, unknown> : {}
    const hasPreview = Boolean(body.previewedAt || currentMetadata.previewedAt || before.active)
    data.active = Boolean(body.active && hasPreview)
  }
  if (body.featured !== undefined) data.featured = Boolean(body.featured)
  if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(String(body.startsAt)) : null
  if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(String(body.endsAt)) : null
  if (terms) {
    data.billingTermsAllowed = terms
    if (!terms.includes(Number(data.defaultBillingTerm ?? body.defaultBillingTerm))) data.defaultBillingTerm = terms[0]
  }
  if (body.metadata !== undefined || body.badgeText !== undefined || body.heroCtaText !== undefined || body.includedFeatures !== undefined || body.builtFor !== undefined || body.trustPoints !== undefined || body.allowedOsFamilies !== undefined || body.previewedAt !== undefined) {
    data.metadata = metadataPatch(body, before.metadata)
  }
  return data
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) return apiError("unauthorized", "Unauthorized", 401)
  const { id } = await params
  const before = await prisma.offer.findUnique({ where: { id } })
  if (!before) return apiError("not_found", "Offer not found", 404)
  const body = await request.json().catch(() => ({}))
  const data = updatePayload(body, before)
  try {
    const offer = await prisma.offer.update({ where: { id }, data })
    await writeAuditLog({ action: offer.active !== before.active ? (offer.active ? "offer_enabled" : "offer_disabled") : "offer_updated", actorEmail: String(admin.email), targetType: "offer", targetId: offer.id, oldValue: { active: before.active }, newValue: { active: offer.active, slug: offer.slug } })
    revalidateProductSurfaces()
    return apiSuccess({ offer })
  } catch (error: any) {
    if (error?.code === "P2002") return apiError("slug_exists", "Offer slug already exists.", 409)
    console.error("[ADMIN_OFFERS_PUT]", error)
    return apiError("server_error", "Unable to update offer", 500)
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageCatalog(admin.role)) return apiError("unauthorized", "Unauthorized", 401)
  const { id } = await params
  const offer = await prisma.offer.findUnique({ where: { id }, select: { id: true, slug: true, name: true, orders: { select: { id: true }, take: 1 } } })
  if (!offer) return apiError("not_found", "Offer not found", 404)
  if (offer.orders.length) {
    const disabled = await prisma.offer.update({ where: { id }, data: { active: false } })
    await writeAuditLog({ action: "offer_disabled", actorEmail: String(admin.email), targetType: "offer", targetId: id, metadata: { reason: "delete_requested_with_orders" } })
    revalidateProductSurfaces()
    return apiSuccess({ offer: disabled, disabled: true })
  }
  await prisma.offer.delete({ where: { id } })
  await writeAuditLog({ action: "offer_deleted", actorEmail: String(admin.email), targetType: "offer", targetId: id, oldValue: offer })
  revalidateProductSurfaces()
  return apiSuccess({ success: true })
}
