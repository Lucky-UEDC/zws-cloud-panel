import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { TestimonialCard } from "@/components/testimonial-card"

const items = (brandName: string) => [
  {
    quote:
      `Migrating to ${brandName} cut our provisioning time from hours to under a minute. Support has been genuinely responsive.`,
    author: "Ananya Rao",
    role: "Head of Platform",
    company: "Finstack",
  },
  {
    quote:
      "The custom configurator let us spec machines exactly how we wanted. No awkward upsells, no surprise bills.",
    author: "Michael Chen",
    role: "Staff Engineer",
    company: "Northwave",
  },
  {
    quote:
      "Consistent NVMe performance and sensible defaults. It feels like infrastructure built by people who run infrastructure.",
    author: "Priya Nair",
    role: "CTO",
    company: "Kelvin Labs",
  },
]

export function Testimonials({ brandName = "Cloud" }: { brandName?: string }) {
  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow={`Teams on ${brandName}`}
          title="What our customers say"
          description="Sample reviews. Replace with verified customer quotes before production launch."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {items(brandName).map((t) => (
            <TestimonialCard key={t.author} {...t} />
          ))}
        </div>
      </Container>
    </section>
  )
}
