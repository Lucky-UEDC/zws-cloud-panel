import { BookOpen, Code2, CreditCard, KeyRound, Server, Terminal } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/tutorials",
  eyebrow: "Tutorials",
  title: "Step-by-step guides for cloud server workflows.",
  description: "Learn practical {brand} workflows for deploying servers, accessing consoles, managing billing, and operating safely.",
  primaryHref: "/knowledge-base",
  primaryLabel: "Knowledge base",
  sections: [
    {
      eyebrow: "Tutorial library",
      title: "Guides customers expect first",
      items: [
        { icon: Server, title: "Deploy your first VPS", description: "Choose a plan, pick an OS template, and follow provisioning status." },
        { icon: Terminal, title: "Use the browser console", description: "Open the automatic console for Windows or Linux without choosing a mode." },
        { icon: KeyRound, title: "Set up access", description: "Manage passwords, SSH keys, and account security settings." },
        { icon: Code2, title: "Host an app", description: "Prepare a Linux server for a simple application deployment." },
        { icon: CreditCard, title: "Manage renewals", description: "Understand invoices, wallet balance, and service renewal timing." },
        { icon: BookOpen, title: "Read policies", description: "Review SLA, AUP, KYC, refund, privacy, and data-retention expectations." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function TutorialsPage() {
  return <EnterpriseInfoPage config={config} />
}
