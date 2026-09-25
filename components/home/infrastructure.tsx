import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { Globe, Server, Network } from "lucide-react"

const regions = [
  { code: "BOM", city: "Mumbai, IN", status: "Live" },
  { code: "BLR", city: "Bengaluru, IN", status: "Live" },
  { code: "SIN", city: "Singapore", status: "Live" },
  { code: "FRA", city: "Frankfurt, DE", status: "Live" },
  { code: "NYC", city: "New York, US", status: "Live" },
  { code: "LON", city: "London, UK", status: "Coming soon" },
]

export function Infrastructure() {
  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow="Infrastructure"
          title="A global footprint, built for low latency"
          description="Deploy close to your users and stay resilient with multi-region redundancy."
        />
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-4">
            <Stat icon={Globe} title="6 regions" desc="Across Asia, Europe, and North America." />
            <Stat icon={Server} title="Tier III+ facilities" desc="N+1 power, cooling, and network redundancy." />
            <Stat icon={Network} title="Private networking" desc="Low-latency interconnects between your nodes." />
          </div>

          <div className="glass overflow-hidden rounded-2xl p-2">
            <div className="grid grid-cols-[auto_1fr_auto] gap-x-6 rounded-xl px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground">
              <span className="font-medium">Code</span>
              <span className="font-medium">Location</span>
              <span className="text-right font-medium">Status</span>
            </div>
            <ul className="flex flex-col gap-1">
              {regions.map((r) => (
                <li
                  key={r.code}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-x-6 rounded-xl px-4 py-3 text-sm transition-colors hover:bg-foreground/[0.035]"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {r.code}
                  </span>
                  <span className="font-medium">{r.city}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs ${
                      r.status === "Live"
                        ? "text-accent"
                        : "text-muted-foreground"
                    }`}
                  >
                    <span className="relative inline-flex h-1.5 w-1.5">
                      {r.status === "Live" && (
                        <span className="status-pulse absolute inset-0 rounded-full bg-accent" />
                      )}
                      <span
                        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                          r.status === "Live" ? "bg-accent" : "bg-muted-foreground/60"
                        }`}
                      />
                    </span>
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  )
}

function Stat({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Globe
  title: string
  desc: string
}) {
  return (
    <div className="glass glass-hover flex gap-4 rounded-2xl p-5">
      <div className="glass flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-accent">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
    </div>
  )
}
