import type { Metadata } from "next"
import { LegalPageLayout, LegalSection, LegalList } from "@/components/layout/legal-page"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Cookie Policy",
    description: `Cookie policy for ${site.brandName}, including essential, preference, and analytics cookie use.`,
    path: "/legal/cookies",
  })
}

export default async function CookiePage() {
  const site = await getPublicSiteSettings()
  return (
    <LegalPageLayout title="Cookie Policy" lastUpdated="January 1, 2026" brandName={site.brandName}>
      <LegalSection title="What are cookies">
        <p>
          Cookies are small text files placed on your device by websites you
          visit. They are widely used to make websites work more efficiently
          and to provide reporting information.
        </p>
      </LegalSection>

      <LegalSection title="How we use cookies">
        <LegalList
          items={[
            "Essential cookies: required for core site functionality like authentication and session management.",
            "Preference cookies: remember your theme or region preference.",
            "Analytics cookies: help us understand aggregate traffic patterns. These are used only where required consent has been given.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Managing cookies">
        <p>
          Most browsers allow you to control cookies through settings. Blocking
          essential cookies may affect core functionality such as sign-in.
        </p>
      </LegalSection>

      <LegalSection title="Updates">
        <p>
          We may update this Cookie Policy. The &ldquo;last updated&rdquo; date at the top
          of the page reflects the latest version.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
