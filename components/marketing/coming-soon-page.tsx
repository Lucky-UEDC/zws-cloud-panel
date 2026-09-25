import Link from "next/link"
import { ArrowRight, Headphones, Home, Sparkles } from "lucide-react"
import { SiteShell } from "@/components/layout/site-shell"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"
import type { ComingSoonRoute } from "@/lib/coming-soon-routes"

export function ComingSoonPage({ route }: { route: ComingSoonRoute }) {
  return (
    <SiteShell>
      <main className="py-16 sm:py-20 lg:py-24">
        <Container>
          <section className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-border/50 bg-card/60">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-3 py-1 text-sm font-medium text-[var(--text-selected)]">
                  <Sparkles className="h-4 w-4" />
                  Coming soon
                </div>

                <h1 className="mt-6 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  {route.title}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
                  {route.description}
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="gap-2">
                    <Link href="/">
                      <Home className="h-4 w-4" />
                      Back to Home
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="gap-2">
                    <Link href="/support">
                      <Headphones className="h-4 w-4" />
                      Contact Support
                    </Link>
                  </Button>
                  {route.showExplorePlans ? (
                    <Button asChild size="lg" variant="outline" className="gap-2">
                      <Link href="/pricing">
                        Explore plans
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>

              <aside className="border-t border-border/50 bg-background/35 p-6 sm:p-8 lg:border-l lg:border-t-0">
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {route.pageName}
                </p>
                <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
                  <p>
                    This public URL is reserved, so visitors do not land on a missing-page state while the full page is finished.
                  </p>
                  <p>
                    Existing product, pricing, support, and account flows remain available.
                  </p>
                </div>
              </aside>
            </div>
          </section>
        </Container>
      </main>
    </SiteShell>
  )
}
