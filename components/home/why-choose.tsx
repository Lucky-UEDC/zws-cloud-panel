import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"

const pillars = [
  {
    k: "Reliability",
    v: "99.99%",
    desc: "Target monthly uptime across regions, backed by a clear SLA.",
  },
  {
    k: "Support response",
    v: "< 15 min",
    desc: "Median first-response time for priority support tickets.",
  },
  {
    k: "Hardware refresh",
    v: "3 yrs",
    desc: "Rolling hardware replacement cycle across our fleet.",
  },
  {
    k: "Pricing clarity",
    v: "Local",
    desc: "Predictable traffic quota included upfront — no surprise egress billing.",
  },
  {
    k: "Network fabric",
    v: "1.8 Tbps",
    desc: "Aggregate datacenter-grade fabric capacity, with plan bandwidth shown separately.",
  },
]

export function WhyChoose({ brandName = "Cloud" }: { brandName?: string }) {
  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow={`Why ${brandName}`}
          title="Operational clarity, not marketing theater"
          description="We optimize for the things teams actually feel — stable infrastructure, clean support, and predictable bills."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {pillars.map((p) => (
            <div
              key={p.k}
              className="glass glass-hover flex flex-col gap-2 rounded-2xl p-6"
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {p.k}
              </div>
              <div className="text-3xl font-semibold tracking-tight">
                {p.v}
              </div>
              <p className="text-sm text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
