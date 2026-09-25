import type { MetadataRoute } from "next"
import { getPlatformConfig } from "@/lib/platform-config"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [platform, site] = await Promise.all([getPlatformConfig(), getPublicSiteSettings()])
  return {
    name: platform.name,
    short_name: platform.brand,
    description: `${platform.brand} cloud platform`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0b0d",
    theme_color: platform.primaryColor || "#14b8a6",
    icons: [
      { src: platform.logo || site.logoUrl || "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-light-32x32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  }
}
