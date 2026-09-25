import { Container } from "@/components/layout/container"
import { PageHeader } from "@/components/layout/page-header"
import Link from "next/link"
import { SiteShell } from "@/components/layout/site-shell"
import { legalNavLinks } from "@/lib/navigation"

export function LegalPageLayout({
  title,
  lastUpdated,
  brandName = "the platform",
  children,
}: {
  title: string
  lastUpdated: string
  brandName?: string
  children: React.ReactNode
}) {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Legal"
        title={title}
        description={`Last updated: ${lastUpdated}. These terms describe how ${brandName} operates its website, customer accounts, and services.`}
      />
      <Container className="py-10 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Legal
              </h2>
              <nav className="mt-4 flex flex-col gap-1 text-sm">
                {legalNavLinks.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
          </aside>
          <article className="legal-article max-w-4xl text-pretty">
            {children}
          </article>
        </div>
      </Container>
    </SiteShell>
  )
}

export function LegalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-7 flex flex-col gap-3">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground [&_a]:text-accent [&_a]:underline [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  )
}

export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 flex list-disc flex-col gap-2 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
