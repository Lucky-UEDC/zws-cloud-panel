import type { Metadata } from "next"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"

const path = "gaming-server-hosting-india"
const title = "Gaming Cloud VPS Platform India | Low-Latency Game Servers"
const description = "Gaming VPS hosting in India for Minecraft, FiveM, and multiplayer workloads with low latency, high clock performance, and NVMe storage."

export const metadata: Metadata = {
  title,
  description,
  keywords: ["Gaming Cloud VPS Platform", "Gaming Server Hosting India", "Low latency VPS India"],
  alternates: { canonical: absoluteUrl(`/${path}`) },
}

export default function LandingPage() {
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Gaming Server Hosting India", path: "/gaming-server-hosting-india" },
  ])

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-14 sm:px-5 lg:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Gaming Server Hosting India</h1>
      <p className="mt-4 text-muted-foreground">{description}</p>
      <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <p>Launch private game worlds with stable network routes and fast storage for map loads, plugins, and mod packs.</p>
        <p>Scale from starter VPS nodes to dedicated capacity while keeping player latency low in India-region traffic.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
    </main>
  )
}
