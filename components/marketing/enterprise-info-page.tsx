import type { Metadata } from "next"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { ArrowRight } from "lucide-react"
import { CTASection } from "@/components/cta-section"
import { FeatureCard } from "@/components/feature-card"
import { Container } from "@/components/layout/container"
import { PageHeader } from "@/components/layout/page-header"
import { SectionHeader } from "@/components/layout/section-header"
import { SiteShell } from "@/components/layout/site-shell"
import { Button } from "@/components/ui/button"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export type EnterpriseInfoPageConfig = {
  path: string
  eyebrow: string
  title: string
  description: string
  primaryHref?: string
  primaryLabel?: string
  secondaryHref?: string
  secondaryLabel?: string
  sections: Array<{
    eyebrow: string
    title: string
    description?: string
    items: Array<{
      icon: LucideIcon
      title: string
      description: string
    }>
  }>
}

export async function enterpriseInfoMetadata(config: EnterpriseInfoPageConfig): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: config.title,
    description: config.description.replaceAll("{brand}", site.brandName),
    path: config.path,
  })
}

export async function EnterpriseInfoPage({ config }: { config: EnterpriseInfoPageConfig }) {
  const site = await getPublicSiteSettings()
  const description = config.description.replaceAll("{brand}", site.brandName)

  return (
    <SiteShell>
      <PageHeader eyebrow={config.eyebrow} title={config.title} description={description}>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="gap-1.5">
            <Link href={config.primaryHref || "/pricing"}>
              {config.primaryLabel || "View pricing"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={config.secondaryHref || "/contact"}>{config.secondaryLabel || "Talk to sales"}</Link>
          </Button>
        </div>
      </PageHeader>

      {config.sections.map((section) => (
        <section key={section.title} className="py-14">
          <Container className="flex flex-col gap-8">
            <SectionHeader eyebrow={section.eyebrow} title={section.title} description={section.description} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item) => (
                <FeatureCard key={item.title} {...item} />
              ))}
            </div>
          </Container>
        </section>
      ))}

      <CTASection />
    </SiteShell>
  )
}
