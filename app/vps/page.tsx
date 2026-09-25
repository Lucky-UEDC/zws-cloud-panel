import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { CTASection } from "@/components/cta-section"
import { getPublicProducts } from "@/lib/public-products"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function VPSPage() {
  const products = await getPublicProducts({ type: "fixed_vps", orderBy: [{ price1m: "asc" }] })

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Cloud Instances"
        title="Cloud Instance Plans"
        description="Choose from production-ready Cloud Instances with predictable monthly pricing, NVMe storage, DDoS protection, and a clear upgrade path."
      />

      <section className="py-16">
        <Container className="space-y-10">
          {products.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={{
                    ...product,
                    ctaLabel: product.ctaLabel || "Purchase Now",
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
              Cloud Instance plans are being updated. Please check back shortly.
            </div>
          )}
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}
