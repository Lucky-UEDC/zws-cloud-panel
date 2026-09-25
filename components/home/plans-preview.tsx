import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { Button } from "@/components/ui/button"
import { getPublicProducts } from "@/lib/public-products"
import { getUserCountry } from "@/lib/regional-pricing"
import { headers } from "next/headers"

export async function PlansPreview() {
  const requestHeaders = await headers()
  const countryCode = await getUserCountry({ headers: requestHeaders })
  const products = await getPublicProducts({ type: "fixed_vps", take: 4, countryCode })

  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <SectionHeader
            eyebrow="Compute instance plans"
            title="Predictable performance, transparent prices"
            description="Production-ready compute instance tiers with full root access, NVMe storage, KVM virtualization, and a clear upgrade path. Prices are localized by visitor region."
          />
          <Button asChild variant="ghost" className="gap-1.5">
            <Link href="/pricing">
              Compare all plans
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => <CatalogProductCard key={product.id} product={product} />)}
        </div>
      </Container>
    </section>
  )
}
