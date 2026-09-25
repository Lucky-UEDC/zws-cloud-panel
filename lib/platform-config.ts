import { getBrandSettings, getSetting, type AppearanceSettings, type PlatformSettings } from "@/lib/settings"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export type PlatformConfig = {
  name: string
  brand: string
  logo: string
  favicon: string
  footerLogo: string
  invoiceLogo: string
  openGraphImage: string
  primaryColor: string
}

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const [site, brand, platform, appearance] = await Promise.all([
    getPublicSiteSettings().catch(() => null),
    getBrandSettings().catch(() => null),
    getSetting<PlatformSettings>("platform_settings").catch(() => null),
    getSetting<AppearanceSettings>("appearance_settings").catch(() => null),
  ])

  const fallbackName = process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud"
  const name = String(platform?.appName || brand?.appName || site?.brandName || fallbackName).trim() || fallbackName
  const brandName = String(platform?.brandName || brand?.brandName || site?.brandName || name).trim() || name

  return {
    name,
    brand: brandName,
    logo: String(appearance?.logoUrl || brand?.logoUrl || site?.logoUrl || "").trim(),
    favicon: String(appearance?.faviconUrl || brand?.faviconUrl || site?.faviconUrl || "").trim(),
    footerLogo: String(appearance?.footerLogoUrl || brand?.footerLogoUrl || site?.footerLogoUrl || appearance?.logoUrl || brand?.logoUrl || site?.logoUrl || "").trim(),
    invoiceLogo: String(appearance?.invoiceLogoUrl || brand?.invoiceLogoUrl || site?.invoiceLogoUrl || appearance?.logoUrl || brand?.logoUrl || site?.logoUrl || "").trim(),
    openGraphImage: String(appearance?.openGraphImageUrl || brand?.openGraphImageUrl || site?.openGraphImageUrl || appearance?.logoUrl || brand?.logoUrl || site?.logoUrl || "").trim(),
    primaryColor: String(appearance?.accentColor || appearance?.primaryColor || brand?.primaryColor || "#14b8a6").trim(),
  }
}
