export type BlogPost = {
  slug: string
  title: string
  description: string
  publishedAt: string // YYYY-MM-DD
  keywords: string[]
  canonicalPath: string
}

export const blogPosts: BlogPost[] = [
  {
    slug: "what-is-vps-hosting",
    title: "What Is a Cloud Compute Instance? A Practical Guide",
    description:
      "Learn what a cloud compute instance is, when it beats shared hosting, and what specs matter most (CPU, RAM, NVMe, bandwidth).",
    publishedAt: "2026-04-25",
    canonicalPath: "/blog/what-is-vps-hosting",
    keywords: ["compute instances", "cloud server", "virtual server", "linux compute instance", "kvm virtualization"],
  },
  {
    slug: "vps-vs-cloud-hosting",
    title: "Compute Instances vs Cloud Hosting: Which Should You Choose?",
    description:
      "A clear comparison of compute instances and cloud hosting, with real-world decision rules for startups, agencies, and SaaS teams.",
    publishedAt: "2026-04-25",
    canonicalPath: "/blog/vps-vs-cloud-hosting",
    keywords: ["compute instances vs cloud", "cloud hosting services", "cloud compute", "virtual server"],
  },
  {
    slug: "deploy-virtualization-server",
    title: "How to Deploy a Virtualization Server (Step-by-Step)",
    description:
      "A practical virtualization deployment walkthrough: installation, networking, storage, templates, backups, and common pitfalls.",
    publishedAt: "2026-04-25",
    canonicalPath: "/blog/deploy-virtualization-server",
    keywords: ["virtualization", "deploy virtualization server", "kvm", "linux", "networking"],
  },
  {
    slug: "best-vps-for-startups",
    title: "Best Compute Instance for Startups: What to Look For",
    description:
      "How to pick a compute instance that will not bottleneck your product: CPU fairness, RAM, NVMe I/O, backups, and support.",
    publishedAt: "2026-04-25",
    canonicalPath: "/blog/best-vps-for-startups",
    keywords: ["best compute instances", "compute instances for startups", "buy compute instances", "managed compute instances", "nvme performance"],
  },
  {
    slug: "nvme-vs-ssd-vps-performance",
    title: "NVMe vs SSD Performance: What You Actually Feel",
    description:
      "NVMe is not just a spec sheet flex. Here is when it helps and what workloads benefit most on modern compute instances.",
    publishedAt: "2026-04-25",
    canonicalPath: "/blog/nvme-vs-ssd-vps-performance",
    keywords: ["nvme", "ssd", "nvme vs ssd", "cloud performance", "storage performance"],
  },
]
