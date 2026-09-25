import type { Metadata } from "next"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

type Robots = Metadata["robots"]

type PageMetadataInput = {
  title: string
  description: string
  path?: string
  robots?: Robots
  image?: string
  type?: "website" | "article"
}

function joinUrl(baseUrl: string, path = "/") {
  const base = baseUrl.replace(/\/+$/g, "")
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${base}${normalizedPath}`
}

export async function buildPageMetadata(input: PageMetadataInput): Promise<Metadata> {
  const settings = await getPublicSiteSettings()
  const canonical = joinUrl(settings.siteUrl, input.path || "/")
  const fullTitle = `${input.title} | ${settings.brandName}`
  const image = input.image || settings.openGraphImageUrl || settings.logoUrl
  return {
    metadataBase: new URL(settings.siteUrl),
    title: fullTitle,
    description: input.description,
    authors: [{ name: settings.brandName }],
    alternates: { canonical },
    robots: input.robots,
    openGraph: {
      title: fullTitle,
      description: input.description,
      url: canonical,
      siteName: settings.brandName,
      type: input.type || "website",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: fullTitle,
      description: input.description,
      images: image ? [image] : undefined,
    },
  }
}

export async function buildRootMetadata(): Promise<Metadata> {
  const settings = await getPublicSiteSettings()
  const title = settings.metaTitle || `Cloud Compute Instances India | ${settings.brandName}`
  const description = settings.metaDescription || "High-performance NVMe-powered cloud compute instances with instant deployment and predictable pricing."
  const keywords = settings.metaKeywords
    ? settings.metaKeywords.split(",").map((item) => item.trim()).filter(Boolean)
    : [
        "cloud compute instances India",
        "compute instances India",
        "NVMe compute instances India",
        "cloud server Mumbai",
        "cloud server Bangalore",
        "cloud compute Delhi NCR",
        "KVM compute instances India",
        "hourly billing compute instances India",
        "dedicated servers",
        settings.brandName,
      ]
  const image = settings.openGraphImageUrl || settings.logoUrl
  return {
    metadataBase: new URL(settings.siteUrl),
    title: {
      default: title,
      template: `%s · ${settings.brandName}`,
    },
    description,
    keywords,
    authors: [{ name: settings.brandName }],
    alternates: { canonical: settings.siteUrl },
    openGraph: {
      title,
      description,
      type: "website",
      url: settings.siteUrl,
      siteName: settings.brandName,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  }
}
