import { Activity, Cable, Globe, Network, ShieldCheck, Workflow } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/network-services",
  eyebrow: "Network Services",
  title: "Network services for IP assignment, reachability, and protection.",
  description: "{brand} connects cloud servers with managed IP assignment, monitoring, and security-oriented operations.",
  sections: [
    {
      eyebrow: "Network platform",
      title: "Public and private connectivity foundations",
      items: [
        { icon: Network, title: "IP pool management", description: "Admin workflows reserve, assign, and reconcile service IP addresses." },
        { icon: Globe, title: "Public reachability", description: "Customer services expose public addresses and runtime status from the panel." },
        { icon: Cable, title: "Node-aware routing", description: "Provisioning uses node and pool context to keep VM networking aligned." },
        { icon: ShieldCheck, title: "Abuse controls", description: "Reports and policy enforcement are linked from public and legal navigation." },
        { icon: Activity, title: "Runtime checks", description: "VM status and live telemetry stay fresh for client and admin panels." },
        { icon: Workflow, title: "Operational events", description: "Network changes are auditable through infrastructure and event surfaces." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function NetworkServicesPage() {
  return <EnterpriseInfoPage config={config} />
}
