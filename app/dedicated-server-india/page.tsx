import type { Metadata } from "next"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"

const path = "dedicated-server-india"
const title = "Dedicated Servers India | High-Performance Bare Metal"
const description = "Dedicated servers in India for high-throughput workloads needing full hardware isolation, stable network performance, and operational control."

export const metadata: Metadata = {
  title,
  description,
  keywords: ["Dedicated Servers India", "Bare Metal India", "High performance server India"],
  alternates: { canonical: absoluteUrl(`/${path}`) },
}

export default function LandingPage() {
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Dedicated Server India", path: "/dedicated-server-india" },
  ])

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-14 sm:px-5 lg:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Dedicated Server India</h1>
      <p className="mt-4 text-muted-foreground">{description}</p>
      <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <p>Designed for enterprise applications, databases, and latency-sensitive systems that outgrow shared virtualization stacks.</p>
        <p>Combine dedicated compute with managed support and clear upgrade paths from VPS to bare metal.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </main>
  )
}
