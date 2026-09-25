export type SeedProduct = {
  slug: string
  name: string
  family: "fixed_vps" | "configurable" | "dedicated"
  categorySlug: "vps" | "dedicated"
  description: string
  shortDescription?: string
  cpuCores: number
  ramGb: number
  storageGb: number
  storageType: "nvme" | "ssd" | "sas"
  bandwidthTb: number
  price1m: number
  priceHourly?: number
  ctaLabel: string
  ctaMode: "purchase_now" | "configure" | "contact_sales"
  badges?: string[]
  features: string[]
  whatsappEnabled?: boolean
  sortOrder: number
}

export const VPS_FIXED_SEED: SeedProduct[] = [
  { slug: "starter-2gb", name: "Zs2.micro", family: "fixed_vps", categorySlug: "vps", description: "Perfect for small projects and testing.", cpuCores: 1, ramGb: 2, storageGb: 30, storageType: "nvme", bandwidthTb: 1, price1m: 299, priceHourly: 0.41, ctaLabel: "Deploy 2GB", ctaMode: "purchase_now", features: ["1 vCPU Core", "2 GB DDR4 RAM", "30 GB NVMe SSD", "1 TB Bandwidth", "DDoS Protection"], sortOrder: 10 },
  { slug: "starter-4gb", name: "Zs2.small", family: "fixed_vps", categorySlug: "vps", description: "Ideal for blogs and small websites.", cpuCores: 2, ramGb: 4, storageGb: 60, storageType: "nvme", bandwidthTb: 2, price1m: 499, priceHourly: 0.69, ctaLabel: "Deploy 4GB", ctaMode: "purchase_now", features: ["2 vCPU Cores", "4 GB DDR4 RAM", "60 GB NVMe SSD", "2 TB Bandwidth", "DDoS Protection"], sortOrder: 20 },
  { slug: "starter-8gb", name: "Zs2.medium", family: "fixed_vps", categorySlug: "vps", description: "Great for growing applications.", cpuCores: 2, ramGb: 8, storageGb: 100, storageType: "nvme", bandwidthTb: 3, price1m: 799, priceHourly: 1.11, ctaLabel: "Deploy 8GB", ctaMode: "purchase_now", badges: ["Most Popular"], features: ["2 vCPU Cores", "8 GB DDR4 RAM", "100 GB NVMe SSD", "3 TB Bandwidth", "DDoS Protection", "Priority Support"], sortOrder: 30 },
  { slug: "pro-16gb", name: "Zp2.medium", family: "fixed_vps", categorySlug: "vps", description: "For medium-sized applications.", cpuCores: 4, ramGb: 16, storageGb: 200, storageType: "nvme", bandwidthTb: 5, price1m: 1499, priceHourly: 2.08, ctaLabel: "Deploy 16GB", ctaMode: "purchase_now", features: ["4 vCPU Cores", "16 GB DDR4 RAM", "200 GB NVMe SSD", "5 TB Bandwidth", "DDoS Protection", "Priority Support", "Daily Backups"], sortOrder: 40 },
  { slug: "pro-32gb", name: "Zp2.large", family: "fixed_vps", categorySlug: "vps", description: "High-performance for demanding workloads.", cpuCores: 6, ramGb: 32, storageGb: 400, storageType: "nvme", bandwidthTb: 10, price1m: 2499, priceHourly: 3.47, ctaLabel: "Deploy 32GB", ctaMode: "purchase_now", features: ["6 vCPU Cores", "32 GB DDR4 RAM", "400 GB NVMe SSD", "10 TB Bandwidth", "DDoS Protection", "Priority Support", "Daily Backups"], sortOrder: 50 },
  { slug: "pro-40gb", name: "Zp2.2xlarge", family: "fixed_vps", categorySlug: "vps", description: "Peak performance in the Pro tier.", cpuCores: 7, ramGb: 40, storageGb: 500, storageType: "nvme", bandwidthTb: 12, price1m: 2999, priceHourly: 4.17, ctaLabel: "Deploy 40GB", ctaMode: "purchase_now", features: ["7 vCPU Cores", "40 GB DDR4 RAM", "500 GB NVMe SSD", "12 TB Bandwidth", "DDoS Protection", "Priority Support", "Daily Backups"], sortOrder: 60 },
  { slug: "pro-48gb", name: "Zp2.xlarge", family: "fixed_vps", categorySlug: "vps", description: "Enterprise-grade performance.", cpuCores: 8, ramGb: 48, storageGb: 600, storageType: "nvme", bandwidthTb: 15, price1m: 3499, priceHourly: 4.86, ctaLabel: "Deploy 48GB", ctaMode: "purchase_now", features: ["8 vCPU Cores", "48 GB DDR4 RAM", "600 GB NVMe SSD", "15 TB Bandwidth", "DDoS Protection", "24/7 Support", "Daily Backups"], sortOrder: 70 },
  { slug: "enterprise-64gb", name: "Ze3.large", family: "fixed_vps", categorySlug: "vps", description: "For large-scale applications.", cpuCores: 12, ramGb: 64, storageGb: 800, storageType: "nvme", bandwidthTb: 20, price1m: 4999, priceHourly: 6.94, ctaLabel: "Deploy 64GB", ctaMode: "purchase_now", badges: ["Most Popular", "Enterprise"], features: ["12 vCPU Cores", "64 GB DDR4 RAM", "800 GB NVMe SSD", "20 TB Bandwidth", "DDoS Protection", "24/7 Priority Support", "Hourly Backups", "Dedicated IP"], sortOrder: 80 },
  { slug: "enterprise-96gb", name: "Ze3.xlarge", family: "fixed_vps", categorySlug: "vps", description: "Maximum performance tier.", cpuCores: 16, ramGb: 96, storageGb: 1200, storageType: "nvme", bandwidthTb: 30, price1m: 6999, priceHourly: 9.72, ctaLabel: "Deploy 96GB", ctaMode: "purchase_now", badges: ["Enterprise"], features: ["16 vCPU Cores", "96 GB DDR4 RAM", "1.2 TB NVMe SSD", "30 TB Bandwidth", "DDoS Protection", "24/7 Priority Support", "Hourly Backups", "Dedicated IP"], sortOrder: 90 },
  { slug: "enterprise-128gb", name: "Ze3.2xlarge", family: "fixed_vps", categorySlug: "vps", description: "Ultimate enterprise solution.", cpuCores: 24, ramGb: 128, storageGb: 2000, storageType: "nvme", bandwidthTb: 50, price1m: 9999, priceHourly: 13.89, ctaLabel: "Deploy 128GB", ctaMode: "purchase_now", badges: ["Enterprise"], features: ["24 vCPU Cores", "128 GB DDR4 RAM", "2 TB NVMe SSD", "50 TB Bandwidth", "DDoS Protection", "24/7 Priority Support", "Hourly Backups", "Dedicated IP", "Custom SLA"], sortOrder: 100 },
]

