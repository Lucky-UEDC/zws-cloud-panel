import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Cloud VPS Technical Specifications | KVM, NVMe, Tier III+",
    description: `Technical specifications for ${site.brandName} VPS infrastructure, including KVM virtualization, NVMe storage, and network architecture.`,
    path: "/technical-specifications",
  })
}

const sections = [
  ["Virtualization Platform", "KVM-based virtualization with hardware-assisted isolation and consistent instance-level resource boundaries."],
  ["Infrastructure", "Tier III+ facility profile, N+1 power and cooling design, and operations controls for production workloads."],
  ["Network Architecture", "Multi-provider routing design with resilient paths and DDoS-aware edge controls for stable traffic handling."],
  ["Storage Technology", "Enterprise NVMe-backed storage for low-latency I/O performance across application and database workloads."],
  ["Regions", "Active regions include Mumbai, Bengaluru, Singapore, Frankfurt, and New York, with additional expansion in progress."],
]

export default function TechnicalSpecificationsPage() {
  return <SiteShell><PageHeader eyebrow="Engineering detail" title="Cloud VPS Technical Specifications" description="Infrastructure and platform details for technical buyers evaluating production readiness." /><section className="py-12"><Container className="grid gap-6 md:grid-cols-2">{sections.map(([title, description]) => <div className="glass rounded-2xl p-6" key={title}><h2 className="text-xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>)}</Container></section><CTASection /></SiteShell>
}
