import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { Hero } from "@/components/home/hero"
import { TrustStrip } from "@/components/home/trust-strip"
import { PlansPreview } from "@/components/home/plans-preview"
import { ConfigPreview } from "@/components/home/config-preview"
import { Features } from "@/components/home/features"
import { WhyChoose } from "@/components/home/why-choose"
import { Infrastructure } from "@/components/home/infrastructure"
import { Testimonials } from "@/components/home/testimonials"
import { HomeFaq } from "@/components/home/home-faq"
import { CTASection } from "@/components/cta-section"
import { getCustomConfigurationSettings } from "@/lib/settings"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { fallbackPublicSiteSettings } from "@/lib/runtime-fallbacks"

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Cloud Compute Instances | NVMe Cloud Servers",
    description: "Deploy high-performance compute instances in India with NVMe storage, KVM virtualization, dedicated resources, included bandwidth, and 99.99% uptime SLA.",
    path: "/",
  })
}

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function HomePage() {
  const [customSettings, site] = await Promise.all([
    getCustomConfigurationSettings().catch(() => ({ enableCustomConfiguration: false })),
    getPublicSiteSettings().catch(fallbackPublicSiteSettings),
  ])
  const customConfigurationEnabled = customSettings.enableCustomConfiguration

  return (
    <SiteShell>
      <Hero customConfigurationEnabled={customConfigurationEnabled} brandName={site.brandName} />
      <TrustStrip />
      <PlansPreview />
      {customConfigurationEnabled ? <ConfigPreview /> : null}
      <Features />
      <WhyChoose brandName={site.brandName} />
      <Infrastructure />
      <Testimonials brandName={site.brandName} />
      <HomeFaq />
      <CTASection customConfigurationEnabled={customConfigurationEnabled} />
    </SiteShell>
  )
}
