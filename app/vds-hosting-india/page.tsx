import type { Metadata } from "next"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"

const path = "vds-hosting-india"
const title = "VDS Hosting India | Virtual Dedicated Servers"
const description = "VDS hosting in India with dedicated resource guarantees, fast storage, and managed control for production workloads."

export const metadata: Metadata = {
  title,
  description,
  keywords: ["VDS Hosting India", "Virtual Dedicated Server India", "NVMe VPS India"],
  alternates: { canonical: absoluteUrl(`/${path}`) },
}

export default function LandingPage() {
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "VDS Hosting India", path: "/vds-hosting-india" },
  ])

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-14 sm:px-5 lg:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">VDS Hosting India</h1>
      <p className="mt-4 text-muted-foreground">{description}</p>
      <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <p>For workloads that require guaranteed performance isolation without moving to full bare metal infrastructure.</p>
        <p>Ideal for control panels, game infrastructure, and enterprise applications with sustained CPU and memory demands.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </main>
  )
}
