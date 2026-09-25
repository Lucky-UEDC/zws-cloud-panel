import type { Metadata } from "next"
import { SiteShell } from "@/components/layout/site-shell"
import { PageHeader } from "@/components/layout/page-header"
import { Container } from "@/components/layout/container"
import { FeatureCard } from "@/components/feature-card"
import { SectionHeader } from "@/components/layout/section-header"
import { CTASection } from "@/components/cta-section"
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
  Network,
  Globe,
  GitBranch,
  Activity,
  Users,
  Layers,
} from "lucide-react"
import { buildPageMetadata } from "@/lib/seo/metadata"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublicSiteSettings()
  return buildPageMetadata({
    title: "Features",
    description: `Everything ${site.brandName} ships, from NVMe storage and DDoS protection to API-driven infrastructure automation.`,
    path: "/features",
  })
}

const groups = [
  {
    title: "Compute & storage",
    items: [
      { icon: HardDrive, title: "NVMe SSD storage", description: "Enterprise NVMe across every plan for consistent IOPS." },
      { icon: Cpu, title: "Secure virtualization", description: "Hardware-assisted isolation on modern hypervisors." },
      { icon: Camera, title: "Instant snapshots", description: "Capture full VPS state in seconds before risky deploys." },
      { icon: Database, title: "Automated backups", description: "Encrypted, scheduled backups with point-in-time restore." },
    ],
  },
  {
    title: "Network & security",
    items: [
      { icon: ShieldCheck, title: "DDoS protection", description: "Network-layer mitigation on every region." },
      { icon: Network, title: "Private networking", description: "Low-latency interconnects between your instances." },
      { icon: Lock, title: "Hardened defaults", description: "Sensible firewall, SSH, and identity defaults out of the box." },
      { icon: Globe, title: "Anycast-ready", description: "Global DNS and edge routing to minimize latency." },
    ],
  },
  {
    title: "Operations",
    items: [
      { icon: Zap, title: "Sub-minute deploys", description: "Typical provisioning completes in under 60 seconds." },
      { icon: Maximize2, title: "Seamless scaling", description: "Move up tiers or spin out additional nodes cleanly." },
      { icon: GitBranch, title: "Infrastructure as code", description: "Terraform provider and CLI workflows." },
      { icon: Activity, title: "Real-time metrics", description: "CPU, memory, disk, and network telemetry built in." },
    ],
  },
  {
    title: "Platform",
    items: [
      { icon: Terminal, title: "Full root access", description: "Install any OS image, run any workload within AUP." },
      { icon: Users, title: "Team management", description: "Invite teammates, scope permissions, audit actions." },
      { icon: Layers, title: "Multiple OS templates", description: "Ubuntu, Debian, Rocky, AlmaLinux, Windows Server, and more." },
    ],
  },
]

export default function FeaturesPage() {
  return (
    <SiteShell>
      <PageHeader
        eyebrow="Features"
        title="A focused platform for teams who ship."
        description="We build a small set of things and make them excellent. Here is the current list."
      />

      {groups.map((group, i) => (
        <section
          key={group.title}
          className="py-16"
        >
          <Container className="flex flex-col gap-10">
            <SectionHeader eyebrow="Capability group" title={group.title} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {group.items.map((f) => (
                <FeatureCard key={f.title} {...f} />
              ))}
            </div>
          </Container>
        </section>
      ))}

      <CTASection />
    </SiteShell>
  )
}
