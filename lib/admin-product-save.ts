import { prisma } from "@/lib/db"
import { defaultCtaLabel, normalizeBadges, normalizeCtaMode, normalizeProductFamily } from "@/lib/catalog-product"
import { cleanProductAssignments, validateProductIpPoolAssignments } from "@/lib/ipam-admin"

type ProductSaveMode = "create" | "update"

type ProductSaveInput = {
  body: any
  adminEmail: string
  mode: ProductSaveMode
  existing?: Record<string, any> | null
}

export const PRODUCT_SAVE_TRANSACTION_OPTIONS = {
  maxWait: 3000,
  timeout: 10_000,
} as const

export type PreparedProductSave = {
  data: any
  slug?: string
  ipAssignments?: ReturnType<typeof cleanProductAssignments>
  debugSummary: Record<string, unknown>
}

export class ProductSaveError extends Error {
  status: number
  code: string
  fieldErrors?: Record<string, string>

  constructor(code: string, message: string, status = 400, fieldErrors?: Record<string, string>) {
    super(message)
    this.name = "ProductSaveError"
    this.code = code
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

export function productDebugId() {
  return `product_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function productErrorPayload(error: unknown, debugId: string) {
  if (error instanceof ProductSaveError) {
    return {
      status: error.status,
      body: {
        success: false,
        code: error.code,
        error: error.message,
        message: error.message,
        fieldErrors: error.fieldErrors,
        debugId,
      },
    }
  }
  const message = error instanceof Error ? error.message : "Failed to save product"
  return {
    status: 500,
    body: {
      success: false,
      code: "product_save_failed",
      error: message,
      message,
      debugId,
    },
  }
}

export function summarizeProductPayload(body: any) {
  return {
    id: body?.id ? String(body.id) : undefined,
    slug: body?.slug ? String(body.slug) : undefined,
    name: body?.name ? String(body.name) : undefined,
    type: body?.type ? String(body.type) : undefined,
    status: body?.status ? String(body.status) : undefined,
    categoryId: body?.categoryId ? String(body.categoryId) : undefined,
    subcategoryId: body?.subcategoryId ? String(body.subcategoryId) : undefined,
    price1m: body?.price1m,
    price3m: body?.price3m,
    price6m: body?.price6m,
    price12m: body?.price12m,
    price24m: body?.price24m,
    price36m: body?.price36m,
    cpuCores: body?.cpuCores,
    ramGb: body?.ramGb,
    storageGb: body?.storageGb,
    storageType: body?.storageType,
    storagePolicyType: body?.storagePolicyType,
    requiredStorageType: body?.requiredStorageType,
    requiredStoragePoolId: body?.requiredStoragePoolId,
    defaultNodeId: body?.defaultNodeId ? String(body.defaultNodeId) : undefined,
    backupEnabled: body?.backupEnabled,
    backupPrice: body?.backupPrice,
    backupStorageGb: body?.backupStorageGb,
    snapshotEnabled: body?.snapshotEnabled,
    snapshotPrice: body?.snapshotPrice,
    snapshotIncludedCount: body?.snapshotIncludedCount,
    bandwidthEnabled: body?.bandwidthEnabled,
    bandwidthPrice: body?.bandwidthPrice,
    bandwidthLimitTb: body?.bandwidthLimitTb,
    bandwidthOveragePrice: body?.bandwidthOveragePrice,
    extraIpv4Price: body?.extraIpv4Price,
    ipAssignments: Array.isArray(body?.ipAssignments) ? body.ipAssignments.length : undefined,
  }
}

function coerceJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function slugify(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export async function uniqueProductSlug(input: { requested?: unknown; name: unknown }) {
  const base = slugify(input.requested) || slugify(input.name)
  if (!base) throw new ProductSaveError("validation_failed", "Product name is required", 400, { name: "Product name is required" })
  let slug = base
  for (let i = 2; i < 1000; i += 1) {
    const existing = await prisma.product.findUnique({ where: { slug }, select: { id: true } })
    if (!existing) return slug
    slug = `${base}-${i}`
  }
  throw new ProductSaveError("slug_unavailable", "Unable to generate a unique product slug", 409, { slug: "Unable to generate a unique product slug" })
}

function finiteNumber(value: unknown, field: string, fieldErrors: Record<string, string>, options: { required?: boolean; min?: number } = {}) {
  if ((value === "" || value == null) && !options.required) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || (options.min != null && parsed < options.min)) {
    fieldErrors[field] = options.min != null ? `${field} must be at least ${options.min}` : `${field} must be a valid number`
    return null
  }
  return parsed
}

function positiveInt(value: unknown, field: string, fieldErrors: Record<string, string>, fallback: number) {
  const parsed = finiteNumber(value ?? fallback, field, fieldErrors, { required: true, min: 1 })
  if (parsed == null) return fallback
  if (!Number.isInteger(parsed)) {
    fieldErrors[field] = `${field} must be a whole number`
    return fallback
  }
  return parsed
}

function nonNegativeInt(value: unknown, field: string, fieldErrors: Record<string, string>, fallback = 0) {
  const parsed = finiteNumber(value ?? fallback, field, fieldErrors, { required: true, min: 0 })
  if (parsed == null) return fallback
  if (!Number.isInteger(parsed)) {
    fieldErrors[field] = `${field} must be a whole number`
    return fallback
  }
  return parsed
}

function nullablePrice(value: unknown, field: string, fieldErrors: Record<string, string>) {
  return finiteNumber(value, field, fieldErrors, { min: 0 })
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
}

function jsonArray(value: unknown, fallback: unknown[] = []) {
  return Array.isArray(value) ? value : fallback
}

function allowedValue(value: unknown, allowed: string[], fallback: string) {
  const normalized = String(value || "").trim()
  return allowed.includes(normalized) ? normalized : fallback
}

export async function prepareProductSave(input: ProductSaveInput): Promise<PreparedProductSave> {
  const { body, adminEmail, mode, existing } = input
  const fieldErrors: Record<string, string> = {}
  const family = normalizeProductFamily(body.type)
  const ctaMode = normalizeCtaMode(body.ctaMode, family)
  const name = String(body.name || "").trim()
  if (!name) fieldErrors.name = "Product name is required"
  if (!body.categoryId) fieldErrors.categoryId = "Category is required"

  const category = body.categoryId ? await prisma.catalogCategory.findUnique({ where: { id: String(body.categoryId) } }) : null
  if (body.categoryId && !category) fieldErrors.categoryId = "Invalid category"
  if (category) {
    if (family === "fixed_vps" && category.slug !== "vps") fieldErrors.categoryId = "Fixed VPS plans must be assigned to VPS category"
    if (family === "dedicated" && category.slug !== "dedicated") fieldErrors.categoryId = "Dedicated products must be assigned to Dedicated category"
    if (family === "configurable" && category.slug !== "vps") fieldErrors.categoryId = "Configurable products must be assigned to VPS category"
    if (!["vps", "dedicated"].includes(String(body.category || category.slug))) fieldErrors.category = "Product category must be either vps or dedicated"
  }

  if (body.subcategoryId) {
    const subcategory = await prisma.catalogCategory.findUnique({ where: { id: String(body.subcategoryId) }, select: { id: true } })
    if (!subcategory) fieldErrors.subcategoryId = "Invalid subcategory"
  }

  if (body.requiredStoragePoolId) {
    const pool = await prisma.nodeStoragePoolConfig.findUnique({ where: { id: String(body.requiredStoragePoolId) }, select: { id: true } })
    if (!pool) fieldErrors.requiredStoragePoolId = "Selected storage pool is invalid"
  }

  if (body.defaultNodeId) {
    const node = await prisma.proxmoxNode.findFirst({ where: { id: String(body.defaultNodeId), isActive: true }, select: { id: true } })
    if (!node) fieldErrors.defaultNodeId = "Selected default provision node is invalid"
  }

  const slug = mode === "create" ? await uniqueProductSlug({ requested: body.slug, name }) : slugify(body.slug)
  if (mode === "update" && !slug) fieldErrors.slug = "Slug is required"

  const cpuCores = positiveInt(body.cpuCores, "cpuCores", fieldErrors, 1)
  const ramGb = positiveInt(body.ramGb, "ramGb", fieldErrors, 1)
  const storageGb = positiveInt(body.storageGb, "storageGb", fieldErrors, 20)
  const bandwidthTb = finiteNumber(body.bandwidthTb ?? 1, "bandwidthTb", fieldErrors, { required: true, min: 0.01 }) ?? 1
  const price1m = finiteNumber(body.price1m, "price1m", fieldErrors, { required: true, min: 0.01 }) ?? 0
  const price3m = nullablePrice(body.price3m, "price3m", fieldErrors)
  const price6m = nullablePrice(body.price6m, "price6m", fieldErrors)
  const price12m = nullablePrice(body.price12m, "price12m", fieldErrors)
  const price24m = nullablePrice(body.price24m, "price24m", fieldErrors)
  const price36m = nullablePrice(body.price36m, "price36m", fieldErrors)
  const priceHourly = nullablePrice(body.priceHourly, "priceHourly", fieldErrors)
  const backupPrice = finiteNumber(body.backupPrice ?? 0, "backupPrice", fieldErrors, { required: true, min: 0 }) ?? 0
  const backupStorageGb = nonNegativeInt(body.backupStorageGb ?? 0, "backupStorageGb", fieldErrors, 0)
  const snapshotPrice = finiteNumber(body.snapshotPrice ?? 0, "snapshotPrice", fieldErrors, { required: true, min: 0 }) ?? 0
  const snapshotIncludedCount = nonNegativeInt(body.snapshotIncludedCount ?? 0, "snapshotIncludedCount", fieldErrors, 0)
  const bandwidthPrice = finiteNumber(body.bandwidthPrice ?? 0, "bandwidthPrice", fieldErrors, { required: true, min: 0 }) ?? 0
  const bandwidthLimitTb = nullablePrice(body.bandwidthLimitTb, "bandwidthLimitTb", fieldErrors)
  const bandwidthOveragePrice = finiteNumber(body.bandwidthOveragePrice ?? 0, "bandwidthOveragePrice", fieldErrors, { required: true, min: 0 }) ?? 0
  const extraIpv4Price = finiteNumber(body.extraIpv4Price ?? 0, "extraIpv4Price", fieldErrors, { required: true, min: 0 }) ?? 0

  const optionGroups = jsonArray(body.optionGroups, [])
  const serviceAttributes = coerceJsonObject(body.serviceAttributes)
  const specs = coerceJsonObject(body.specs)
  const regions = jsonArray(body.regions, [])
  const features = stringArray(body.features)
  const billingTerms = Array.isArray(body.billingTerms) && body.billingTerms.length ? body.billingTerms.map(Number).filter(Number.isFinite) : [1, 3, 6, 12, 24, 36]
  if (!billingTerms.length) fieldErrors.billingTerms = "At least one billing term is required"

  let ipAssignments: ReturnType<typeof cleanProductAssignments> | undefined
  if (Object.prototype.hasOwnProperty.call(body, "ipAssignments")) {
    ipAssignments = await validateProductIpPoolAssignments(body.ipAssignments)
  }

  if (Object.keys(fieldErrors).length) {
    throw new ProductSaveError("validation_failed", "Product validation failed", 400, fieldErrors)
  }

  const statusInput = String(body.status || existing?.status || "active").toLowerCase()
  const status = allowedValue(statusInput, ["active", "draft"], "active")
  const isActive = status === "active" ? true : false
  const visibility = allowedValue(body.visibility, ["public", "hidden", "private"], existing?.visibility || "public")
  const existingMetadata = coerceJsonObject(existing?.metadata)
  const incomingMetadata = coerceJsonObject(body.metadata)
  const now = new Date().toISOString()
  const apiId = String((incomingMetadata as any).apiId || (existingMetadata as any).apiId || `prod_${slug.replace(/-/g, "_")}`)
  const metadata = {
    ...existingMetadata,
    ...incomingMetadata,
    apiId,
    manualEditedAt: now,
    manualEditedBy: adminEmail,
  }

  const data = {
    slug,
    name,
    description: body.description || null,
    shortDescription: body.shortDescription || null,
    category: String(category!.slug),
    categoryId: String(body.categoryId),
    subcategoryId: body.subcategoryId || null,
    type: family,
    ctaMode,
    ctaLabel: String(body.ctaLabel || defaultCtaLabel(family, name)),
    badges: normalizeBadges(body.badges),
    seoTitle: body.seoTitle ? String(body.seoTitle) : null,
    seoDescription: body.seoDescription ? String(body.seoDescription) : null,
    seoKeywords: normalizeBadges(body.seoKeywords),
    whatsappEnabled: Boolean(body.whatsappEnabled),
    deletedAt: null,
    visibility,
    status,
    cpuCores,
    ramGb,
    storageGb,
    storageType: String(body.storageType || "nvme").toLowerCase(),
    storagePolicyType: String(body.storagePolicyType || "NODE_DEFAULT"),
    requiredStorageType: body.requiredStorageType ? String(body.requiredStorageType) : null,
    requiredStoragePoolId: body.requiredStoragePoolId ? String(body.requiredStoragePoolId) : null,
    defaultNodeId: body.defaultNodeId ? String(body.defaultNodeId) : null,
    defaultStoragePoolId: body.defaultStoragePoolId || body.requiredStoragePoolId ? String(body.defaultStoragePoolId || body.requiredStoragePoolId) : null,
    allowStorageFallback: body.allowStorageFallback !== false,
    premiumIpEnabled: Boolean(body.premiumIpEnabled),
    backupEnabled: Boolean(body.backupEnabled),
    backupPrice,
    backupStorageGb,
    snapshotEnabled: Boolean(body.snapshotEnabled),
    snapshotPrice,
    snapshotIncludedCount,
    bandwidthEnabled: body.bandwidthEnabled !== false,
    bandwidthPrice,
    bandwidthLimitTb,
    bandwidthOveragePrice,
    extraIpv4Price,
    bandwidthTb,
    price1m,
    price3m,
    price6m,
    price12m,
    price24m,
    price36m,
    priceHourly,
    isActive,
    isFeatured: Boolean(body.isFeatured),
    sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : Number(existing?.sortOrder || 0),
    billingTerms,
    regions,
    specs,
    optionGroups,
    serviceAttributes,
    features,
    disks: Array.isArray(body.disks) ? body.disks : [{ type: body.storageType || "nvme", sizeGb: storageGb }],
    metadata,
  }

  return {
    data,
    slug,
    ipAssignments,
    debugSummary: {
      slug,
      name,
      family,
      status,
      visibility,
      price1m,
      monthlyOverrides: { price3m, price6m, price12m, price24m, price36m },
      storagePolicyType: data.storagePolicyType,
      requiredStoragePoolId: data.requiredStoragePoolId,
      defaultNodeId: data.defaultNodeId,
      addOnPricing: {
        backupEnabled: data.backupEnabled,
        backupPrice,
        backupStorageGb,
        snapshotEnabled: data.snapshotEnabled,
        snapshotPrice,
        snapshotIncludedCount,
        bandwidthEnabled: data.bandwidthEnabled,
        bandwidthPrice,
        bandwidthLimitTb,
        bandwidthOveragePrice,
        extraIpv4Price,
      },
      ipAssignments: ipAssignments?.length,
    },
  }
}
