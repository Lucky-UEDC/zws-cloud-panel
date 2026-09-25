import { Activity, Gauge, Network, ShieldCheck, Thermometer, Zap } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/datacenters",
  eyebrow: "Datacenters",
  title: "Facility-grade compute regions for production workloads.",
  description: "{brand} deploys infrastructure across resilient facilities with redundant power, cooling, and network paths.",
  primaryHref: "/infrastructure",
  primaryLabel: "View infrastructure",
  sections: [
    {
      eyebrow: "Facility controls",
      title: "Designed for stable service delivery",
      items: [
        { icon: Zap, title: "N+1 power", description: "UPS and generator-backed electrical paths with tested failover processes." },
        { icon: Thermometer, title: "Cooling redundancy", description: "Environmental monitoring and cooling capacity sized for sustained load." },
        { icon: ShieldCheck, title: "Controlled access", description: "Facility access, security processes, and provider controls aligned with compliance needs." },
        { icon: Network, title: "Carrier diversity", description: "Multiple upstream paths reduce single-provider network risk." },
        { icon: Gauge, title: "Capacity planning", description: "Rack, power, and node capacity are monitored before customer demand lands." },
        { icon: Activity, title: "Operational telemetry", description: "Region health is tracked through platform monitoring and the public status surface." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function DatacentersPage() {
  return <EnterpriseInfoPage config={config} />
}
