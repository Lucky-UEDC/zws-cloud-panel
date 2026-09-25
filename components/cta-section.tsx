import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Container } from "@/components/layout/container"
import { Button } from "@/components/ui/button"

export function CTASection({ customConfigurationEnabled = false }: { customConfigurationEnabled?: boolean }) {
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <div className="glass glass-strong accent-glow relative overflow-hidden rounded-3xl p-10 sm:p-14">
          {/* Soft accent halo */}
          <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[rgba(20,184,166,0.08)] blur-3xl" />
          <div className="pointer-events-none absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-[rgba(20,184,166,0.06)] blur-3xl" />

          <div className="relative flex flex-col items-start gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Deploy in minutes. Scale with confidence.
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground sm:text-lg">
                Spin up a cloud instance or talk with our team about enterprise-grade infrastructure.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-1.5">
                <Link href={customConfigurationEnabled ? "/configure" : "/pricing"}>
                  Deploy now
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/contact">Talk to sales</Link>
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  )
}
