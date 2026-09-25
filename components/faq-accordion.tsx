"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export type FAQ = { q: string; a: string }

export function FAQAccordion({ items }: { items: FAQ[] }) {
  return (
    <Accordion
      type="single"
      collapsible
      className="glass flex w-full flex-col gap-1 rounded-2xl p-2"
    >
      {items.map((item, i) => (
        <AccordionItem
          key={i}
          value={`item-${i}`}
          className="rounded-xl border-b-0 px-4 transition-colors data-[state=open]:bg-foreground/[0.03]"
        >
          <AccordionTrigger className="py-5 text-left text-base font-medium hover:no-underline">
            {item.q}
          </AccordionTrigger>
          <AccordionContent className="pb-5 text-sm leading-relaxed text-muted-foreground">
            {item.a}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
