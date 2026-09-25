export type NavLink = {
  label: string
  href: string
  description?: string
  public?: boolean
}

export type FooterSection = {
  title: "Company" | "Products" | "Support" | "Legal" | "Resources"
  links: NavLink[]
}

export const primaryNav: NavLink[] = [
  { label: "Compute Instances", href: "/compute-instances" },
  { label: "Cloud VPS", href: "/cloud-vps" },
  { label: "Dedicated", href: "/dedicated" },
  { label: "Build Custom Instance", href: "/configure" },
  { label: "Pricing", href: "/pricing" },
  { label: "Features", href: "/features" },
  { label: "Infrastructure", href: "/infrastructure" },
  { label: "Compare", href: "/compare-cloud-pricing" },
]

export const footerSections: FooterSection[] = [
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Infrastructure", href: "/infrastructure" },
      { label: "Datacenters", href: "/datacenters" },
      { label: "Contact", href: "/contact" },
      { label: "Careers", href: "/careers" },
      { label: "Compliance", href: "/compliance" },
    ],
  },
  {
    title: "Products",
    links: [
      { label: "Cloud VPS", href: "/cloud-vps" },
      { label: "Compute Instances", href: "/compute-instances" },
      { label: "Windows Cloud", href: "/windows-cloud" },
      { label: "Linux Cloud", href: "/linux-cloud" },
      { label: "Dedicated Servers", href: "/dedicated" },
      { label: "Storage Services", href: "/storage-services" },
      { label: "Network Services", href: "/network-services" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Center", href: "/support" },
      { label: "Knowledge Base", href: "/knowledge-base" },
      { label: "Documentation", href: "/docs" },
      { label: "API Docs", href: "/api-docs" },
      { label: "Service Status", href: "/status" },
      { label: "Client Area", href: "/client-area", public: false },
      { label: "Support Tickets", href: "/client-area/support", public: false },
      { label: "Abuse Reports", href: "/abuse" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms", href: "/legal/terms" },
      { label: "Privacy Policy", href: "/legal/privacy" },
      { label: "Refund Policy", href: "/legal/refund" },
      { label: "SLA", href: "/legal/sla" },
      { label: "Acceptable Use Policy", href: "/legal/aup" },
      { label: "KYC Policy", href: "/legal/kyc" },
      { label: "Cookie Policy", href: "/legal/cookies" },
      { label: "Disclaimer", href: "/legal/disclaimer" },
      { label: "Abuse & Data Retention", href: "/abuse" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "Features", href: "/features" },
      { label: "Infrastructure Overview", href: "/infrastructure" },
      { label: "Cloud Comparison", href: "/compare" },
      { label: "Cloud Pricing Guide", href: "/compare-cloud-pricing" },
      { label: "Tutorials", href: "/tutorials" },
    ],
  },
]

export const footerNav = Object.fromEntries(
  footerSections.map((section) => [section.title, section.links]),
) as Record<FooterSection["title"], NavLink[]>

export const legalNavLinks: NavLink[] = [
  ...footerSections.find((section) => section.title === "Legal")!.links,
  { label: "Compliance", href: "/compliance" },
]

export const requiredFooterRoutes = Array.from(
  new Set(footerSections.flatMap((section) => section.links.map((link) => link.href))),
).sort()

export const publicSitemapRoutes = [
  "",
  "/blog",
  "/vps",
  "/vps-hosting",
  "/cheap-vps",
  "/cloud",
  "/cloud-vps",
  "/compute-instances",
  "/windows-cloud",
  "/linux-cloud",
  "/managed-vps",
  "/dedicated",
  "/storage-services",
  "/network-services",
  "/configure",
  "/pricing",
  "/proxmox-vps",
  "/features",
  "/infrastructure",
  "/datacenters",
  "/about",
  "/contact",
  "/careers",
  "/faq",
  "/support",
  "/knowledge-base",
  "/docs",
  "/api-docs",
  "/tutorials",
  "/status",
  "/compliance",
  "/abuse",
  "/vps-hosting-india",
  "/vps-hosting-mumbai",
  "/vps-hosting-bangalore",
  "/vps-hosting-delhi-ncr",
  "/cloud-hosting-india",
  "/technical-specifications",
  "/wordpress-vps-hosting",
  "/ecommerce-vps-hosting",
  "/developer-vps-hosting",
  "/startup-cloud-hosting",
  "/vs-aws-lightsail",
  "/vs-azure",
  "/compare",
  "/compare-cloud-pricing",
  "/dedicated-server-india",
  "/vds-hosting-india",
  "/gaming-server-hosting-india",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refund",
  "/legal/sla",
  "/legal/aup",
  "/legal/kyc",
  "/legal/cookies",
  "/legal/disclaimer",
]