// Defaults applied for missing dedicated fields: 1 TB SAS SSD, 512 Mbps uplink.
export const DEDICATED_SEED: SeedProduct[] = [
  { slug: "ryzen-9950x", name: "Ryzen 9950X", family: "dedicated", categorySlug: "dedicated", description: "High-clock dedicated platform for demanding compute workloads.", cpuCores: 32, ramGb: 192, storageGb: 1000, storageType: "sas", bandwidthTb: 20, price1m: 25000, ctaLabel: "Purchase Now", ctaMode: "purchase_now", whatsappEnabled: true, features: ["CPU: Ryzen 9950X", "32 Cores", "192 GB RAM", "1 TB SAS SSD", "512 Mbps Uplink"], sortOrder: 10 },
  { slug: "platinum-8160", name: "Platinum 8160", family: "dedicated", categorySlug: "dedicated", description: "Enterprise dedicated server for large parallel workloads.", cpuCores: 96, ramGb: 256, storageGb: 1000, storageType: "sas", bandwidthTb: 20, price1m: 18000, ctaLabel: "Purchase Now", ctaMode: "purchase_now", whatsappEnabled: true, features: ["CPU: Platinum 8160", "96 Cores", "256 GB RAM", "1 TB SAS SSD", "512 Mbps Uplink"], sortOrder: 20 },
  { slug: "intel-xeon-v3", name: "Intel Xeon V3", family: "dedicated", categorySlug: "dedicated", description: "Balanced dedicated compute node for stable production operations.", cpuCores: 24, ramGb: 256, storageGb: 1000, storageType: "sas", bandwidthTb: 20, price1m: 12000, ctaLabel: "Purchase Now", ctaMode: "purchase_now", whatsappEnabled: true, features: ["CPU: Intel Xeon V3", "24 Cores", "256 GB RAM", "1 TB SAS SSD", "512 Mbps Uplink"], sortOrder: 30 },
  { slug: "intel-xeon-v2", name: "Intel Xeon V2", family: "dedicated", categorySlug: "dedicated", description: "Cost-efficient dedicated server with high memory capacity.", cpuCores: 20, ramGb: 256, storageGb: 1000, storageType: "sas", bandwidthTb: 20, price1m: 8000, ctaLabel: "Purchase Now", ctaMode: "purchase_now", whatsappEnabled: true, features: ["CPU: Intel Xeon V2", "20 Cores", "256 GB RAM", "1 TB SAS SSD", "512 Mbps Uplink"], sortOrder: 40 },
  { slug: "intel-xeon-4680-v2", name: "Intel Xeon 4680 V2", family: "dedicated", categorySlug: "dedicated", description: "Entry dedicated bare metal offer with strong value for private workloads.", cpuCores: 12, ramGb: 256, storageGb: 1000, storageType: "sas", bandwidthTb: 20, price1m: 4000, ctaLabel: "Purchase Now", ctaMode: "purchase_now", whatsappEnabled: true, features: ["CPU: Intel Xeon 4680 V2", "12 Cores", "256 GB RAM", "1 TB SAS SSD", "512 Mbps Uplink"], sortOrder: 50 },
]
