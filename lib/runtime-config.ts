import { revalidateTag, unstable_cache } from "next/cache"
import { prisma } from "@/lib/db"
import { getPlatformConfig } from "@/lib/platform-config"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"
import { fallbackPlatformConfig, fallbackPublicSiteSettings, fallbackRuntimeConfig } from "@/lib/runtime-fallbacks"

export const RUNTIME_CONFIG_TAG = "runtime-config"

export type RuntimeConfig = {
  analytics: {
    gaId: string
    metaPixelId: string
    tawkPropertyId: string
    crispWebsiteId: string
    customHeadScript: string
    customBodyScript: string
    updatedAt: string
    version: number
  }
  branding: {
    name: string
    brandName: string
    legalCompanyName: string
    logo: string
    favicon: string
    siteUrl: string
  }
  updatedAt: string
  version: number
}

function clean(value: unknown) {
  return String(value || "").trim()
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const [row, site, platform] = await Promise.all([
    (prisma as any).systemSetting.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } }).catch(() => null),
    getPublicSiteSettings().catch(fallbackPublicSiteSettings),
    getPlatformConfig().catch(fallbackPlatformConfig),
  ])
  const analyticsUpdatedAt = row?.analyticsUpdatedAt || row?.updatedAt || new Date()
  const updatedAt = row?.updatedAt || analyticsUpdatedAt
  const analyticsVersion = Number(row?.analyticsVersion || 1)
  return {
    analytics: {
      gaId: clean(row?.googleAnalyticsId),
      metaPixelId: clean(row?.metaPixelId),
      tawkPropertyId: clean(row?.tawkPropertyId),
      crispWebsiteId: clean(row?.crispWebsiteId),
      customHeadScript: String(row?.customHeadScript || ""),
      customBodyScript: String(row?.customBodyScript || ""),
      updatedAt: analyticsUpdatedAt?.toISOString?.() || String(analyticsUpdatedAt || ""),
      version: analyticsVersion,
    },
    branding: {
      name: platform.name,
      brandName: platform.brand,
      legalCompanyName: site.legalCompanyName,
      logo: platform.logo || site.logoUrl || "",
      favicon: platform.favicon || "",
      siteUrl: site.siteUrl,
    },
    updatedAt: updatedAt?.toISOString?.() || String(updatedAt || ""),
    version: analyticsVersion,
  }
}

const getCachedRuntimeConfig = unstable_cache(loadRuntimeConfig, ["runtime-config"], {
  tags: [RUNTIME_CONFIG_TAG],
  revalidate: false,
})

export async function getRuntimeConfig() {
  return getCachedRuntimeConfig().catch(fallbackRuntimeConfig)
}

export function revalidateRuntimeConfig() {
  revalidateTag(RUNTIME_CONFIG_TAG, "max")
}
