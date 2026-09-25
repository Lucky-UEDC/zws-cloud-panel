import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SiteShell } from "@/components/layout/site-shell"
import { Container } from "@/components/layout/container"
import { prisma } from "@/lib/db"
import { calculateFixedProductTermQuote, normalizeBillingTerm } from "@/lib/billing-pricing"
import { getBillingPricingSettings } from "@/lib/settings"
import { dedicatedSettingsFromProduct, getDedicatedOsOptions } from "@/lib/dedicated"
import { DedicatedCheckoutContent } from "./DedicatedCheckoutContent"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPublicProductsWhere } from "@/lib/public-products"

export const dynamic = "force-dynamic"

type SearchParams = { product?: string; term?: string }

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Dedicated Server Checkout",
    description: `Book a dedicated bare metal server with manual provisioning by ${site.brandName} engineers.`,
    path: "/dedicated/checkout",
    robots: "noindex, nofollow",
  })
}

export default async function DedicatedCheckoutPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const site = await getPublicSiteSettings()
  const productRef = params.product || ""
  const term = normalizeBillingTerm(params.term || 1)
  const product = await prisma.product.findFirst({
    where: {
      ...getPublicProductsWhere(),
      OR: [{ id: productRef }, { slug: productRef }],
      type: "dedicated",
    },
  })
  if (!product) notFound()
  const [billingSettings, osOptions] = await Promise.all([
    getBillingPricingSettings(),
    getDedicatedOsOptions(product),
  ])
  const dedicatedSettings = dedicatedSettingsFromProduct(product)
  const quote = calculateFixedProductTermQuote({ product, term: term as any, settings: billingSettings })
  const subtotal = Number((quote.selectedMonthlyPrice * term + dedicatedSettings.setupFee).toFixed(2))
  const taxAmount = Number((subtotal * 0.18).toFixed(2))

  return (
    <SiteShell>
      <Container className="py-8 sm:py-10">
        <DedicatedCheckoutContent
          brandName={site.brandName}
          bootstrap={{
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
              billingTerms: Array.isArray(product.billingTerms) ? product.billingTerms.map(Number) : [1, 3, 6, 12, 24, 36],
              features: Array.isArray(product.features) ? product.features.map(String) : [],
              specs: product.specs && typeof product.specs === "object" && !Array.isArray(product.specs) ? product.specs as Record<string, unknown> : {},
              dedicatedSettings,
            },
            osOptions: osOptions.map((option) => ({
              id: option.id,
              family: option.family,
              familyLabel: option.familyLabel,
              name: option.name,
              version: option.version,
              slug: option.slug,
              iconUrl: option.iconUrl,
              description: option.description,
              isRecommended: option.isRecommended,
            })),
            term,
            quote: {
              monthly: quote.selectedMonthlyPrice,
              subtotal,
              taxAmount,
              total: Number((subtotal + taxAmount).toFixed(2)),
              setupFee: dedicatedSettings.setupFee,
            },
          }}
        />
      </Container>
    </SiteShell>
  )
}
