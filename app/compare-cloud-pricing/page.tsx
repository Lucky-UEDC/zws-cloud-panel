import type { Metadata } from "next"
import Link from "next/link"
import Script from "next/script"
import { SiteShell } from "@/components/layout/site-shell"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2 } from "lucide-react"
import { getCustomConfigurationSettings, getSetting, type MarketingCloudComparisonSettings } from "@/lib/settings"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: `${site.brandName} vs AWS Azure Google Cloud`,
    description: `Compare ${site.brandName} VPS pricing with AWS, Azure, and Google Cloud. See how included bandwidth and fixed pricing reduce monthly cloud costs.`,
    path: "/compare-cloud-pricing",
  })
}

function estimateHyperscalerCost(vm: number, bandwidthGb: number, egress: number) {
  return vm + bandwidthGb * egress
}

function savingPercent(hyperscaler: number, zws: number) {
  if (hyperscaler <= 0) return 0
  return Math.max(0, ((hyperscaler - zws) / hyperscaler) * 100)
}

function inr(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value)
}

export default async function CompareCloudPricingPage() {
  const [settings, customSettings, site] = await Promise.all([
    getSetting<MarketingCloudComparisonSettings>("marketing_cloud_comparison_settings"),
    getCustomConfigurationSettings(),
    getPublicSiteSettings(),
  ])
  const brandName = site.brandName
  const faqs = [
    { q: `Is ${brandName} cheaper than AWS?`, a: `For many VPS workloads, ${brandName} can be more cost-effective because pricing is fixed monthly and includes bandwidth, while AWS usage often adds egress charges based on outbound transfer.` },
    { q: `Does ${brandName} include bandwidth?`, a: settings.zwsIncludedBandwidthText },
    { q: "Why do AWS, Azure and GCP bills increase?", a: "Bills can increase with outbound traffic, storage growth, and usage spikes. Egress and related network charges are a common reason monthly cost goes above base VM pricing." },
    { q: `Is ${brandName} good for startups?`, a: "Yes. Startups that need predictable infrastructure spend can benefit from fixed monthly compute pricing and included traffic quotas." },
    { q: `Can I host high traffic websites on ${brandName}?`, a: `Yes. ${brandName} is suitable for high-traffic hosting with scalable VPS options, NVMe storage, and plans designed for sustained workloads.` },
  ]
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  }
  const examples = [
    {
      label: settings.example1Label,
      bandwidthGb: settings.example1BandwidthGb,
      zws: settings.example1ZwsFixedPrice,
      awsVm: settings.example1AwsVmMonthlyCost,
      azureVm: settings.example1AzureVmMonthlyCost,
      gcpVm: settings.example1GcpVmMonthlyCost,
    },
    {
      label: settings.example2Label,
      bandwidthGb: settings.example2BandwidthGb,
      zws: settings.example2ZwsFixedPrice,
      awsVm: settings.example2AwsVmMonthlyCost,
      azureVm: settings.example2AzureVmMonthlyCost,
      gcpVm: settings.example2GcpVmMonthlyCost,
    },
    {
      label: settings.example3Label,
      bandwidthGb: settings.example3BandwidthGb,
      zws: settings.example3ZwsFixedPrice,
      awsVm: settings.example3AwsVmMonthlyCost,
      azureVm: settings.example3AzureVmMonthlyCost,
      gcpVm: settings.example3GcpVmMonthlyCost,
    },
  ]

  return (
    <SiteShell>
      <Script id="faq-jsonld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="py-16">
        <Container className="space-y-6 text-center">
          <Badge variant="secondary">Cloud Price Comparison</Badge>
          <h1 className="text-balance text-4xl font-semibold md:text-5xl">Stop Paying Surprise Cloud Bandwidth Bills</h1>
          <p className="mx-auto max-w-3xl text-balance text-muted-foreground">Compare {brandName} with AWS, Azure and Google Cloud for cloud instances, included traffic quotas, NVMe storage and predictable monthly pricing.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild><Link href="/vps">View Cloud Instances</Link></Button>
            {customSettings.enableCustomConfiguration ? (
              <Button variant="outline" asChild><Link href="/configure">Build Custom Instance</Link></Button>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{settings.savingPercentageHeadline}</p>
        </Container>
      </section>

      <section className="pb-14">
        <Container>
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>VPS Cloud Comparison</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="border-b border-border/40 text-left"><th className="py-3 pr-3">Feature</th><th className="py-3 pr-3">{brandName}</th><th className="py-3 pr-3">AWS</th><th className="py-3 pr-3">Azure</th><th className="py-3">Google Cloud</th></tr></thead>
                <tbody>
                  {[
                    ["Monthly pricing", "Fixed monthly plans", "Estimated usage-based pricing", "Estimated usage-based pricing", "Estimated usage-based pricing"],
                    ["Included bandwidth", settings.zwsIncludedBandwidthText, "Limited free outbound transfer", "Limited free outbound transfer", "Limited free outbound transfer"],
                    ["Network fabric", "Datacenter-grade network fabric up to 1.8 Tbps aggregate capacity", "Region-dependent shared provider backbone", "Region-dependent shared provider backbone", "Region-dependent shared provider backbone"],
                    ["Extra bandwidth / egress", "Predictable add-on structure", "Paid egress after limited free outbound transfer", "Data transferred out is charged", "Internet egress charged per GB by path/region"],
                    ["Billing predictability", "High", "Variable", "Variable", "Variable"],
                    ["VPS setup speed", "Fast provisioning", "Depends on configuration", "Depends on configuration", "Depends on configuration"],
                    ["Indian hosting availability", "India-focused hosting options", "Available in selected regions", "Available in selected regions", "Available in selected regions"],
                    ["Support", `Direct support from ${brandName}`, "Tiered support plans", "Tiered support plans", "Tiered support plans"],
                    ["Hidden charges", "Low, fixed-plan oriented", "Possible egress and usage overages", "Possible egress and usage overages", "Possible egress and usage overages"],
                    ["Best for", "Startups, agencies, predictable workloads", "Large distributed workloads", "Enterprise integrated workloads", "Global distributed workloads"],
                  ].map((row) => (
                    <tr key={row[0]} className="border-b border-border/20 align-top">
                      {row.map((col, idx) => <td key={`${row[0]}-${idx}`} className="py-3 pr-3 text-muted-foreground first:font-medium first:text-foreground">{col}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </Container>
      </section>

      <section className="pb-14">
        <Container className="space-y-6">
          <Card className="glass border-border/40 bg-gradient-to-br from-background to-background/60">
            <CardHeader>
              <CardTitle className="text-2xl">Why Your Cloud Bill Explodes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Hyperscaler pricing stacks up because they bill separately for every layer:</p>
              <ul className="grid gap-2 md:grid-cols-3">
                <li className="rounded-md border border-border/40 bg-background/40 px-3 py-2"><span className="font-medium text-foreground">Compute</span> billed by instance size and runtime.</li>
                <li className="rounded-md border border-border/40 bg-background/40 px-3 py-2"><span className="font-medium text-foreground">Storage</span> billed by volume type, capacity, and I/O tiers.</li>
                <li className="rounded-md border border-border/40 bg-background/40 px-3 py-2"><span className="font-medium text-foreground">Bandwidth</span> billed for outbound usage per GB.</li>
              </ul>
              <p className="text-base font-semibold text-foreground">That’s why your {inr(2000)} server becomes {inr(25000)}+.</p>
            </CardContent>
          </Card>
          <h2 className="text-2xl font-semibold">Estimated Pricing Examples</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            {examples.map((ex) => {
              const aws = estimateHyperscalerCost(ex.awsVm, ex.bandwidthGb, settings.awsEgressCostPerGb)
              const azure = estimateHyperscalerCost(ex.azureVm, ex.bandwidthGb, settings.azureEgressCostPerGb)
              const gcp = estimateHyperscalerCost(ex.gcpVm, ex.bandwidthGb, settings.gcpEgressCostPerGb)
              const avgHyperscaler = (aws + azure + gcp) / 3
              const save = savingPercent(avgHyperscaler, ex.zws)
              return (
                <Card key={ex.label} className="glass group border-accent/50 shadow-[0_0_0_1px_rgba(45,212,191,0.2)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_25px_rgba(45,212,191,0.18)]">
                  <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge className="bg-accent/20 text-accent hover:bg-accent/20">BEST VALUE</Badge>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated Saving</p>
                        <p className="text-3xl font-bold leading-none text-accent">{save.toFixed(0)}%</p>
                      </div>
                    </div>
                    <CardTitle className="text-lg">{ex.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-muted-foreground">AWS estimated cost (VM + bandwidth charges): <span className="font-medium text-foreground">{inr(aws)}</span></p>
                    <p className="text-muted-foreground">Azure estimated cost (VM + bandwidth charges): <span className="font-medium text-foreground">{inr(azure)}</span></p>
                    <p className="text-muted-foreground">Google Cloud estimated cost (VM + bandwidth charges): <span className="font-medium text-foreground">{inr(gcp)}</span></p>
                    <p className="text-base font-semibold text-foreground">{brandName} fixed monthly price: {inr(ex.zws)}</p>
                    <div className="space-y-1 pt-1">
                      <p className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Includes bandwidth</p>
                      <p className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> No hidden charges</p>
                      <p className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Fixed monthly pricing</p>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <p className="text-sm font-medium text-foreground">Cloud providers charge around {inr(7)} to {inr(9)} per GB for outbound traffic.</p>
          <p className="text-base font-semibold text-orange-300">⚠️ AWS, Azure & GCP charge for every GB you use.</p>
          <p className="text-xs text-muted-foreground">Third-party cloud prices vary by region, usage, taxes and provider changes. Estimates are for comparison only.</p>
        </Container>
      </section>

      <section className="pb-14">
        <Container className="grid gap-4 md:grid-cols-2">
          <Card className="glass border-border/40"><CardHeader><CardTitle>Why hyperscaler bills become expensive</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Base VM prices are only one part of monthly spend. Outbound transfer, premium support tiers, and high-usage spikes can increase total cost beyond initial estimates.</CardContent></Card>
          <Card className="glass border-border/40"><CardHeader><CardTitle>Bandwidth cost explained</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">When traffic leaves provider networks, internet egress fees often apply. AWS typically includes limited free outbound transfer, then paid egress. Azure charges for data transferred out, and GCP internet egress is charged per GB based on route and region.</CardContent></Card>
          <Card className="glass border-border/40"><CardHeader><CardTitle>Why fixed pricing is better for startups</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Predictable bills help teams plan runway and avoid margin erosion from sudden network overages. Fixed monthly Cloud VPS plans simplify budgeting and pricing strategy.</CardContent></Card>
          <Card className="glass border-border/40"><CardHeader><CardTitle>{brandName} benefits</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Fixed monthly plans, included bandwidth, NVMe storage performance, India-focused infrastructure options, and fast setup make {brandName} practical for scaling production workloads.</CardContent></Card>
        </Container>
      </section>

      <section className="pb-14">
        <Container>
          <Card className="glass border-accent/40 shadow-[0_0_25px_rgba(45,212,191,0.12)]">
            <CardHeader><CardTitle className="text-2xl">Why {brandName} Wins</CardTitle></CardHeader>
            <CardContent>
              <ul className="grid gap-3 text-sm md:grid-cols-2">
                <li className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Fixed pricing</li>
                <li className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Predictable bandwidth included</li>
                <li className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Datacenter fabric up to 1.8 Tbps aggregate</li>
                <li className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> No hidden billing</li>
                <li className="flex items-center gap-2 text-foreground"><CheckCircle2 className="h-4 w-4 text-accent" /> Predictable monthly cost</li>
                <li className="flex items-center gap-2 text-foreground md:col-span-2"><CheckCircle2 className="h-4 w-4 text-accent" /> Built for startups and developers</li>
              </ul>
            </CardContent>
          </Card>
        </Container>
      </section>

      <section className="pb-14">
        <Container className="space-y-4">
          <h2 className="text-2xl font-semibold">FAQ</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {faqs.map((faq) => (
              <Card key={faq.q} className="glass border-border/40"><CardHeader><CardTitle className="text-base">{faq.q}</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{faq.a}</CardContent></Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="pb-14">
        <Container>
          <div className="rounded-xl border border-accent/40 bg-gradient-to-r from-background to-background/70 p-6 text-center shadow-[0_0_28px_rgba(45,212,191,0.1)]">
            <h2 className="text-balance text-2xl font-semibold">Deploy with predictable traffic quota included upfront.</h2>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Button asChild><Link href={customSettings.enableCustomConfiguration ? "/configure" : "/pricing"}>Deploy Cloud Instance</Link></Button>
              <Button variant="outline" asChild><Link href="/vps">View Plans</Link></Button>
            </div>
          </div>
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}
