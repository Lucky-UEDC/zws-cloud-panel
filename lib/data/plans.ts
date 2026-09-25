import type { BillingTerm } from "@/lib/pricing"

export type Plan = {
  id: string
  name: string
  tagline: string
  tier: "starter" | "pro" | "enterprise"
  vcpu: number
  ramGB: number
  storageGB: number
  bandwidthTB: number
  // Term-based pricing (monthly price for each term)
  price: {
    "1": number
    "3": number
    "6": number
    "12": number
    "24": number
  }
  priceHourly: number
  popular?: boolean
  features: string[]
}

export const plans: Plan[] = [
  // Starter Tier
  {
    id: "starter-2gb",
    name: "Zs2.micro",
    tagline: "Fast NVMe cloud servers for websites, apps, testing, and small production workloads.",
    tier: "starter",
    vcpu: 1,
    ramGB: 2,
    storageGB: 30,
    bandwidthTB: 1,
    price: { "1": 299, "3": 269, "6": 254, "12": 239, "24": 224 },
    priceHourly: 0.41,
    features: [
      "1 vCPU Core",
      "2 GB DDR4 RAM",
      "30 GB NVMe SSD",
      "1 TB Bandwidth",
      "DDoS Protection",
    ],
  },
  {
    id: "starter-4gb",
    name: "Zs2.small",
    tagline: "Fast NVMe cloud servers for websites, apps, testing, and small production workloads.",
    tier: "starter",
    vcpu: 2,
    ramGB: 4,
    storageGB: 60,
    bandwidthTB: 2,
    price: { "1": 499, "3": 449, "6": 424, "12": 399, "24": 374 },
    priceHourly: 0.69,
    features: [
      "2 vCPU Cores",
      "4 GB DDR4 RAM",
      "60 GB NVMe SSD",
      "2 TB Bandwidth",
      "DDoS Protection",
    ],
  },
  {
    id: "starter-8gb",
    name: "Zs2.medium",
    tagline: "Fast NVMe cloud servers for websites, apps, testing, and small production workloads.",
    tier: "starter",
    vcpu: 2,
    ramGB: 8,
    storageGB: 100,
    bandwidthTB: 3,
    price: { "1": 799, "3": 719, "6": 679, "12": 639, "24": 599 },
    priceHourly: 1.11,
    popular: true,
    features: [
      "2 vCPU Cores",
      "8 GB DDR4 RAM",
      "100 GB NVMe SSD",
      "3 TB Bandwidth",
      "DDoS Protection",
      "Priority Support",
    ],
  },
  // Pro Tier
  {
    id: "pro-16gb",
    name: "Zp2.medium",
    tagline: "Production-ready compute instances for growing applications and business workloads.",
    tier: "pro",
    vcpu: 4,
    ramGB: 16,
    storageGB: 200,
    bandwidthTB: 5,
    price: { "1": 1499, "3": 1349, "6": 1274, "12": 1199, "24": 1124 },
    priceHourly: 2.08,
    popular: true,
    features: [
      "4 vCPU Cores",
      "16 GB DDR4 RAM",
      "200 GB NVMe SSD",
      "5 TB Bandwidth",
      "DDoS Protection",
      "Priority Support",
      "Daily Backups",
    ],
  },
  {
    id: "pro-32gb",
    name: "Zp2.large",
    tagline: "Production-ready compute instances for growing applications and business workloads.",
    tier: "pro",
    vcpu: 6,
    ramGB: 32,
    storageGB: 400,
    bandwidthTB: 10,
    price: { "1": 2499, "3": 2249, "6": 2124, "12": 1999, "24": 1874 },
    priceHourly: 3.47,
    features: [
      "6 vCPU Cores",
      "32 GB DDR4 RAM",
      "400 GB NVMe SSD",
      "10 TB Bandwidth",
      "DDoS Protection",
      "Priority Support",
      "Daily Backups",
    ],
  },
  {
    id: "pro-40gb",
    name: "Zp2.2xlarge",
    tagline: "Production-ready compute instances for growing applications and business workloads.",
    tier: "pro",
    vcpu: 7,
    ramGB: 40,
    storageGB: 500,
    bandwidthTB: 12,
    price: { "1": 2999, "3": 2699, "6": 2549, "12": 2399, "24": 2249 },
    priceHourly: 4.17,
    features: [
      "7 vCPU Cores",
      "40 GB DDR4 RAM",
      "500 GB NVMe SSD",
      "12 TB Bandwidth",
      "DDoS Protection",
      "Priority Support",
      "Daily Backups",
    ],
  },
  {
    id: "pro-48gb",
    name: "Zp2.xlarge",
    tagline: "Production-ready compute instances for growing applications and business workloads.",
    tier: "pro",
    vcpu: 8,
    ramGB: 48,
    storageGB: 600,
    bandwidthTB: 15,
    price: { "1": 3499, "3": 3149, "6": 2974, "12": 2799, "24": 2624 },
    priceHourly: 4.86,
    features: [
      "8 vCPU Cores",
      "48 GB DDR4 RAM",
      "600 GB NVMe SSD",
      "15 TB Bandwidth",
      "DDoS Protection",
      "24/7 Support",
      "Daily Backups",
    ],
  },
  // Enterprise Tier
  {
    id: "enterprise-64gb",
    name: "Ze3.large",
    tagline: "High-capacity virtual cloud servers for databases, SaaS platforms, and high-traffic workloads.",
    tier: "enterprise",
    vcpu: 12,
    ramGB: 64,
    storageGB: 800,
    bandwidthTB: 20,
    price: { "1": 4999, "3": 4499, "6": 4249, "12": 3999, "24": 3749 },
    priceHourly: 6.94,
    popular: true,
    features: [
      "12 vCPU Cores",
      "64 GB DDR4 RAM",
      "800 GB NVMe SSD",
      "20 TB Bandwidth",
      "DDoS Protection",
      "24/7 Priority Support",
      "Hourly Backups",
      "Dedicated IP",
    ],
  },
  {
    id: "enterprise-96gb",
    name: "Ze3.xlarge",
    tagline: "High-capacity virtual cloud servers for databases, SaaS platforms, and high-traffic workloads.",
    tier: "enterprise",
    vcpu: 16,
    ramGB: 96,
    storageGB: 1200,
    bandwidthTB: 30,
    price: { "1": 6999, "3": 6299, "6": 5949, "12": 5599, "24": 5249 },
    priceHourly: 9.72,
    features: [
      "16 vCPU Cores",
      "96 GB DDR4 RAM",
      "1.2 TB NVMe SSD",
      "30 TB Bandwidth",
      "DDoS Protection",
      "24/7 Priority Support",
      "Hourly Backups",
      "Dedicated IP",
    ],
  },
  {
    id: "enterprise-128gb",
    name: "Ze3.2xlarge",
    tagline: "High-capacity virtual cloud servers for databases, SaaS platforms, and high-traffic workloads.",
    tier: "enterprise",
    vcpu: 24,
    ramGB: 128,
    storageGB: 2000,
    bandwidthTB: 50,
    price: { "1": 9999, "3": 8999, "6": 8499, "12": 7999, "24": 7499 },
    priceHourly: 13.89,
    features: [
      "24 vCPU Cores",
      "128 GB DDR4 RAM",
      "2 TB NVMe SSD",
      "50 TB Bandwidth",
      "DDoS Protection",
      "24/7 Priority Support",
      "Hourly Backups",
      "Dedicated IP",
      "Custom SLA",
    ],
  },
]

// Get plans by tier
export function getPlansByTier(tier: Plan["tier"]): Plan[] {
  return plans.filter((p) => p.tier === tier)
}

// Get plan price for a specific term
export function getPlanPrice(plan: Plan, term: BillingTerm): number {
  return plan.price[term.toString() as keyof typeof plan.price] ?? plan.price["1"]
}

// Calculate savings percentage
export function getPlanSavings(plan: Plan, term: BillingTerm): number {
  if (term === 1) return 0
  const monthlyPrice = plan.price["1"]
  const termPrice = getPlanPrice(plan, term)
  return Math.round(((monthlyPrice - termPrice) / monthlyPrice) * 100)
}

// Legacy exports for backwards compatibility
export type BillingCycle = "monthly" | "quarterly" | "annual"

export const billingCycleMultiplier: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3 * 0.9, // 10% off
  annual: 12 * 0.8, // 20% off
}

export const billingCycleLabel: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly (save 10%)",
  annual: "Annual (save 20%)",
}
