import Link from "next/link"
import Image from "next/image"
import { Container } from "@/components/layout/container"
import { Logo } from "@/components/brand/logo"
import { footerSections } from "@/lib/navigation"
import { Facebook, Instagram, MessageCircle, Send, Twitter, Youtube } from "lucide-react"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export async function Footer() {
  const site = await getPublicSiteSettings()
  const legalHref: Record<string, string> = {
    "/legal/terms": site.termsUrl,
    "/legal/privacy": site.privacyUrl,
    "/legal/refund": site.refundPolicyUrl,
    "/legal/aup": site.abusePolicyUrl,
  }
  const visibleFooterSections = footerSections.map((section) => ({
    ...section,
    links: section.links.map((item) => ({ ...item, href: legalHref[item.href] || item.href })),
  }))
  const socialLinks = [
    { href: site.facebookUrl, label: "Facebook", icon: Facebook },
    { href: site.instagramUrl, label: "Instagram", icon: Instagram },
    { href: site.twitterUrl, label: "X/Twitter", icon: Twitter },
    { href: site.telegramUrl, label: "Telegram", icon: Send },
    { href: site.whatsappLink, label: "WhatsApp", icon: MessageCircle },
    { href: site.youtubeUrl, label: "YouTube", icon: Youtube },
  ].filter((item) => item.href)
  return (
    <footer className="mt-20 border-t border-border/50 bg-background/70 backdrop-blur-sm" aria-label="Site footer">
      <Container className="py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)]">
          <div className="max-w-sm">
            {site.footerLogoUrl ? (
              <Link href="/" aria-label={`${site.brandName} home`} className="inline-flex items-center gap-2">
                <Image src={site.footerLogoUrl} alt="" width={32} height={32} unoptimized className="h-8 w-8 rounded-md object-contain" />
                <span className="font-semibold tracking-tight">{site.brandName}</span>
              </Link>
            ) : (
              <Logo initialBrandName={site.brandName} />
            )}
            <p className="mt-4 max-w-xs text-sm text-muted-foreground text-pretty">
              {site.footerDescription}
            </p>
            {site.publicContactBox ? <p className="mt-3 max-w-xs text-sm text-muted-foreground">{site.publicContactBox}</p> : null}
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              <p>{site.supportEmail}</p>
              {site.supportPhone ? <p>{site.supportPhone}</p> : null}
              {site.companyAddress ? <p>{site.companyAddress}</p> : null}
            </div>
            <div className="mt-6 flex items-center gap-2">
              {socialLinks.map(({ href, label, icon: Icon }) => (
                <SocialIcon key={label} href={href} label={label}>
                  <Icon className="h-4 w-4" />
                </SocialIcon>
              ))}
            </div>
          </div>

          <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-6 gap-y-9 sm:grid-cols-3 xl:grid-cols-5">
          {visibleFooterSections.map((section) => (
            <div key={section.title} className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                {section.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {section.links.map((item) => (
                  <li key={`${section.title}-${item.href}-${item.label}`}>
                    <Link
                      href={item.href}
                      aria-label={`${item.label} page`}
                      className="inline-flex rounded-sm text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 pt-8 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>
            {site.footerCopyrightText || `Copyright ${new Date().getFullYear()} ${site.brandName}. All rights reserved.`}
          </p>
          <p>
            <Link href={site.termsUrl || "/legal/terms"} className="transition-colors hover:text-foreground">Terms</Link>
            {" · "}
            <Link href={site.privacyUrl || "/legal/privacy"} className="transition-colors hover:text-foreground">Privacy</Link>
            {" · "}
            <Link href="/support" className="transition-colors hover:text-foreground">Support</Link>
          </p>
        </div>
      </Container>
    </footer>
  )
}

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="glass glass-hover inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  )
}
