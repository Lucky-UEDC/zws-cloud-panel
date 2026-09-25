import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { FAQAccordion } from "@/components/faq-accordion"
import { homeFaqs } from "@/lib/data/faqs"

export function HomeFaq() {
  return (
    <section className="py-20 sm:py-24">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <SectionHeader
              eyebrow="FAQ"
              title="Questions, answered."
              description="The things teams ask us most often. Can't find what you need?"
            />
            <Link
              href="/support"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              Browse help center
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <FAQAccordion items={homeFaqs} />
        </div>
      </Container>
    </section>
  )
}
