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
  title: "Cloud Compute Instances India | NVMe KVM Instances",
  description:
    "Cloud compute instances in India with NVMe storage, KVM-based virtualization, and transparent pricing. Deploy production-ready instances in minutes.",
  keywords: [
    "cloud compute instances India",
    "compute instances India",
    "NVMe compute instances India",
    "KVM compute instances India",
    "affordable compute instances Mumbai",
    "hourly billing compute instances India",
  ],
  alternates: { canonical: absoluteUrl("/vps-hosting") },
}

const faqs = [
  {
    q: "How fast is deployment?",
    a: "Most orders deploy in minutes after successful payment. If a plan requires manual review, we will notify you by email.",
  },
  {
    q: "Do you offer compute instances for India customers?",
    a: "Yes. We support Indian customers and provide clear billing with transparent monthly pricing. If you need low-latency routing or region guidance, contact us for recommendations.",
  },
  {
    q: "Is this KVM virtualization?",
    a: "Our plans are designed for production workloads with isolated resources. If you need a specific virtualization requirement, talk to sales and we will confirm the best fit.",
  },
  {
    q: "Can I upgrade later?",
    a: "Yes. You can upgrade as your workload grows. If you need help selecting a plan, our team can recommend specs based on your stack and traffic.",
  },
]

export default async function VpsHostingLandingPage() {
  const products = await getPublicProducts({ type: "fixed_vps", orderBy: [{ price1m: "asc" }], take: 12 })

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Compute Instances", path: "/vps-hosting" },
  ])
  const faqLd = faqJsonLd(faqs)

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Compute Instances"
        title="Cloud Instance Plans"
        description="Instant deployment, NVMe performance, and predictable monthly pricing. Built for developers, startups, and teams shipping real workloads."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">Instant instance deployment</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Deploy cloud servers in minutes, scale without replatforming, and keep billing simple.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">99.9% uptime</span>
                  <Link href="/status" className="rounded-full bg-foreground/[0.04] px-3 py-1 hover:text-foreground">
                    Live status
                  </Link>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Transparent pricing</span>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">NVMe storage</span>
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
          <h2 className="text-2xl font-semibold tracking-tight">Plans & pricing</h2>
          {products.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={{
                    ...product,
                    ctaLabel: product.ctaLabel || "Deploy Now",
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

      <section className="py-12">
        <Container className="grid gap-6 lg:grid-cols-3">
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Performance & specs</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose CPU, RAM, and NVMe storage based on your workload. Start small and upgrade when metrics demand it.
            </p>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <Link href="/blog/nvme-vs-ssd-vps-performance" className="text-accent hover:underline">
                NVMe vs SSD VPS performance
              </Link>
              <Link href="/blog/best-vps-for-startups" className="text-accent hover:underline">
                Best VPS for startups
              </Link>
            </div>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">Use cases</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              SaaS, agencies, internal tools, staging, CI, WordPress, and production APIs with predictable cost.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Startups</span>
              <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Developers</span>
              <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Agencies</span>
              <span className="rounded-full bg-foreground/[0.04] px-3 py-1">SaaS</span>
            </div>
          </div>
          <div className="glass rounded-2xl p-6">
            <h2 className="text-lg font-semibold tracking-tight">VPS vs Cloud</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start with VPS for simplicity and predictable billing. Move to cloud patterns when you need elasticity and
              multi-node architecture.
            </p>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <Link href="/blog/vps-vs-cloud-hosting" className="text-accent hover:underline">
                VPS vs Cloud Hosting
              </Link>
              <Link href="/cloud-vps" className="text-accent hover:underline">
                Explore Cloud VPS
              </Link>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">FAQs</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Quick answers to common buying and deployment questions.
            </p>
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
