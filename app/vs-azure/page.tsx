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
    title: `Azure Alternative India | ${site.brandName} VPS Comparison`,
    description: `Objective cloud VPS comparison between ${site.brandName} and Azure virtual machine offerings for India-focused buyers.`,
    path: "/vs-azure",
  })
}

const rows = [
  ["Entry pricing posture", "Localized plan pricing by visitor region", "Depends on VM family and region"],
  ["Positioning", "Cloud VPS instances with transparent plans", "Large multi-service cloud platform"],
  ["Typical buyer profile", "Cost-aware SMB/startup and dev teams", "Enterprise and mixed workload estates"],
  ["Complexity profile", "Simpler plan-first experience", "Broader platform with deeper service matrix"],
]

export default async function VsAzurePage() {
  const site = await getPublicSiteSettings()
  return <SiteShell><PageHeader eyebrow="Comparison" title={`${site.brandName} vs Azure VMs`} description="Objective comparison for teams choosing between plan-first cloud VPS and broad hyperscale VM platforms." /><section className="py-12"><Container><div className="glass rounded-2xl p-6"><p className="mb-4 text-xs text-muted-foreground">Comparison values are indicative and should be revalidated against current Azure pricing calculators and service documentation.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="py-2">Feature</th><th className="py-2">{site.brandName}</th><th className="py-2">Azure VMs</th></tr></thead><tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-border/40"><td className="py-2">{r[0]}</td><td className="py-2">{r[1]}</td><td className="py-2">{r[2]}</td></tr>)}</tbody></table></div></div></Container></section><CTASection /></SiteShell>
}
