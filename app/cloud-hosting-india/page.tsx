import type { Metadata } from "next"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"

const path = "cloud-hosting-india"
const title = "Cloud VPS Platform India | Scalable Cloud Servers"
const description = "Cloud VPS hosting in India for startups and growing teams, with elastic plans, rapid provisioning, and NVMe-backed performance."

export const metadata: Metadata = {
  title,
  description,
  keywords: ["Cloud VPS Platform", "Cloud Hosting India", "Deploy Cloud Instance India", "NVMe VPS India"],
  alternates: { canonical: absoluteUrl(`/${path}`) },
}

export default function LandingPage() {
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Cloud Hosting India", path: "/cloud-hosting-india" },
  ])

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-14 sm:px-5 lg:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Cloud Hosting India</h1>
      <p className="mt-4 text-muted-foreground">{description}</p>
      <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <p>Build resilient workloads with predictable performance, instant scale-up paths, and workload isolation across VPS tiers.</p>
        <p>Optimized for app hosting, API backends, and workloads that need high IOPS with Indian network locality.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </main>
  )
}
