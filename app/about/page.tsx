import type { Metadata } from "next"
import Image from "next/image"
import type React from "react"
import { Mail, MapPin, ExternalLink } from "lucide-react"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { CTASection } from "@/components/cta-section"
import { Button } from "@/components/ui/button"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "About",
    description: site.aboutCompanyDescription,
    path: "/about",
  })
}

export default async function AboutPage() {
  const site = await getPublicSiteSettings()
  const founder = site.founder
  const founderFacts = [
    founder.title ? ["Title", founder.title] : null,
    founder.experienceYears !== null ? ["Experience", `${founder.experienceYears}+ years`] : null,
    founder.age !== null ? ["Age", String(founder.age)] : null,
    founder.location ? ["Location", founder.location] : null,
  ].filter(Boolean) as Array<[string, string]>

  return (
    <SiteShell>
      <PageHeader
        eyebrow="About"
        title={site.aboutCompanyHeadline}
        description={site.aboutCompanyDescription}
      />

      <section className="py-16">
        <Container className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeader eyebrow="Company" title={`About ${site.brandName}`} />
          <div className="flex flex-col gap-5 text-pretty text-base leading-relaxed text-muted-foreground">
            <p>{site.aboutCompanyDescription}</p>
            {site.footerDescription ? <p>{site.footerDescription}</p> : null}
            {site.companyAddress ? <p>{site.legalCompanyName} operates from {site.companyAddress}.</p> : null}
          </div>
        </Container>
      </section>

      {site.missionStatement || site.visionStatement ? (
        <section className="py-16">
          <Container className="grid gap-4 md:grid-cols-2">
            {site.missionStatement ? (
              <div className="glass rounded-xl p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">Mission</p>
                <h2 className="mt-3 text-2xl font-semibold">What we are building</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{site.missionStatement}</p>
              </div>
            ) : null}
            {site.visionStatement ? (
              <div className="glass rounded-xl p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent">Vision</p>
                <h2 className="mt-3 text-2xl font-semibold">Where we are going</h2>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{site.visionStatement}</p>
              </div>
            ) : null}
          </Container>
        </section>
      ) : null}

      {founder.visible ? (
        <section className="py-16">
          <Container className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeader eyebrow="Founder" title="Founder profile" />
            <div className="glass rounded-xl p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row">
                {founder.photoUrl ? (
                  <Image src={founder.photoUrl} alt={founder.name} width={112} height={112} className="h-28 w-28 rounded-xl border border-border/40 object-cover" unoptimized />
                ) : (
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl border border-[var(--border-selected)] bg-[var(--accent-subtle)] text-3xl font-semibold text-[var(--text-selected)]">
                    {founder.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold">{founder.name}</h2>
                  {founder.title ? <p className="mt-1 text-sm text-accent">{founder.title}</p> : null}
                  {founder.shortBio ? <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{founder.shortBio}</p> : null}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {founder.email ? <FounderLink href={`mailto:${founder.email}`} label={founder.email} icon={<Mail className="h-3.5 w-3.5" />} /> : null}
                    {founder.linkedInUrl ? <FounderLink href={founder.linkedInUrl} label="LinkedIn" icon={<ExternalLink className="h-3.5 w-3.5" />} /> : null}
                    {founder.xUrl ? <FounderLink href={founder.xUrl} label="X / Twitter" icon={<ExternalLink className="h-3.5 w-3.5" />} /> : null}
                    {founder.location ? <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{founder.location}</span> : null}
                  </div>
                </div>
              </div>
              {founderFacts.length ? (
                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {founderFacts.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-border/40 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-sm font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {founder.specialties.length ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  {founder.specialties.map((item) => <span key={item} className="rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-3 py-1 text-xs text-[var(--text-selected)]">{item}</span>)}
                </div>
              ) : null}
              {founder.longDescription ? <p className="mt-6 text-sm leading-relaxed text-muted-foreground">{founder.longDescription}</p> : null}
            </div>
          </Container>
        </section>
      ) : null}

      <section className="py-16">
        <Container>
          <div className="glass flex flex-col gap-4 rounded-xl p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent">Contact</p>
              <h2 className="mt-2 text-2xl font-semibold">Talk to {site.brandName}</h2>
              <p className="mt-2 text-sm text-muted-foreground">For support and business questions, reach the team at {site.supportEmail}.</p>
            </div>
            <Button asChild>
              <a href={`mailto:${site.supportEmail}`}>Contact support</a>
            </Button>
          </div>
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}

function FounderLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return <a href={href} className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">{icon}{label}</a>
}
