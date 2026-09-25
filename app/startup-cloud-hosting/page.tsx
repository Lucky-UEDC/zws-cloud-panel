import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { absoluteUrl } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Startup Cloud Hosting India | Cloud VPS",
  description: "Startup-friendly cloud hosting in India with scalable cloud VPS plans, transparent pricing, and fast deployment.",
  keywords: ["startup cloud hosting India", "cloud VPS for startups India", "affordable cloud server India"],
  alternates: { canonical: absoluteUrl("/startup-cloud-hosting") },
}

export default function StartupCloudHostingPage() {
  return <SiteShell><PageHeader eyebrow="Use case" title="Startup Cloud Hosting in India" description="Cloud VPS hosting designed for early-stage teams balancing speed, reliability, and budget discipline." /><section className="py-12"><Container className="grid gap-6 lg:grid-cols-2"><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Startup economics</h2><p className="mt-2 text-sm text-muted-foreground">Start from low entry pricing, scale resources when usage grows, and avoid long-term lock-in on early infrastructure choices.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Growth path</h2><p className="mt-2 text-sm text-muted-foreground">Move from single-node deployments to multi-service architecture with predictable cloud VPS upgrade paths.</p><Link href="/cloud-vps" className="mt-3 inline-block text-sm text-accent hover:underline">Explore cloud VPS plans</Link></div></Container></section><CTASection /></SiteShell>
}
