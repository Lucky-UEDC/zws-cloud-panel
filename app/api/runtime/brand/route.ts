import { NextResponse } from "next/server"
import { getPlatformConfig } from "@/lib/platform-config"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export async function GET() {
  const [site, platform] = await Promise.all([getPublicSiteSettings(), getPlatformConfig()])
  return NextResponse.json({
    brand: {
      appName: platform.name,
      brandName: platform.brand,
      legalCompanyName: site.legalCompanyName,
      siteUrl: site.siteUrl,
      clientAreaUrl: site.clientAreaUrl,
      supportEmail: site.supportEmail,
      billingEmail: site.billingEmail,
      abuseEmail: site.abuseEmail,
      supportPhone: site.supportPhone,
      whatsappNumber: site.whatsappNumber,
      telegramUsername: site.telegramUsername,
      companyAddress: site.companyAddress,
      logoUrl: platform.logo || site.logoUrl,
      faviconUrl: platform.favicon,
      footerLogoUrl: platform.footerLogo || site.footerLogoUrl,
      invoiceLogoUrl: platform.invoiceLogo || site.invoiceLogoUrl,
      openGraphImageUrl: platform.openGraphImage || site.openGraphImageUrl,
      footerDescription: site.footerDescription,
      footerCopyrightText: site.footerCopyrightText,
      publicContactBox: site.publicContactBox,
      social: {
        facebook: site.facebookUrl,
        instagram: site.instagramUrl,
        twitter: site.twitterUrl,
        telegram: site.telegramUrl,
        whatsapp: site.whatsappLink,
        discord: site.discordUrl,
        youtube: site.youtubeUrl,
      },
      primaryColor: platform.primaryColor,
    },
  })
}
