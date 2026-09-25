import { BriefcaseBusiness, HeartHandshake, Laptop, Rocket, ShieldCheck, Users } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/careers",
  eyebrow: "Careers",
  title: "Build reliable cloud infrastructure with a small, focused team.",
  description: "{brand} is growing around engineering, support, infrastructure operations, and customer success.",
  primaryHref: "/contact",
  primaryLabel: "Contact recruiting",
  sections: [
    {
      eyebrow: "How we work",
      title: "Practical, customer-centered infrastructure work",
      items: [
        { icon: Rocket, title: "Ship useful systems", description: "Work on products customers use daily for deployments, billing, support, and operations." },
        { icon: ShieldCheck, title: "Own reliability", description: "Treat uptime, security, and honest status reporting as product features." },
        { icon: Users, title: "Collaborate clearly", description: "Keep decisions documented and make cross-functional handoffs easy to follow." },
        { icon: Laptop, title: "Remote-ready workflows", description: "Use async-friendly processes for engineering, infrastructure, and support teams." },
        { icon: BriefcaseBusiness, title: "Business context", description: "Understand the customer and commercial impact behind platform work." },
        { icon: HeartHandshake, title: "Respectful support", description: "Help customers with calm, direct communication when services matter most." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function CareersPage() {
  return <EnterpriseInfoPage config={config} />
}
