import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { CTASection } from "@/components/cta-section"
import { FAQAccordion } from "@/components/faq-accordion"
import { ContactForm } from "@/components/contact/contact-form"
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo"

export const metadata: Metadata = {
  title: "Managed Cloud VPS Platform | Secure, Monitored Cloud Servers",
  description:
    "Managed VPS hosting for teams that want help with patching, monitoring, and reliable operations. Talk to an engineer to get a plan recommendation.",
  keywords: ["managed vps", "managed vps hosting", "managed linux vps", "vps hosting", "server management"],
  alternates: { canonical: absoluteUrl("/managed-vps") },
}

const faqs = [
  {
    q: "What does managed VPS include?",
    a: "Managed service typically covers guidance on setup, ongoing monitoring, and operational help. Exact scope depends on your plan and workload, so contact us for a clear statement of work.",
  },
  {
    q: "Is managed VPS worth it for startups?",
    a: "Often, yes. If downtime is expensive and you do not have a dedicated infra team, managed help can cost less than firefighting incidents.",
  },
  {
    q: "Can you help with security hardening?",
    a: "Yes. We can recommend best practices for SSH, firewalling, updates, and monitoring. For compliance-specific needs, tell us your requirements.",
  },
  {
    q: "Can I start unmanaged and upgrade to managed later?",
    a: "Yes. Many teams start with self-managed VPS and move to a managed engagement as their workload becomes business-critical.",
  },
]

export default function ManagedVpsPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Managed VPS", path: "/managed-vps" },
  ])
  const faqLd = faqJsonLd(faqs)

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Managed hosting"
        title="Managed VPS"
        description="Get help with operations: monitoring, patching guidance, and an upgrade plan that matches your workload."
      />

      <section className="py-8 sm:py-10">
        <Container>
          <div className="glass rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium">Talk to an engineer</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tell us your stack, traffic, and reliability goals. We will recommend specs and a managed plan scope.
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Monitoring guidance</span>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Security best practices</span>
                  <span className="rounded-full bg-foreground/[0.04] px-3 py-1">Upgrade planning</span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/vps-hosting"
                  className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
                >
                  Instant VPS Deployment
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center rounded-md border border-border/60 px-4 py-2 text-sm font-medium"
                >
                  Contact sales
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-6">
            <div className="glass rounded-2xl p-6">
              <h2 className="text-xl font-semibold tracking-tight">When managed VPS is a fit</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                You want a stable production server without building a full infra team. It is also a great fit when you
                need help hardening, monitoring, and incident response planning.
              </p>
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <Link href="/blog/best-vps-for-startups" className="text-accent hover:underline">
                  Best VPS for startups
                </Link>
                <Link href="/blog/what-is-vps-hosting" className="text-accent hover:underline">
                  What is VPS hosting?
                </Link>
              </div>
            </div>

            <div className="glass rounded-2xl p-6">
              <h2 className="text-xl font-semibold tracking-tight">What we need from you</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your stack (e.g., Node, Laravel, Rails), expected traffic, data size, and whether you need backups, staging,
                or a migration.
              </p>
            </div>
          </div>

          <div className="glass rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">Get a recommendation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Share your workload details and we will respond within one business day.
            </p>
            <div className="mt-6">
              <ContactForm />
            </div>
          </div>
        </Container>
      </section>

      <section className="py-12">
        <Container className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">FAQs</h2>
            <p className="mt-2 text-sm text-muted-foreground">Define scope clearly, then ship without surprises.</p>
          </div>
          <FAQAccordion items={faqs} />
        </Container>
      </section>

      <CTASection />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </SiteShell>
  )
}
