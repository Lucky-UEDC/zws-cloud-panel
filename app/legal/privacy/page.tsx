import type { Metadata } from "next"
import { LegalPageLayout, LegalSection, LegalList } from "@/components/layout/legal-page"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Privacy Policy",
    description: `Privacy policy for ${site.brandName}, including account, billing, support, and infrastructure service data handling.`,
    path: "/legal/privacy",
  })
}

export default async function PrivacyPage() {
  const site = await getPublicSiteSettings()
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="January 1, 2026" brandName={site.brandName}>
      <LegalSection title="Overview">
        <p>
          This Privacy Policy describes how {site.brandName} collects, uses, and
          protects personal data. It applies to our website and the services
          you access through it.
        </p>
      </LegalSection>

      <LegalSection title="Data we collect">
        <LegalList
          items={[
            "Account data: name, email, password hashes, billing address.",
            "Payment data: handled by certified payment partners; we do not store full card numbers.",
            "Operational data: server metadata, usage metrics, and access logs.",
            "Support data: tickets, messages, and attachments you send us.",
          ]}
        />
      </LegalSection>

      <LegalSection title="How we use data">
        <LegalList
          items={[
            "Deliver, maintain, and improve the services.",
            "Communicate about your account, billing, and service status.",
            "Enforce our Terms and investigate abuse.",
            "Comply with legal obligations.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Data sharing">
        <p>
          We do not sell personal data. We share limited data with sub-processors
          who help us operate the services (for example, payment processors and
          infrastructure partners), and with authorities when compelled by
          valid legal process.
        </p>
      </LegalSection>

      <LegalSection title="International transfers">
        <p>
          Our services are global. Where personal data is transferred across
          borders, we use appropriate safeguards consistent with applicable law.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <LegalList
          items={[
            "Access and correct your account information.",
            "Request export of your personal data.",
            "Request deletion, subject to legal retention requirements.",
            "Object to certain processing activities where required by law.",
          ]}
        />
      </LegalSection>

      <LegalSection title="Retention">
        <p>
          Account and billing data are retained for the life of the account and
          as needed to meet legal or regulatory obligations. Operational logs
          are retained for a limited period, typically up to 30 days.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          We implement administrative, technical, and physical safeguards to
          protect personal data. No system is perfectly secure; we will notify
          affected users of material breaches in accordance with applicable law.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For privacy inquiries, email{" "}
          <a href={`mailto:${site.supportEmail}`}>{site.supportEmail}</a>.
        </p>
      </LegalSection>
    </LegalPageLayout>
  )
}
