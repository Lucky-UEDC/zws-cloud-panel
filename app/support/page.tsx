import type { Metadata } from "next"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { Button } from "@/components/ui/button"
import {
  BookOpen,
  LifeBuoy,
  Mail,
  MessageCircle,
  Phone,
  ShieldAlert,
  Send,
  Wrench,
  ArrowRight,
} from "lucide-react"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Support & Help Center",
    description: `Documentation, tickets, and resources for ${site.brandName} customers.`,
    path: "/support",
  })
}

const quickLinks = [
  {
    icon: BookOpen,
    title: "Getting started guide",
    desc: "Launch your first instance, SSH in, and run a workload.",
    href: "/faq",
  },
  {
    icon: Wrench,
    title: "Server management",
    desc: "Snapshots, backups, OS reinstall, and firewall basics.",
    href: "/features",
  },
  {
    icon: MessageCircle,
    title: "Billing & account",
    desc: "Invoices, plan changes, payment methods, and renewals.",
    href: "/client-area/billing",
  },
  {
    icon: ShieldAlert,
    title: "Security & abuse",
    desc: "Report abuse, disclose vulnerabilities, and review our policies.",
    href: "/abuse",
  },
]

export default async function SupportPage() {
  const site = await getPublicSiteSettings()
  const channels = [
    { icon: Mail, label: "Support email", value: site.supportEmail, href: `mailto:${site.supportEmail}` },
    site.supportPhone ? { icon: Phone, label: "Support phone", value: site.supportPhone, href: `tel:${site.supportPhone.replace(/[^+\d]/g, "")}` } : null,
    site.whatsappLink || site.whatsappNumber ? { icon: MessageCircle, label: "WhatsApp", value: site.whatsappNumber || site.whatsappLink, href: site.whatsappLink || `https://wa.me/${site.whatsappNumber.replace(/[^\d]/g, "")}` } : null,
    site.telegramUsername || site.telegramUrl ? { icon: Send, label: "Telegram", value: site.telegramUsername ? `@${site.telegramUsername}` : site.telegramUrl, href: site.telegramUrl || `https://t.me/${site.telegramUsername}` } : null,
  ].filter(Boolean) as Array<{ icon: typeof Mail; label: string; value: string; href: string }>

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Support"
        title={`Help from ${site.brandName}, when you need it.`}
        description="Start with our documentation. If that doesn&apos;t solve it, open a ticket."
      >
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/contact">Open a ticket</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/faq">Browse FAQ</Link>
          </Button>
        </div>
      </PageHeader>

      <section className="py-16">
        <Container className="flex flex-col gap-10">
          <SectionHeader
            eyebrow="Quick links"
            title="Find what you need, faster"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {quickLinks.map(({ icon: Icon, title, desc, href }) => (
              <Link
                key={title}
                href={href}
                className="glass glass-hover group flex gap-4 rounded-2xl p-6"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{title}</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <div className="glass flex flex-col gap-4 rounded-2xl p-8">
            <div className="flex items-center gap-3">
              <LifeBuoy className="h-5 w-5 text-accent" />
              <h2 className="text-lg font-semibold">Support response targets</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              These are target response times by plan tier. Full details live in
              our SLA.
            </p>
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {channels.map(({ icon: Icon, label, value, href }) => (
                <a key={label} href={href} className="rounded-md border border-border bg-background px-4 py-3 transition-colors hover:text-accent">
                  <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4" />{label}</span>
                  <span className="mt-2 block break-words font-medium">{value}</span>
                </a>
              ))}
            </div>
            {site.companyAddress ? <p className="text-sm text-muted-foreground">Office: {site.companyAddress}</p> : null}
            <ul className="mt-2 grid gap-3 text-sm sm:grid-cols-4">
              {[
                { tier: "Starter", time: "< 6h" },
                { tier: "Business", time: "< 2h" },
                { tier: "Pro", time: "< 1h" },
                { tier: "Enterprise", time: "< 15m" },
              ].map((r) => (
                <li
                  key={r.tier}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3"
                >
                  <span className="text-muted-foreground">{r.tier}</span>
                  <span className="font-mono font-medium">{r.time}</span>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </section>
    </SiteShell>
  )
}
