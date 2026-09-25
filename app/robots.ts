import type { MetadataRoute } from "next"
import { getSiteUrl } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function robots(): Promise<MetadataRoute.Robots> {
  const siteUrl = await getSiteUrl()
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: "Googlebot", allow: "/" },
      { userAgent: "Googlebot-Image", allow: "/" },
      { userAgent: "Googlebot-Mobile", allow: "/" },
      { userAgent: "AdsBot-Google", allow: "/" },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
