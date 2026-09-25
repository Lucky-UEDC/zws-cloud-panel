import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { FAQAccordion } from "@/components/faq-accordion"
import { CTASection } from "@/components/cta-section"
import { homeFaqs } from "@/lib/data/faqs"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Frequently Asked Questions",
    description: `Answers to the most common questions about ${site.brandName} hosting, billing, support, and policies.`,
    path: "/faq",
  })
}

const billingFaqs = [
  {
    q: "What payment methods do you support?",
    a: "We accept major credit cards, UPI, and bank transfers for Indian customers. Invoicing is available on annual plans and enterprise contracts.",
  },
  {
    q: "Do you offer refunds?",
    a: "Yes — new compute instance orders include a 7-day refund window. See the Refund Policy for details and exclusions.",
  },
  {
    q: "Will I be charged automatically?",
    a: "Yes, renewals are automatic on your chosen cycle. You can cancel or change plans at any time from the client area.",
  },
]

function securityFaqsFor(abuseEmail: string) {
  return [
  {
    q: "How is my data protected?",
    a: "All management endpoints are served over TLS 1.2+. Backups (where included) are encrypted at rest. Operational access is restricted and audited.",
  },
  {
    q: "Do you run scans or inspect customer workloads?",
    a: `No. We do not inspect the contents of customer workloads. We monitor for network-level abuse and respond to reports received at ${abuseEmail}.`,
  },
  {
    q: "What compliance frameworks apply?",
    a: "Our practices align with industry standards. See the Compliance page for current certifications, in-progress work, and caveats.",
  },
  ]
}

export default async function FAQPage() {
  const site = await getPublicSiteSettings()
  const securityFaqs = securityFaqsFor(site.abuseEmail)
  return (
    <SiteShell>
      <PageHeader
        eyebrow="FAQ"
        title="Answers, up front."
        description="Common questions about hosting, billing, security, and support."
      />

      <section className="py-16">
        <Container className="flex flex-col gap-14">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <SectionHeader eyebrow="Hosting basics" title="Getting started" />
            <FAQAccordion items={homeFaqs} />
          </div>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <SectionHeader eyebrow="Billing" title="Payments & refunds" />
            <FAQAccordion items={billingFaqs} />
          </div>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <SectionHeader eyebrow="Security" title="Data & compliance" />
            <FAQAccordion items={securityFaqs} />
          </div>
        </Container>
      </section>

      <CTASection />
    </SiteShell>
  )
}
