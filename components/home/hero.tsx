import Link from "next/link"
import { ArrowRight, Terminal, Activity, ShieldCheck, Network } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Container } from "@/components/layout/container"
import { LiveStatusCard } from "@/components/home/live-status-card"

export function Hero({ customConfigurationEnabled = false, brandName = "Cloud" }: { customConfigurationEnabled?: boolean; brandName?: string }) {
  return (
    <section className="relative overflow-hidden">
      {/* Soft ambient accent glow to lift the hero over the global dot field. */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-accent/5 blur-3xl" />

      <Container className="relative py-20 sm:py-28 lg:py-32">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="flex flex-col gap-6">
            <Link
              href="/infrastructure"
              className="glass glass-hover inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="status-pulse absolute inset-0 rounded-full bg-accent" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              New region: Mumbai added · 99.99% uptime
              <ArrowRight className="h-3 w-3" />
            </Link>

            <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-[4.25rem] lg:leading-[1.02]">
              Enterprise Cloud Compute{" "}
              <span className="text-muted-foreground">for Growing Businesses.</span>
            </h1>

            <p className="max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
              Scalable compute instances on NVMe infrastructure. Launch production-ready virtual servers in under 60 seconds with localized pricing and a 99.99% uptime SLA.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-1.5">
                <Link href={customConfigurationEnabled ? "/configure" : "/pricing"}>
                  Start deploying
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">View plans</Link>
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                DDoS protected
              </span>
              <span className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-accent" />
                99.99% uptime SLA
              </span>
              <span className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-accent" />
                Full root access
              </span>
              <span className="flex items-center gap-2">
                <Network className="h-4 w-4 text-accent" />
                Datacenter-grade network fabric up to 1.8 Tbps aggregate capacity
              </span>
            </div>
          </div>

          <LiveStatusCard brandLabel={brandName} />
        </div>
      </Container>
    </section>
  )
}
