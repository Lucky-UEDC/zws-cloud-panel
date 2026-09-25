import { publicOrigin, configuredSiteDomain } from "@/lib/public-url"
export { footerNav, footerSections, primaryNav, publicSitemapRoutes, requiredFooterRoutes } from "@/lib/navigation"

const siteDomain = configuredSiteDomain()
const siteName = process.env.SITE_NAME || process.env.APP_NAME || process.env.NEXT_PUBLIC_APP_NAME || "Cloud"
const supportEmail = siteDomain ? `support@${siteDomain}` : "support@example.com"

export const siteConfig = {
  name: siteName,
  shortName: process.env.SITE_SHORT_NAME || siteName,
  description:
    "Premium compute instances, cloud hosting, and custom infrastructure with transparent pricing.",
  url: publicOrigin(),
  contact: {
    email: siteDomain ? `hello@${siteDomain}` : supportEmail,
    support: supportEmail,
    abuse: siteDomain ? `abuse@${siteDomain}` : supportEmail,
    phone: "+91 77500 08100",
    address: `${siteName}, Mumbai, Maharashtra, India`,
  },
  social: {
    twitter: "https://x.com",
    linkedin: "https://linkedin.com",
  },
}
