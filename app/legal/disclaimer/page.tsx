import type { Metadata } from "next"
import { LegalPageLayout, LegalSection } from "@/components/layout/legal-page"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Disclaimer",
    description: `Website and service information disclaimer for ${site.brandName}.`,
    path: "/legal/disclaimer",
  })
}

export default async function DisclaimerPage() {
  const site = await getPublicSiteSettings()
  return (
    <LegalPageLayout title="Disclaimer" lastUpdated="January 1, 2026" brandName={site.brandName}>
      <LegalSection title="Content notice">
        <p>
          All content on this website, including pricing, service descriptions,
          and infrastructure details, is provided for general information about
          {site.brandName}. Specific figures, guarantees, certifications, or endorsements should
          be independently verified before relying on them commercially.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          Information on this website is provided &ldquo;as is&rdquo; without warranty of
          any kind, express or implied. We do not warrant that information is
          accurate, complete, or current.
        </p>
      </LegalSection>

      <LegalSection title="External links">
        <p>
          Links to third-party sites are provided for convenience. We are not
          responsible for the content, accuracy, or practices of external sites.
        </p>
      </LegalSection>

      <LegalSection title="Legal advice">
        <p>
          Nothing on this website constitutes legal, tax, or professional
          advice. Consult qualified professionals for specific advice relating
          to your circumstances.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
