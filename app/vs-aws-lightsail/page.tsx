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
    title: `AWS Lightsail Alternative India | ${site.brandName} Comparison`,
    description: `Objective comparison of ${site.brandName} and AWS Lightsail for India-focused cloud VPS buyers.`,
    path: "/vs-aws-lightsail",
  })
}

const rows = [
  ["Starting price", "Localized plan pricing", "Varies by region and bundle"],
  ["India-focused positioning", "Mumbai and Bengaluru positioning", "Regional presence depends on AWS region selection"],
  ["Billing model", "Transparent plan-based cloud VPS pricing", "Bundle-based pricing model"],
  ["Audience fit", "SMB/startup and developer-focused India pages", "Broad global cloud platform audience"],
]

export default async function VsAwsLightsailPage() {
  const site = await getPublicSiteSettings()
  return <SiteShell><PageHeader eyebrow="Comparison" title={`${site.brandName} vs AWS Lightsail`} description="Objective comparison for teams evaluating cloud VPS options in India-region workloads." /><section className="py-12"><Container><div className="glass rounded-2xl p-6"><p className="mb-4 text-xs text-muted-foreground">Comparison values are indicative and should be revalidated against current provider pricing and documentation.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th className="py-2">Feature</th><th className="py-2">{site.brandName}</th><th className="py-2">AWS Lightsail</th></tr></thead><tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-border/40"><td className="py-2">{r[0]}</td><td className="py-2">{r[1]}</td><td className="py-2">{r[2]}</td></tr>)}</tbody></table></div></div></Container></section><CTASection /></SiteShell>
}
