import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { ContactForm } from "@/components/contact/contact-form"
import { Mail, LifeBuoy, ShieldAlert, Phone, MessageCircle, Send, MapPin } from "lucide-react"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Contact",
    description: `Get in touch with the ${site.brandName} team for sales, support, billing, and abuse reports.`,
    path: "/contact",
  })
}

export default async function ContactPage() {
  const site = await getPublicSiteSettings()
  const channels = [
    {
      icon: Mail,
      title: "Sales & partnerships",
      desc: "For pricing, custom quotes, and enterprise conversations.",
      value: site.salesEmail,
      href: `mailto:${site.salesEmail}`,
    },
    {
      icon: LifeBuoy,
      title: "Customer support",
      desc: "Existing customers should open a ticket for the fastest response.",
      value: site.supportEmail,
      href: `mailto:${site.supportEmail}`,
    },
    {
      icon: ShieldAlert,
      title: "Abuse & security",
      desc: "Report abuse, vulnerabilities, or policy violations.",
      value: site.abuseEmail,
      href: `mailto:${site.abuseEmail}`,
    },
    site.companyPhone ? {
      icon: Phone,
      title: "Phone",
      desc: "Use this number for urgent business or billing conversations.",
      value: site.companyPhone,
      href: `tel:${site.companyPhone.replace(/[^+\d]/g, "")}`,
    } : null,
    site.whatsappLink || site.whatsappNumber ? {
      icon: MessageCircle,
      title: "WhatsApp",
      desc: "Message the support team through the configured business channel.",
      value: site.whatsappNumber || site.whatsappLink,
      href: site.whatsappLink || `https://wa.me/${site.whatsappNumber.replace(/[^\d]/g, "")}`,
    } : null,
    site.telegramUsername || site.telegramUrl ? {
      icon: Send,
      title: "Telegram",
      desc: "Reach the team using the public Telegram contact.",
      value: site.telegramUsername ? `@${site.telegramUsername}` : site.telegramUrl,
      href: site.telegramUrl || `https://t.me/${site.telegramUsername}`,
    } : null,
    site.companyAddress ? {
      icon: MapPin,
      title: "Address",
      desc: "Registered or public business contact address.",
      value: site.companyAddress,
      href: "#contact-form",
    } : null,
  ].filter(Boolean) as Array<{ icon: typeof Mail; title: string; desc: string; value: string; href: string }>

  return (
    <SiteShell>
      <PageHeader
        eyebrow="Contact"
        title={`Talk to ${site.brandName}.`}
        description="We triage every message and route it to the right team."
      />
      <section className="py-16">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div className="flex flex-col gap-6">
            {channels.map(({ icon: Icon, title, desc, value, href }) => (
              <a
                key={title}
                href={href}
                className="glass glass-hover group flex gap-4 rounded-xl p-5"
              >
                <div className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-accent">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold">{title}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                  <p className="mt-2 font-mono text-xs text-accent group-hover:underline">
                    {value}
                  </p>
                </div>
              </a>
            ))}
          </div>

          <div id="contact-form" className="glass rounded-xl p-6 sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">
              Send us a message
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us about your workload or question. We&apos;ll respond directly.
            </p>
            <div className="mt-6">
              <ContactForm supportEmail={site.supportEmail} />
            </div>
          </div>
        </Container>
      </section>
    </SiteShell>
  )
}
