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
  title: "Cloud VPS India | Scalable NVMe Cloud Servers",
  description:
    "Scalable cloud VPS hosting in India with NVMe performance, KVM-based virtualization, and transparent pricing for production workloads.",
  keywords: ["cloud VPS India", "cloud server India", "cloud server Bangalore", "NVMe VPS India", "virtual cloud server India"],
  alternates: { canonical: absoluteUrl("/cloud-vps") },
}

const faqs = [
  {
    q: "What is Cloud VPS hosting?",
    a: "Cloud VPS typically refers to virtual servers designed for flexible scaling and cloud-style infrastructure patterns. It is a good fit when you want room to grow beyond a single-server setup.",
  },
  {
    q: "Is cloud hosting better than VPS hosting?",
    a: "Not always. VPS is often simpler and more predictable. Cloud patterns are great when you need scaling, separation of services, or higher availability designs.",
  },
  {
    q: "Can I start with VPS and move to cloud later?",
    a: "Yes. Many teams start with a single VPS and adopt cloud architecture as their product grows.",
  },
  {
    q: "Do you help with sizing and architecture?",
    a: "Yes. Talk to an engineer and we will recommend a plan based on your workload, traffic, and scaling goals.",
  },
]

export default async function CloudVpsPage() {
  const products = await getPublicProducts({ type: "fixed_vps", orderBy: [{ price1m: "asc" }], take: 12 })

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Cloud VPS", path: "/cloud-vps" },
  ])
  const faqLd = faqJsonLd(faqs)

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Cloud hosting"
        title="Cloud VPS Platform"
        description="Flexible building blocks for teams scaling beyond a single node. Launch fast now, keep headroom for later."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">Instant deployment</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Deploy quickly, scale cleanly, and keep pricing transparent.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Clear pricing</span>
                  <Link href="/status" className="rounded-full bg-foreground/[0.04] px-3 py-1 hover:text-foreground">
                    99.9% uptime
                  </Link>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Upgrade paths</span>
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
              <p className="mt-2 text-sm text-muted-foreground">
                Choose cloud VPS plans built for real workloads and clear upgrades.
              </p>
            </div>
            <Link href="/blog/vps-vs-cloud-hosting" className="text-sm text-accent hover:underline">
              VPS vs Cloud hosting guide
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
              Cloud VPS plans are being updated. Please check back shortly.
            </div>
          )}
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-6 lg:grid-cols-3">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Scale paths</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Cloud patterns shine when you need to separate services, scale independently, or plan for higher availability.
            </p>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Use cases</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              SaaS services, multi-service apps, workloads that need headroom for growth, and teams that want cleaner separation.
            </p>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Need help sizing?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Tell us your stack and traffic. We will recommend a plan and migration path.
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
            <p className="mt-2 text-sm text-muted-foreground">Quick answers before you commit to a direction.</p>
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
