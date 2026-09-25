import type { Metadata } from "next"
import Link from "next/link"
import { MessageCircle, ShieldCheck, Cpu, HardDrive, Gauge, ArrowRight } from "lucide-react"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CatalogProductCard } from "@/components/catalog/catalog-product-card"
import { getCustomConfigurationSettings } from "@/lib/settings"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { buildDedicatedWhatsappUrl } from "@/lib/dedicated"
import { getPublicProducts } from "@/lib/public-products"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Dedicated Servers India",
    description: `Deploy high-performance dedicated bare metal servers on ${site.brandName} with enterprise hardware, predictable pricing, and priority support.`,
    path: "/dedicated",
  })
}

export default async function DedicatedPage() {
  const [customSettings, brand] = await Promise.all([getCustomConfigurationSettings(), getPublicSiteSettings()])
  const products = await getPublicProducts({ type: "dedicated", orderBy: [{ sortOrder: "asc" }, { price1m: "asc" }] })

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Dedicated / Bare Metal"
        title={`Dedicated Servers India | ${brand.brandName}`}
        description="Run latency-sensitive databases, enterprise apps, and high-traffic services on isolated bare metal infrastructure with transparent monthly pricing."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold">Enterprise Hardware</h2>
              <p className="mt-2 text-sm text-muted-foreground">Modern CPU platforms, high RAM density, and stable storage performance for production systems.</p>
            </div>
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold">Predictable Commercials</h2>
              <p className="mt-2 text-sm text-muted-foreground">Clear monthly pricing with no hidden overages for standard dedicated server deployments.</p>
            </div>
            <div className="glass rounded-xl p-4">
              <h2 className="text-sm font-semibold">Human Support</h2>
              <p className="mt-2 text-sm text-muted-foreground">Direct support coordination for provisioning, migration planning, and scaling assistance.</p>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-8 sm:py-12">
        <Container className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Dedicated Server Plans</h2>
            <p className="mt-2 text-muted-foreground">Choose a server and continue with secure purchase flow or get instant sales help on WhatsApp.</p>
          </div>
          {products.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <CatalogProductCard
                  key={product.id}
                  product={{
                    ...product,
                    supportPhone: brand.companyPhone,
                    pageUrl: `${brand.siteUrl.replace(/\/$/, "")}/dedicated`,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="glass rounded-2xl p-10 text-center text-muted-foreground">Dedicated plans will be published here shortly.</div>
          )}
        </Container>
      </section>

      <section className="py-8 sm:py-12">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <h2 className="text-2xl font-semibold tracking-tight">Use Cases and Why Teams Choose ZWS Dedicated Hosting</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <Cpu className="h-4 w-4 text-accent" />
                <h3 className="mt-2 text-sm font-semibold">Raw Compute Isolation</h3>
                <p className="mt-1 text-sm text-muted-foreground">No noisy neighbors. Dedicated CPU and memory allocation for consistent performance.</p>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <HardDrive className="h-4 w-4 text-accent" />
                <h3 className="mt-2 text-sm font-semibold">Storage Stability</h3>
                <p className="mt-1 text-sm text-muted-foreground">Balanced storage profiles for databases, analytics, and high-throughput workloads.</p>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <Gauge className="h-4 w-4 text-accent" />
                <h3 className="mt-2 text-sm font-semibold">Network Throughput</h3>
                <p className="mt-1 text-sm text-muted-foreground">High-capacity uplinks for SaaS, media delivery, and traffic-heavy applications.</p>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <h3 className="mt-2 text-sm font-semibold">Production Support</h3>
                <p className="mt-1 text-sm text-muted-foreground">Provisioning and operations support for high-ticket infrastructure rollouts.</p>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/vps" className="inline-flex items-center gap-1.5 rounded-md border border-border/40 px-4 py-2 text-sm hover:bg-foreground/[0.04]">
                Compare with Cloud Instances
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              {customSettings.enableCustomConfiguration ? (
                <Link href="/configure" className="inline-flex items-center gap-1.5 rounded-md border border-border/40 px-4 py-2 text-sm hover:bg-foreground/[0.04]">
                  Build Custom Instance
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
              {buildDedicatedWhatsappUrl({ phone: brand.companyPhone, productName: "Dedicated Server", price: 0, pageUrl: `${brand.siteUrl.replace(/\/$/, "")}/dedicated` }) ? (
                <a
                  href={buildDedicatedWhatsappUrl({ phone: brand.companyPhone, productName: "Dedicated Server", price: 0, pageUrl: `${brand.siteUrl.replace(/\/$/, "")}/dedicated` })!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Talk to Sales
                </a>
              ) : null}
            </div>
          </div>
        </Container>
      </section>

      <section className="py-8 sm:py-12">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <h2 className="text-2xl font-semibold tracking-tight">Dedicated Server FAQ</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <h3 className="text-sm font-semibold">Can I request custom hardware changes?</h3>
                <p className="mt-1 text-sm text-muted-foreground">Yes. Use Book Now or WhatsApp and our team will prepare a custom dedicated proposal.</p>
              </div>
              <div className="rounded-xl bg-foreground/[0.04] p-4">
                <h3 className="text-sm font-semibold">Is this page publicly accessible?</h3>
                <p className="mt-1 text-sm text-muted-foreground">Yes. Dedicated catalog visibility is public and does not require login.</p>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${brand.brandName} Dedicated Servers`,
            itemListElement: products.map((p, i) => ({
              "@type": "Product",
              position: i + 1,
              name: p.name,
              description: p.shortDescription || p.description || "Dedicated server plan",
              offers: {
                "@type": "Offer",
                priceCurrency: "INR",
                price: Number(p.price1m),
                availability: "https://schema.org/InStock",
              },
            })),
          }),
        }}
      />
    </SiteShell>
  )
}
