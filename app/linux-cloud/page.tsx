import { Code2, Gauge, GitBranch, KeyRound, RotateCcw, Terminal } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/linux-cloud",
  eyebrow: "Linux Cloud",
  title: "Linux cloud instances built for automation and root access.",
  description: "Run Ubuntu, Debian, Rocky, AlmaLinux, and other Linux workloads on {brand} with predictable compute and serial console access.",
  primaryHref: "/pricing",
  sections: [
    {
      eyebrow: "Linux operations",
      title: "Fast, scriptable infrastructure for teams",
      items: [
        { icon: Terminal, title: "xterm.js console", description: "Serial terminal access is resolved automatically for Linux templates." },
        { icon: KeyRound, title: "SSH-friendly defaults", description: "Password and SSH-key workflows are supported by provisioning and reinstall." },
        { icon: Code2, title: "Developer workloads", description: "Host APIs, CI runners, staging apps, databases, and internal tools." },
        { icon: GitBranch, title: "Automation-ready", description: "Use documented platform flows for deployment and lifecycle actions." },
        { icon: RotateCcw, title: "Template reinstall", description: "Switch supported Linux templates while preserving panel ownership." },
        { icon: Gauge, title: "Live telemetry", description: "Track CPU, memory, disk, and status from client and admin surfaces." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function LinuxCloudPage() {
  return <EnterpriseInfoPage config={config} />
}
