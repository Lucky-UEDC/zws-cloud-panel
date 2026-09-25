import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Company & Compliance",
    description: `${site.brandName} company information and compliance posture.`,
    path: "/compliance",
  })
}

const certifications = [
  { name: "ISO/IEC 27001", status: "In progress", desc: "Information security management system." },
  { name: "SOC 2 Type II", status: "Planned", desc: "Trust services criteria for SaaS & hosting providers." },
  { name: "GDPR", status: "Aligned", desc: "Data handling aligned with EU data protection requirements." },
  { name: "PCI-DSS", status: "Payment partner handled", desc: "Card data is processed by certified payment partners." },
]

export default async function CompliancePage() {
  const site = await getPublicSiteSettings()
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Company"
        title="Compliance & company information."
        description="An overview of our entity, compliance posture, and in-progress certifications."
      />

      <section className="py-16">
        <Container className="flex flex-col gap-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <SectionHeader eyebrow="Company" title="About the business" />
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
              <Row k="Legal name" v={site.legalCompanyName} />
              {site.companyAddress ? <Row k="Registered office" v={site.companyAddress} /> : null}
              {site.gstNumber ? <Row k="GST / tax identifier" v={site.gstNumber} /> : null}
              <Row k="Contact" v={site.supportEmail} />
            </div>
          </div>

          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <SectionHeader
              eyebrow="Compliance"
              title="Certifications & posture"
            />
            <div className="glass overflow-hidden rounded-2xl">
              <table className="w-full text-sm">
                <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Framework</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {certifications.map((c) => (
                    <tr key={c.name}>
                      <td className="px-5 py-3.5 font-medium">{c.name}</td>
                      <td className="px-5 py-3.5 text-accent">{c.status}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{c.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Important: this template does not constitute actual certification.
            Replace with verified statuses and certificates before publishing.
          </p>
        </Container>
      </section>
    </SiteShell>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:grid sm:grid-cols-[180px_1fr] sm:gap-3">
      <dt className="font-medium text-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}
