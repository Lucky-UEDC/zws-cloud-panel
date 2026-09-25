import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { scheduleProductSurfaceRevalidation } from "@/lib/product-revalidation"
import { canManageCatalog } from "@/lib/admin-rbac"
import { requireSameOriginOrCsrf } from "@/lib/auth/guards"
import { requireSensitiveAdminMfa } from "@/lib/admin-sensitive-action"
import { PRODUCT_SAVE_TRANSACTION_OPTIONS } from "@/lib/admin-product-save"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSensitiveAdminMfa(request)
  if (!auth.ok) return auth.response
  const origin = await requireSameOriginOrCsrf(request)
  if (!origin.ok) return origin.response
  const admin = { email: auth.session.email, role: auth.session.role }
  if (!admin.email || !canManageCatalog(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 })

  const duplicateSlug = `${product.slug}-copy-${Math.random().toString(36).slice(2, 6)}`
  try {
    const duplicate = await prisma.$transaction(async (tx) => tx.product.create({
      data: {
        slug: duplicateSlug,
        name: `${product.name} Copy`,
        description: product.description,
        shortDescription: product.shortDescription,
        category: product.category,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
        type: product.type,
        ctaMode: product.ctaMode,
        ctaLabel: product.ctaLabel,
        badges: product.badges as Prisma.InputJsonValue,
        seoTitle: product.seoTitle,
        seoDescription: product.seoDescription,
        seoKeywords: product.seoKeywords as Prisma.InputJsonValue,
        whatsappEnabled: product.whatsappEnabled,
        visibility: product.visibility,
        status: "draft",
        cpuCores: product.cpuCores,
        ramGb: product.ramGb,
        storageGb: product.storageGb,
        storageType: product.storageType,
        bandwidthTb: product.bandwidthTb,
        backupEnabled: product.backupEnabled,
        backupPrice: product.backupPrice,
        backupStorageGb: product.backupStorageGb,
        snapshotEnabled: product.snapshotEnabled,
        snapshotPrice: product.snapshotPrice,
        snapshotIncludedCount: product.snapshotIncludedCount,
        bandwidthEnabled: product.bandwidthEnabled,
        bandwidthPrice: product.bandwidthPrice,
        bandwidthLimitTb: product.bandwidthLimitTb,
        bandwidthOveragePrice: product.bandwidthOveragePrice,
        extraIpv4Price: product.extraIpv4Price,
        price1m: product.price1m,
        price3m: product.price3m,
        price6m: product.price6m,
        price12m: product.price12m,
        price24m: product.price24m,
        price36m: product.price36m,
        priceHourly: product.priceHourly,
        isActive: false,
        isFeatured: false,
        sortOrder: product.sortOrder,
        billingTerms: product.billingTerms as Prisma.InputJsonValue,
        regions: product.regions as Prisma.InputJsonValue,
        specs: product.specs as Prisma.InputJsonValue,
        optionGroups: product.optionGroups as Prisma.InputJsonValue,
        serviceAttributes: product.serviceAttributes as Prisma.InputJsonValue,
        features: product.features as Prisma.InputJsonValue,
        disks: product.disks as Prisma.InputJsonValue,
        metadata: product.metadata as Prisma.InputJsonValue,
      },
    }), PRODUCT_SAVE_TRANSACTION_OPTIONS)

    scheduleProductSurfaceRevalidation()

    return NextResponse.json({ success: true, product: duplicate }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || "Failed to duplicate product" }, { status: 500 })
  }
}
