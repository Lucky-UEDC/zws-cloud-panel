import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { FeatureCard } from "@/components/feature-card"
import { CTASection } from "@/components/cta-section"
import { Gauge, Network, ServerCog, ShieldCheck, Thermometer, Zap } from "lucide-react"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Infrastructure & Data Centers",
    description: `${site.brandName} operates across Tier III+ facilities with redundant power, cooling, and network paths.`,
    path: "/infrastructure",
  })
}

const regions = [
  { code: "BOM", city: "Mumbai, IN", status: "Live", tier: "Tier III+" },
  { code: "BLR", city: "Bengaluru, IN", status: "Live", tier: "Tier III" },
  { code: "SIN", city: "Singapore", status: "Live", tier: "Tier III+" },
  { code: "FRA", city: "Frankfurt, DE", status: "Live", tier: "Tier IV" },
  { code: "NYC", city: "New York, US", status: "Live", tier: "Tier III+" },
  { code: "LON", city: "London, UK", status: "Coming soon", tier: "Tier III+" },
  { code: "TYO", city: "Tokyo, JP", status: "Planned", tier: "—" },
]

const capabilities = [
  { icon: ServerCog, title: "Modern hardware", description: "Current-gen CPUs, ECC memory, and NVMe storage across our fleet." },
  { icon: Network, title: "Redundant network", description: "Multiple tier-1 transit providers with anycast-ready routing." },
  { icon: ShieldCheck, title: "Network DDoS", description: "Always-on mitigation at the network edge for every region." },
  { icon: Thermometer, title: "N+1 cooling", description: "Redundant cooling and environmental controls at every site." },
  { icon: Zap, title: "N+1 power", description: "UPS and generator coverage with regularly tested failover." },
  { icon: Gauge, title: "Observability", description: "Public status page with region-level telemetry and historical uptime." },
]

export default function InfrastructurePage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Infrastructure"
        title="Built on facilities engineered for uptime."
        description="Our regions sit in Tier III+ and Tier IV data centers with redundant power, cooling, and network paths."
      />

      <section className="py-16">
        <Container className="flex flex-col gap-10">
          <SectionHeader eyebrow="Regions" title="Deploy close to your users" />

          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-sm">
              <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Code</th>
                  <th className="px-5 py-3 text-left font-medium">Location</th>
                  <th className="px-5 py-3 text-left font-medium">Tier</th>
                  <th className="px-5 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.code}>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {r.code}
                    </td>
                    <td className="px-5 py-3 font-medium">{r.city}</td>
                    <td className="px-5 py-3 text-muted-foreground">{r.tier}</td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs ${
                          r.status === "Live"
                            ? "text-accent"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            r.status === "Live" ? "bg-accent" : "bg-muted-foreground"
                          }`}
                        />
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container className="flex flex-col gap-10">
          <SectionHeader eyebrow="Capabilities" title="What every region includes" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map((c) => (
              <FeatureCard key={c.title} {...c} />
            ))}
          </div>
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}
