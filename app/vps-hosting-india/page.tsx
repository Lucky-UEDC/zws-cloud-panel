import type { Metadata } from "next"
import { absoluteUrl, breadcrumbJsonLd } from "@/lib/seo"
import { getBrandName } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

const path = "vps-hosting-india"
const title = "Cloud Compute Instances India | Deploy NVMe Linux & Windows Instances"
const description = "Deploy compute instances in India with NVMe storage, full root access, low-latency routes, and predictable pricing for Linux and Windows workloads."

export const metadata: Metadata = {
  title,
  description,
  keywords: [
    "Cloud compute instances India",
    "Deploy compute instance India",
    "NVMe compute instances India",
    "Affordable cloud compute instances India",
    "Linux compute instances India",
    "Windows compute instances India",
  ],
  alternates: { canonical: absoluteUrl(`/${path}`) },
}

export default async function LandingPage() {
  const brandName = await getBrandName()
  const breadcrumbLd = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Cloud Compute Instances India", path: "/vps-hosting-india" },
  ])

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Cloud VPS Platform India",
    description,
    brand: { "@type": "Brand", name: brandName },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: absoluteUrl("/pricing"),
    },
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-14 sm:px-5 lg:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Cloud Compute Instances India</h1>
      <p className="mt-4 text-muted-foreground">{description}</p>
      <div className="mt-8 grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
        <p>Deploy Linux and Windows compute instances in minutes with stable automation and transparent billing.</p>
        <p>Suitable for production apps, SaaS control panels, game servers, and CI workloads that need consistent NVMe disk performance.</p>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }} />
    </main>
  )
}
