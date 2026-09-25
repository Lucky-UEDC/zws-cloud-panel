import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { prisma } from "@/lib/db"
import { absoluteUrl } from "@/lib/seo"
import { getCloudInstanceName } from "@/lib/cloud-instance-names"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicProductsWhere, serializePublicProduct } from "@/lib/public-products"
import { getRegionalPrice, getUserCountry } from "@/lib/regional-pricing"
import { headers } from "next/headers"

export async function generateMetadata() {
  return buildPageMetadata({
    title: "Cloud VPS Pricing | NVMe Cloud Instances",
    description: "Compare affordable Cloud Instance plans with included bandwidth, NVMe storage, scalable vCPU/RAM, and transparent monthly pricing.",
    path: "/pricing",
  })
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function PricingPage() {
  const requestHeaders = await headers()
  const countryCode = await getUserCountry({ headers: requestHeaders })
  const categories = await prisma.catalogCategory.findMany({
    where: {
      isActive: true,
      parentId: null,
      visibility: "public",
      products: {
        some: {
          ...getPublicProductsWhere(),
          type: "fixed_vps",
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: {
      products: {
        where: {
          ...getPublicProductsWhere(),
          type: "fixed_vps",
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
  })
  const regionalCategories = await Promise.all(categories.map(async (category) => ({
    ...category,
    products: await Promise.all(category.products.map(async (product) => {
      const serialized = serializePublicProduct(product)
      const regionalMonthly = await getRegionalPrice({
        amountInr: serialized.pricing.monthly,
        countryCode,
        term: serialized.pricing.term,
        product: serialized.slug || serialized.id,
        context: { productId: serialized.id, source: "pricing_page_monthly" },
      }).catch(() => null)
      return {
        ...serialized,
        regional: regionalMonthly,
        pricing: {
          ...serialized.pricing,
          regionalMonthly,
        },
      }
    })),
  })))

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Pricing"
        title="Cloud Instance pricing"
        description="Compare production-ready Cloud Instances with included bandwidth, NVMe storage, scalable vCPU/RAM, and transparent monthly pricing."
      />

      <section className="py-16">
        <Container className="space-y-12">
          {regionalCategories.length > 0 ? (
            regionalCategories.map((category) => (
              <div key={category.id} className="space-y-6">
                <div>
                  <h2 className="text-2xl font-semibold">{category.title}</h2>
                  {category.description ? (
                    <p className="mt-1 text-muted-foreground">{category.description}</p>
                  ) : null}
                </div>

                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {category.products.map((product) => (
                    <CatalogProductCard
                      key={product.id}
                      product={product}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
              No fixed products are published yet.
            </div>
          )}
        </Container>
      </section>

      <CTASection />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: regionalCategories.flatMap((category, categoryIndex) =>
              category.products.map((product, productIndex) => ({
                "@type": "ListItem",
                position: categoryIndex * 100 + productIndex + 1,
                item: {
                  "@type": "Product",
                  name: getCloudInstanceName(product),
                  description: product.shortDescription || product.description || "Cloud Instance plan",
                  offers: {
                    "@type": "Offer",
                    priceCurrency: product.regional?.displayCurrency || "INR",
                    price: Number(product.regional?.displayAmount || product.price1m),
                    availability: "https://schema.org/InStock",
                    url: absoluteUrl(`/checkout?product=${product.slug || product.id}`),
                  },
                },
              })),
            ),
          }),
        }}
      />
    </SiteShell>
  )
}
