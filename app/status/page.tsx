import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { LivePlatformStatus } from "@/components/status/live-platform-status"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "System Status",
    description: `Live status for ${site.brandName} regions and services.`,
    path: "/status",
  })
}

export default function StatusPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Status"
        title="Live service status."
        description="Current platform availability from the production health monitor."
      />

      <section className="py-16">
        <Container><LivePlatformStatus /></Container>
      </section>
    </SiteShell>
  )
}
