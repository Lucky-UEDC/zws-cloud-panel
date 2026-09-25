import { KeyRound, Monitor, Network, RotateCcw, ShieldCheck, Server } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/windows-cloud",
  eyebrow: "Windows Cloud",
  title: "Windows Server cloud instances with graphical console access.",
  description: "Deploy Windows Server workloads on {brand} with predictable resources, protected networking, and administrator access.",
  primaryHref: "/pricing",
  sections: [
    {
      eyebrow: "Windows workloads",
      title: "Ready for desktop, app, and business workloads",
      items: [
        { icon: Monitor, title: "noVNC console", description: "Graphical browser console access is resolved automatically for Windows templates." },
        { icon: KeyRound, title: "Administrator login", description: "Provisioning stores the right access metadata for customer handoff." },
        { icon: Server, title: "Dedicated resources", description: "CPU, memory, and storage allocations are visible from the client panel." },
        { icon: RotateCcw, title: "Reinstall-ready", description: "Supported templates can be reinstalled while preserving service identity." },
        { icon: Network, title: "Network controls", description: "Public IP allocation and platform networking workflows stay linked to the service." },
        { icon: ShieldCheck, title: "Policy coverage", description: "Usage is covered by AUP, KYC, abuse handling, and retention policies." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function WindowsCloudPage() {
  return <EnterpriseInfoPage config={config} />
}
