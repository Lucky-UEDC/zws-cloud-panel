import type { FAQ } from "@/components/faq-accordion"

export const homeFaqs: FAQ[] = [
  {
    q: "How fast can I deploy a server?",
    a: "Most compute instances are provisioned and reachable via SSH in under 60 seconds. Custom configurations or first-time KYC verification may take slightly longer.",
  },
  {
    q: "What payment cycles do you support?",
    a: "Monthly, quarterly (5% discount), and annual (approximately 17% discount). You can upgrade or downgrade at any time; we pro-rate the difference.",
  },
  {
    q: "Do I get full root access?",
    a: "Yes. Every compute instance ships with full root or Administrator access. Install any OS, run any workload within our Acceptable Use Policy.",
  },
  {
    q: "What is your refund policy?",
    a: "New compute instance orders include a 7-day refund window, subject to our Refund Policy. Dedicated servers and pre-paid annual plans follow separate terms detailed in the Refund Policy page.",
  },
  {
    q: "How is support structured?",
    a: "All customers get ticket and email support with a target 15-minute first-response on priority issues. Enterprise plans include 24/7 support with defined response SLAs.",
  },
  {
    q: "Is KYC required?",
    a: "For most plans, a lightweight identity verification is required before first deployment. This helps us prevent abuse and keeps the network healthy for everyone. See our KYC Policy for details.",
  },
  {
    q: "How is abuse handled?",
    a: "We take abuse seriously and investigate every report. Reports can be submitted to the abuse address configured for the site; see the Abuse Reporting page for procedures and response times.",
  },
  {
    q: "Do you offer backups and snapshots?",
    a: "Yes. All plans support on-demand snapshots. Business and higher tiers include scheduled, encrypted backups with configurable retention.",
  },
]
