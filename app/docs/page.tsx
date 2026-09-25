import { BookOpenText, FileCode2, KeyRound, LifeBuoy, ServerCog, Terminal } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/docs",
  eyebrow: "Documentation",
  title: "Documentation for customers and operators.",
  description: "{brand} documentation covers deployment, account management, support, policies, and platform operations.",
  primaryHref: "/api-docs",
  primaryLabel: "API docs",
  sections: [
    {
      eyebrow: "Guides",
      title: "Core documentation areas",
      items: [
        { icon: BookOpenText, title: "Service setup", description: "Launch servers and understand the first-run handoff." },
        { icon: Terminal, title: "Console access", description: "Use automatic browser console access for supported Windows and Linux VMs." },
        { icon: KeyRound, title: "Identity and access", description: "Account, password, SSH key, and MFA concepts." },
        { icon: ServerCog, title: "Lifecycle actions", description: "Start, stop, reinstall, recover, and inspect services." },
        { icon: FileCode2, title: "API references", description: "Developer-facing endpoints and integration concepts live in API docs." },
        { icon: LifeBuoy, title: "Support paths", description: "Escalate issues through support tickets and abuse reporting flows." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function DocsPage() {
  return <EnterpriseInfoPage config={config} />
}
