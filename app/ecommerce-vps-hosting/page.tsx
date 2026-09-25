import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { absoluteUrl } from "@/lib/seo"

export const metadata: Metadata = {
  title: "eCommerce Cloud VPS Platform India | Scalable Storefront Infra",
  description: "Cloud VPS hosting for eCommerce applications in India with scalable resources, NVMe speed, and predictable costs.",
  keywords: ["eCommerce VPS India", "WooCommerce VPS India", "cloud server for online store India"],
  alternates: { canonical: absoluteUrl("/ecommerce-vps-hosting") },
}

export default function EcommerceVpsPage() {
  return <SiteShell><PageHeader eyebrow="Use case" title="eCommerce Cloud VPS Platform" description="Infrastructure designed for catalog traffic, checkout reliability, and predictable scaling during campaigns." /><section className="py-12"><Container className="grid gap-6 lg:grid-cols-2"><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Commerce-ready workloads</h2><p className="mt-2 text-sm text-muted-foreground">Fits product catalogs, payment-connected storefronts, and seasonal spikes that need consistent compute availability.</p></div><div className="glass rounded-2xl p-6"><h2 className="text-xl font-semibold">Technical positioning</h2><p className="mt-2 text-sm text-muted-foreground">Cloud Instance plans with NVMe storage, KVM isolation, and transparent pricing for growth-oriented eCommerce teams.</p><Link href="/technical-specifications" className="mt-3 inline-block text-sm text-accent hover:underline">Read technical specifications</Link></div></Container></section><CTASection /></SiteShell>
}
