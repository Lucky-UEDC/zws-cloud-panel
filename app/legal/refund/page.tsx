import type { Metadata } from "next"
import { LegalPageLayout, LegalSection, LegalList } from "@/components/layout/legal-page"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Refund & Cancellation Policy",
    description: `Refund and cancellation policy for ${site.brandName} cloud, hosting, dedicated, and billing services.`,
    path: "/legal/refund",
  })
}

export default async function RefundPage() {
  const site = await getPublicSiteSettings()
  return (
    <LegalPageLayout title="Refund & Cancellation Policy" lastUpdated="January 1, 2026" brandName={site.brandName}>
      <LegalSection title="Refund window">
        <p>
          New VPS orders are eligible for a refund within seven (7) calendar
          days of first provisioning, subject to the exclusions below.
        </p>
      </LegalSection>

      <LegalSection title="Exclusions">
        <LegalList
          items={[
            "Annual pre-payments after the initial refund window.",
            "Setup fees on custom or dedicated configurations.",
            "Usage-based fees such as bandwidth overages or add-on services.",
            "Accounts suspended or terminated for AUP violations.",
            "Domain registrations and third-party services resold through us.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Cancellations">
        <p>
          You may cancel services at any time through your client area or by
          contacting support. Cancellations take effect at the end of the
          current billing cycle unless stated otherwise.
        </p>
      </LegalSection>

      <LegalSection title="Processing">
        <p>
          Approved refunds are processed to the original payment method within
          5–10 business days. Processing times vary by payment provider.
        </p>
      </LegalSection>

      <LegalSection title="How to request a refund">
        <p>
          Email{" "}
          <a href={`mailto:${site.billingEmail}`}>{site.billingEmail}</a>{" "}
          with your account email, invoice number, and the reason for the
          refund. We will respond with next steps.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
