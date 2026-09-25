import { notFound } from "next/navigation"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { getCategoryBySlug, getSubcategoryBySlug } from "@/lib/catalog"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPublicProducts } from "@/lib/public-products"

function isNotFoundNavigationError(error: unknown) {
  return (
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")
  )
}

export async function CatalogListingPage({
  categorySlug,
  subcategorySlug,
  productFamily,
}: {
  categorySlug: string
  subcategorySlug?: string
  productFamily?: string
}) {
  try {
    const category = await getCategoryBySlug(categorySlug)
    if (!category) {
      notFound()
    }

    const subcategory = subcategorySlug ? await getSubcategoryBySlug(categorySlug, subcategorySlug) : null
    if (subcategorySlug && !subcategory) {
      notFound()
    }

    const [products, site] = await Promise.all([
      getPublicProducts({
        categorySlug: category.slug,
        subcategorySlug: subcategory?.slug,
        type: productFamily,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      getPublicSiteSettings(),
    ])

    const pageTitle = subcategory?.title || category.title
    const pageDescription = subcategory?.description || category.description || `Explore ${pageTitle} products from the ${site.brandName} catalog.`

    return (
      <SiteShell>
        <PageHeader eyebrow={subcategory ? category.title : "Catalog"} title={pageTitle} description={pageDescription} />

        <section className="py-16">
          <Container className="space-y-10">
            {subcategory ? null : category.children.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {category.children.map((child) => (
                  <a
                    key={child.id}
                    href={`/${category.slug}/${child.slug}`}
                    className="glass rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {child.title}
                  </a>
                ))}
              </div>
            ) : null}

            {products.length > 0 ? (
              <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {products.map((product) => (
                  <CatalogProductCard
                    key={product.id}
                    product={{
                      ...product,
                      supportPhone: site.companyPhone,
                      pageUrl: `${site.siteUrl}/dedicated`,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="glass rounded-2xl p-10 text-center text-muted-foreground">No products are published in this section yet.</div>
            )}
          </Container>
        </section>

        <CTASection />
      </SiteShell>
    )
  } catch (error) {
    if (isNotFoundNavigationError(error)) {
      throw error
    }

    console.error(`Catalog listing render failed for ${categorySlug}${subcategorySlug ? `/${subcategorySlug}` : ""}:`, error)

    return (
      <SiteShell>
        <PageHeader
          eyebrow="Catalog"
          title="Catalog temporarily unavailable"
          description="We couldn't load this product section right now. Please try again shortly."
        />

        <section className="py-16">
          <Container>
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
              This section is temporarily unavailable. Our team has been alerted.
            </div>
          </Container>
        </section>

        <CTASection />
      </SiteShell>
    )
  }
}
