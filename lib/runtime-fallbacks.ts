import type { PublicSiteSettings } from "@/lib/settings/site-settings"
import type { PlatformConfig } from "@/lib/platform-config"
import type { RuntimeConfig } from "@/lib/runtime-config"

function appName() {
  return String(process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud").trim() || "Cloud"
}

function siteUrl() {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "")
  if (configured) return configured
  const domain = String(process.env.SITE_DOMAIN || "").trim()
  return domain ? `https://${domain}` : "https://example.com"
}

export function fallbackPublicSiteSettings(): PublicSiteSettings {
  const brandName = appName()
  const url = siteUrl()
  const domain = url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
  const supportEmail = domain && domain !== "example.com" ? `support@${domain}` : "support@example.com"
  return {
    companyName: brandName,
    brandName,
    legalCompanyName: `${brandName} Services`,
    websiteName: brandName,
    tagline: "",
    registrationNumber: "",
    companyEmail: supportEmail,
    supportEmail,
    billingEmail: supportEmail,
    salesEmail: supportEmail,
    abuseEmail: supportEmail,
    companyPhone: "",
    supportPhone: "",
    whatsappNumber: "",
    telegramUsername: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    zipCode: "",
    country: "",
    gstNumber: "",
    vatNumber: "",
    companyAddress: "",
    footerDescription: "Professional cloud infrastructure and compute automation",
    footerCopyrightText: "",
    publicContactBox: "",
    siteUrl: url,
    clientAreaUrl: `${url}/client-area`,
    logoUrl: "",
    faviconUrl: "",
    footerLogoUrl: "",
    invoiceLogoUrl: "",
    openGraphImageUrl: "",
    facebookUrl: "",
    instagramUrl: "",
    twitterUrl: "",
    telegramUrl: "",
    whatsappLink: "",
    discordUrl: "",
    youtubeUrl: "",
    metaTitle: "",
    metaDescription: "",
    metaKeywords: "",
    googleAnalyticsId: "",
    termsUrl: `${url}/legal/terms`,
    privacyUrl: `${url}/legal/privacy`,
    refundPolicyUrl: `${url}/legal/refund`,
    abusePolicyUrl: `${url}/legal/aup`,
    currency: "INR",
    aboutCompanyHeadline: `${brandName} is building reliable cloud infrastructure for production teams.`,
    aboutCompanyDescription: `${brandName} focuses on stable compute, transparent pricing, and responsive support.`,
    missionStatement: "",
    visionStatement: "",
    founder: {
      enabled: false,
      visible: false,
      name: "",
      age: null,
      photoUrl: "",
      title: "",
      experienceYears: null,
      specialties: [],
      shortBio: "",
      longDescription: "",
      linkedInUrl: "",
      xUrl: "",
      email: "",
      location: "",
    },
  }
}

export function fallbackPlatformConfig(): PlatformConfig {
  const name = appName()
  return {
    name,
    brand: name,
    logo: "",
    favicon: "",
    footerLogo: "",
    invoiceLogo: "",
    openGraphImage: "",
    primaryColor: "#14b8a6",
  }
}

export function fallbackRuntimeConfig(): RuntimeConfig {
  const platform = fallbackPlatformConfig()
  const site = fallbackPublicSiteSettings()
  const now = new Date().toISOString()
  return {
    analytics: {
      gaId: "",
      metaPixelId: "",
      tawkPropertyId: "",
      crispWebsiteId: "",
      customHeadScript: "",
      customBodyScript: "",
      updatedAt: now,
      version: 1,
    },
    branding: {
      name: platform.name,
      brandName: platform.brand,
      legalCompanyName: site.legalCompanyName,
      logo: "",
      favicon: "",
      siteUrl: site.siteUrl,
    },
    updatedAt: now,
    version: 1,
  }
}
