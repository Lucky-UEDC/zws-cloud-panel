import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { absoluteUrl } from "@/lib/seo"

export const metadata: Metadata = {
  title: "WordPress Cloud VPS Platform India | NVMe Performance",
  description: "WordPress cloud VPS hosting in India with scalable resources, NVMe storage, and predictable pricing for production sites.",
  keywords: ["WordPress VPS hosting Mumbai", "WordPress cloud VPS India", "managed WordPress VPS India"],
  alternates: { canonical: absoluteUrl("/wordpress-vps-hosting") },
}

export default function WordpressVpsPage() {
  return <SiteShell><PageHeader eyebrow="Use case" title="WordPress Cloud VPS Platform" description="Cloud Instances for WordPress workloads that need stable performance and clean upgrade paths." /><section className="py-12"><Container className="grid gap-6 lg:grid-cols-2"><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">What this page targets</h2><p className="mt-2 text-sm text-muted-foreground">Content-heavy sites, WooCommerce storefronts, and business WordPress deployments with predictable infrastructure needs.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Platform strengths</h2><p className="mt-2 text-sm text-muted-foreground">NVMe-backed storage, production-ready cloud sizing, and transparent monthly billing from entry to growth tiers.</p><Link href="/pricing" className="mt-3 inline-block text-sm text-accent hover:underline">View pricing plans</Link></div></Container></section><CTASection /></SiteShell>
}
