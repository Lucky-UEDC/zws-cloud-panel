import { Archive, Database, HardDrive, Lock, RotateCcw, ServerCog } from "lucide-react"
import { EnterpriseInfoPage, enterpriseInfoMetadata, type EnterpriseInfoPageConfig } from "@/components/marketing/enterprise-info-page"

export const revalidate = 3600

const config: EnterpriseInfoPageConfig = {
  path: "/storage-services",
  eyebrow: "Storage Services",
  title: "Storage options for cloud instances and operational recovery.",
  description: "{brand} keeps storage services tied to provisioning, backups, snapshots, and lifecycle workflows.",
  sections: [
    {
      eyebrow: "Storage platform",
      title: "Practical storage for production servers",
      items: [
        { icon: HardDrive, title: "NVMe-backed disks", description: "Fast primary disks for virtual machines and customer workloads." },
        { icon: Database, title: "Pool-aware placement", description: "Storage pools are selected and persisted with service metadata." },
        { icon: RotateCcw, title: "Snapshots and recovery", description: "Operational tools support safer change windows and recovery actions." },
        { icon: Archive, title: "Backup workflows", description: "Backup surfaces are managed from the admin panel and customer workflows." },
        { icon: Lock, title: "Lifecycle controls", description: "Suspension, retention, and deletion rules keep storage cleanup consistent." },
        { icon: ServerCog, title: "Admin visibility", description: "Infrastructure operators can inspect node and pool assignment details." },
      ],
    },
  ],
}

export const generateMetadata = () => enterpriseInfoMetadata(config)
export default function StorageServicesPage() {
  return <EnterpriseInfoPage config={config} />
}
