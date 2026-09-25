import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { calculateFixedProductTermQuote, normalizeBillingTerm } from "@/lib/billing-pricing"
import { dedicatedSettingsFromProduct, getDedicatedOsOptions } from "@/lib/dedicated"
import { getBillingPricingSettings } from "@/lib/settings"
import { getPublicProductsWhere } from "@/lib/public-products"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const productRef = searchParams.get("product") || ""
  const term = normalizeBillingTerm(searchParams.get("term") || 1)
  const product = await prisma.product.findFirst({
    where: {
      ...getPublicProductsWhere(),
      OR: [{ id: productRef }, { slug: productRef }],
      type: "dedicated",
    },
  })
  if (!product) return NextResponse.json({ success: false, error: "Dedicated product not found" }, { status: 404, headers: NO_STORE_HEADERS })
  const [billingSettings, osOptions] = await Promise.all([
    getBillingPricingSettings(),
    getDedicatedOsOptions(product),
  ])
  const settings = dedicatedSettingsFromProduct(product)
  const quote = calculateFixedProductTermQuote({ product, term: term as any, settings: billingSettings })
  const subtotal = Number((quote.selectedMonthlyPrice * term + settings.setupFee).toFixed(2))
  const taxAmount = Number((subtotal * 0.18).toFixed(2))
  return NextResponse.json({
    success: true,
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      shortDescription: product.shortDescription,
      cpuCores: product.cpuCores,
      ramGb: product.ramGb,
      storageGb: product.storageGb,
      storageType: product.storageType,
      bandwidthTb: Number(product.bandwidthTb),
      price1m: Number(product.price1m),
      billingTerms: Array.isArray(product.billingTerms) ? product.billingTerms : [1, 3, 6, 12, 24, 36],
      features: Array.isArray(product.features) ? product.features : [],
      specs: product.specs || {},
      dedicatedSettings: settings,
    },
    osOptions,
    term,
    quote: {
      monthly: quote.selectedMonthlyPrice,
      subtotal,
      taxAmount,
      total: Number((subtotal + taxAmount).toFixed(2)),
      setupFee: settings.setupFee,
    },
  }, { headers: NO_STORE_HEADERS })
}
