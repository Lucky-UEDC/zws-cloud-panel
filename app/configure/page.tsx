import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { Configurator } from "@/components/configure/configurator"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { getCustomConfigurationSettings } from "@/lib/settings"
import { buildPageMetadata } from "@/lib/seo/metadata"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    title: "Build Custom Cloud Instance",
    description: "Launch a production-ready virtual cloud server with NVMe storage, dedicated resources, and included bandwidth.",
    path: "/configure",
  })
}

export default async function ConfigurePage() {
  const customSettings = await getCustomConfigurationSettings()

  if (!customSettings.enableCustomConfiguration) {
    return (
      <SiteShell>
        <PageHeader
          eyebrow="Custom instance builder"
          title="Custom cloud instance builder is currently unavailable."
          description="Choose one of the ready cloud instance plans while custom configuration is disabled."
        />
        <section className="py-12 sm:py-16">
          <Container>
            <Button asChild>
              <Link href="/pricing">View plans</Link>
            </Button>
          </Container>
        </section>
      </SiteShell>
    )
  }

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Configurator"
        title="Build Custom Instance"
        description="Tune vCPU, RAM, NVMe storage, bandwidth, operating system, and region with a live transparent quote."
      />
      <section className="py-12 sm:py-16">
        <Container>
          <Configurator customSettings={customSettings} />
        </Container>
      </section>
    </SiteShell>
  )
}
