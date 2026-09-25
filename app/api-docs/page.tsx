import { Braces, FileJson, KeyRound, Network, ShieldCheck, Webhook } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/api-docs",
  eyebrow: "API Docs",
  title: "API documentation for platform integrations.",
  description: "Use {brand} API references to understand authenticated customer, order, billing, and infrastructure workflows.",
  primaryHref: "/docs",
  primaryLabel: "Documentation",
  sections: [
    {
      eyebrow: "API areas",
      title: "Integration-oriented documentation",
      items: [
        { icon: KeyRound, title: "Authentication", description: "Session and credentialed flows are scoped to the caller and role." },
        { icon: FileJson, title: "JSON contracts", description: "API responses should avoid leaking credentials, tokens, or provider tickets." },
        { icon: Braces, title: "Developer endpoints", description: "Reference customer, order, VPS, and billing API behavior." },
        { icon: Network, title: "Infrastructure status", description: "Runtime and VM status endpoints favor fresh state over stale cache." },
        { icon: Webhook, title: "Payment callbacks", description: "Payment gateway callbacks are documented with security expectations." },
        { icon: ShieldCheck, title: "Admin boundaries", description: "Admin APIs are role-checked and separated from client ownership paths." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function ApiDocsPage() {
  return <EnterpriseInfoPage config={config} />
}
