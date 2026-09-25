import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { absoluteUrl } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Delhi NCR Cloud VPS Platform | Scalable NVMe Servers",
  description: "Cloud VPS hosting for Delhi NCR workloads with transparent pricing, KVM-based virtualization, and production-ready deployment paths.",
  keywords: ["VPS hosting Delhi NCR", "cloud server Delhi", "Delhi VPS India", "NCR cloud hosting"],
  alternates: { canonical: absoluteUrl("/vps-hosting-delhi-ncr") },
}

export default function DelhiNcrVpsPage() {
  return <SiteShell><PageHeader eyebrow="Delhi NCR cloud VPS" title="Cloud VPS Platform for Delhi NCR" description="Deploy Cloud Instances for North India traffic with reliable performance and clear upgrade paths." /><section className="py-12"><Container className="grid gap-6 lg:grid-cols-2"><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Regional fit</h2><p className="mt-2 text-sm text-muted-foreground">Built for teams serving Delhi NCR audiences that need predictable compute and easy horizontal expansion.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Technical profile</h2><p className="mt-2 text-sm text-muted-foreground">NVMe storage, KVM-based virtualization, and SLA-driven reliability for production cloud workloads.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Business use cases</h2><p className="mt-2 text-sm text-muted-foreground">Customer portals, backend APIs, eCommerce applications, and startup product infrastructure.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Explore next</h2><div className="mt-3 flex flex-col gap-2 text-sm"><Link href="/pricing" className="text-accent hover:underline">See India pricing plans</Link><Link href="/startup-cloud-hosting" className="text-accent hover:underline">Startup hosting options</Link></div></div></Container></section><CTASection /></SiteShell>
}
