import { BookOpen, CircleHelp, CreditCard, LifeBuoy, Server, ShieldAlert } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/knowledge-base",
  eyebrow: "Knowledge Base",
  title: "Answers for cloud servers, billing, and account operations.",
  description: "Use the {brand} knowledge base to find common guidance before opening a support ticket.",
  primaryHref: "/support",
  primaryLabel: "Visit help center",
  sections: [
    {
      eyebrow: "Topics",
      title: "Common customer questions",
      items: [
        { icon: Server, title: "Server lifecycle", description: "Deploy, restart, reinstall, suspend, and terminate service basics." },
        { icon: BookOpen, title: "Getting started", description: "First-login, SSH, password, and console guidance for new services." },
        { icon: CreditCard, title: "Billing", description: "Invoices, renewals, wallet top-ups, refunds, and order status." },
        { icon: ShieldAlert, title: "Security and abuse", description: "How to report abuse, handle KYC, and review acceptable use rules." },
        { icon: LifeBuoy, title: "Tickets", description: "When to open a ticket and what information helps support respond faster." },
        { icon: CircleHelp, title: "FAQ", description: "Browse frequently asked questions and service expectations." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function KnowledgeBasePage() {
  return <EnterpriseInfoPage config={config} />
}
