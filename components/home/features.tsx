import {
  HardDrive,
  ShieldCheck,
  Terminal,
  Database,
  Camera,
  Cpu,
  Maximize2,
  Zap,
  Lock,
} from "lucide-react"
import { Container } from "@/components/layout/container"
import { SectionHeader } from "@/components/layout/section-header"
import { FeatureCard } from "@/components/feature-card"

const features = [
  {
    icon: HardDrive,
    title: "NVMe SSD storage",
    description:
      "All plans ship on enterprise NVMe drives for consistently low latency and high IOPS.",
  },
  {
    icon: ShieldCheck,
    title: "DDoS protection",
    description:
      "Network-level mitigation on all regions with automatic anomaly detection built in.",
  },
  {
    icon: Terminal,
    title: "Full root access",
    description:
      "Complete control over your server. Install any OS, run any workload, configure freely.",
  },
  {
    icon: Database,
    title: "Automated backups",
    description:
      "Scheduled, encrypted backups with point-in-time restore. Retention you control.",
  },
  {
    icon: Camera,
    title: "Instant snapshots",
    description:
      "Capture the full state of your instance in seconds before risky deploys or upgrades.",
  },
  {
    icon: Cpu,
    title: "KVM-based virtualization",
    description:
      "Hardware-assisted KVM virtualization with isolated compute resources for stable, production-grade performance.",
  },
  {
    icon: Maximize2,
    title: "Horizontal scaling",
    description:
      "Move up a tier or spin up additional nodes without re-architecting your stack.",
  },
  {
    icon: Zap,
    title: "Deploy in under a minute",
    description:
      "Images, templates, and a clean provisioning pipeline mean you're SSH-ing in seconds.",
  },
  {
    icon: Lock,
    title: "API-ready platform",
    description:
      "Programmatic control over servers, networks, and snapshots. Built for automation.",
  },
]

export function Features() {
  return (
    <section className="py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeader
          eyebrow="Platform features"
          title="Everything you need to run production workloads"
          description="A small, opinionated set of capabilities designed for teams who ship."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Container>
    </section>
  )
}
