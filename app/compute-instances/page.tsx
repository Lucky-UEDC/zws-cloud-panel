import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { FAQAccordion } from "@/components/faq-accordion"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { breadcrumbJsonLd, faqJsonLd } from "@/lib/seo"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { getPublicProducts } from "@/lib/public-products"

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Cloud Compute Instances India",
    description: "High-performance NVMe-powered cloud compute instances with instant deployment and predictable pricing.",
    path: "/compute-instances",
  })
}

export const dynamic = "force-dynamic"
export const revalidate = 0

const faqs = [
  {
    q: "What is a compute instance?",
    a: "A compute instance is a virtual server with dedicated resources (vCPU, RAM, and storage) that you can launch in minutes for apps, databases, dev/test, and production workloads.",
  },
  {
    q: "How fast is deployment?",
    a: "Most orders deploy in minutes after successful payment. If a plan requires manual review, we will notify you by email.",
  },
  {
    q: "Can I upgrade later?",
    a: "Yes. You can scale up CPU, RAM, and storage as your workload grows, subject to capacity in your region.",
  },
  {
    q: "What should I prioritize: CPU, RAM, or NVMe?",
    a: "For many workloads, RAM and storage I/O are the first constraints. CPU matters most for concurrent builds, multi-service stacks, and high request volume.",
  },
]

export default async function ComputeInstancesPage() {
  const [products, site] = await Promise.all([
    getPublicProducts({ type: "fixed_vps", take: 9, orderBy: [{ price1m: "asc" }] }),
    getPublicSiteSettings(),
  ])

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: `${site.brandName} Compute Instances`, path: "/compute-instances" },
  ])
  const faqLd = faqJsonLd(faqs)

  return (
    <SiteShell>
      <PageHeader
        eyebrow={site.brandName}
        title={`${site.brandName} Compute Instances`}
        description="High-performance NVMe-powered compute instances with instant deployment and predictable pricing."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">Deploy fast, iterate safely</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Launch compute instances for apps, databases, dev/test environments, and production workloads. Build now, scale later.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">NVMe storage</span>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Predictable pricing</span>
                  <Link href="/technical-specifications" className="rounded-full bg-foreground/[0.04] px-3 py-1 hover:text-foreground">
                    Technical specifications
                  </Link>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/vps"
                  className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                >
                  Launch Instance
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-medium"
                >
                  Talk to an engineer
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
              <p className="mt-2 text-sm text-muted-foreground">Start with a plan that fits today, then scale up as you grow.</p>
            </div>
            <Link href="/pricing" className="text-sm text-accent hover:underline">
              See pricing
            </Link>
          </div>

          {products.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={{
                    ...product,
                    ctaLabel: product.ctaLabel || "Launch now",
                    supportPhone: site.companyPhone,
                    pageUrl: `${site.siteUrl}/compute-instances`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">
              Plans are being updated. Please check back shortly.
            </div>
          )}
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">FAQs</h2>
            <p className="mt-2 text-sm text-muted-foreground">Quick answers for common deployment and sizing questions.</p>
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
