import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { FAQAccordion } from "@/components/faq-accordion"
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo"
import { getPublicProducts } from "@/lib/public-products"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Affordable Cloud VPS India | NVMe Plans",
  description:
    "Affordable cloud VPS hosting in India with transparent pricing, NVMe storage, and fast deployment. Compare budget cloud VPS plans for real workloads.",
  keywords: ["cheap VPS Mumbai", "cheap cloud server Mumbai under 1000", "2GB RAM VPS India under 500", "NVMe VPS India", "affordable cloud VPS India"],
  alternates: { canonical: absoluteUrl("/cheap-vps") },
}

const faqs = [
  {
    q: "What makes a cheap VPS a good deal (not a trap)?",
    a: "Look for transparent specs, predictable pricing, and a clear upgrade path. Cheap is only valuable if performance is consistent and support is reachable.",
  },
  {
    q: "Do you have cheap VPS plans for India?",
    a: "Yes. We support Indian customers and can recommend the best plan for low-latency needs based on your workload.",
  },
  {
    q: "Can I start cheap and upgrade later?",
    a: "Yes. Start with an entry plan and upgrade as your CPU, RAM, or storage needs grow.",
  },
  {
    q: "Is NVMe important on a budget VPS?",
    a: "For databases, CI builds, and write-heavy apps, NVMe can noticeably improve responsiveness. For simple workloads, standard SSD can be fine.",
  },
]

export default async function CheapVpsPage() {
  const products = await getPublicProducts({ type: "fixed_vps", orderBy: [{ price1m: "asc" }], take: 9 })

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Cheap VPS", path: "/cheap-vps" },
  ])
  const faqLd = faqJsonLd(faqs)

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Affordable VPS"
        title="Affordable Cloud VPS Platform"
        description="Affordable plans with transparent specs and a clean upgrade path. Deploy in minutes, and scale when metrics demand it."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">Instant VPS Deployment</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start small, keep cost predictable, and upgrade without replatforming.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Clear monthly pricing</span>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">NVMe where it matters</span>
                  <Link href="/status" className="rounded-full bg-foreground/[0.04] px-3 py-1 hover:text-foreground">
                    99.9% uptime
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/vps"
                  className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                >
                  Instant VPS Deployment
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-medium"
                >
                  Get a recommendation
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="space-y-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Plans & pricing</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                These are the lowest-cost publicly listed VPS plans, sorted by monthly price.
              </p>
            </div>
            <Link href="/vps-hosting" className="text-sm text-accent hover:underline">
              See all VPS hosting plans
            </Link>
          </div>

          {products.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={{
                    ...product,
                    ctaLabel: product.ctaLabel || "Deploy now",
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
              Cheap VPS plans are being updated. Please check back shortly.
            </div>
          )}
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-6 lg:grid-cols-3">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Buying checklist</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Cheap VPS is a win when it stays reliable under load. Pick plans with transparent CPU/RAM, fair storage,
              and support you can reach.
            </p>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">NVMe vs SSD</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              NVMe helps database and build-heavy workloads the most. For simple sites, standard SSD can be enough.
            </p>
            <div className="mt-4">
              <Link href="/blog/nvme-vs-ssd-vps-performance" className="text-sm text-accent hover:underline">
                Read the performance guide
              </Link>
            </div>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">India + global workloads</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              If you need low latency for India users or global routing guidance, we can recommend plan sizing and
              placement based on your app.
            </p>
            <div className="mt-4">
              <Link href="/contact" className="text-sm text-accent hover:underline">
                Talk to an engineer
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">FAQs</h2>
            <p className="mt-2 text-sm text-muted-foreground">Straight answers before you buy.</p>
          </div>
          <FAQAccordion items={faqs} />
        </Container>
      </section>

      <CTASection />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </SiteShell>
  )
}
