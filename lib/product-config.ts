/**
 * Cloud product configuration
 * 
 * Central configuration for:
 * - Configurator limits (max CPU, RAM, storage, bandwidth)
 * - Disk options (NVMe, SSD)
 * - Storage tiers
 * - Operating systems
 * - Regions
 * 
 * All values are admin-editable and scalable
 */

/**
 * Configurator Limits
 * These define the maximum values users can select
 * Can be increased by admin in the future without code changes
 */
export const CONFIGURATOR_LIMITS = {
  cpu: {
    min: 1,
    max: 64,
    default: 4,
    step: 1,
  },
  ram: {
    min: 2,
    max: 256,
    default: 8,
    step: 2,
  },
  storage: {
    nvme: {
      min: 40,
      max: 4000,
      default: 160,
      step: 20,
    },
    ssd: {
      min: 40,
      max: 8000,
      default: 160,
      step: 20,
    },
  },
  bandwidth: {
    min: 1,
    max: 100,
    default: 2,
    included: 10, // 10 TB free
  },
  disks: {
    min: 1,
    max: 5, // Support up to 5 disks per server
    default: 1,
  },
} as const

/**
 * Storage Type Options
 * NVMe: Fast, expensive
 * SSD: Standard, cost-effective
 */
export const STORAGE_TYPES = [
  {
    id: "nvme",
    label: "NVMe SSD",
    description: "Ultra-fast NVMe storage",
    icon: "Zap",
    maxGb: CONFIGURATOR_LIMITS.storage.nvme.max,
    pricePerGb: 0.5, // INR 0.5 per GB/month
  },
  {
    id: "ssd",
    label: "Standard SSD",
    description: "Reliable standard SSD storage",
    icon: "HardDrive",
    maxGb: CONFIGURATOR_LIMITS.storage.ssd.max,
    pricePerGb: 0.25, // INR 0.25 per GB/month
  },
] as const

/**
 * Disk Configuration Structure
 * Users can add up to 5 disks with different types/sizes
 */
export interface DiskConfig {
  type: "nvme" | "ssd"
  sizeGb: number
  label?: string // e.g., "Disk 1", "Disk 2"
}

/**
 * Operating Systems available for deployment
 */
export const OPERATING_SYSTEMS = [
  { id: "ubuntu-24", name: "Ubuntu 24.04 LTS", priceAddon: 0 },
  { id: "debian-12", name: "Debian 12", priceAddon: 0 },
  { id: "rocky-9", name: "Rocky Linux 9", priceAddon: 0 },
  { id: "almalinux-9", name: "AlmaLinux 9", priceAddon: 0 },
  { id: "centos-9", name: "CentOS Stream 9", priceAddon: 0 },
  { id: "windows-2022", name: "Windows Server 2022", priceAddon: 500 },
] as const

/**
 * Geographic regions for deployment
 * Can be expanded as infrastructure grows
 */
export const REGIONS = [
  { id: "bom", name: "Mumbai (BOM)", latency_ms: 2 },
  { id: "blr", name: "Bengaluru (BLR)", latency_ms: 3 },
  { id: "sin", name: "Singapore (SIN)", latency_ms: 8 },
  { id: "fra", name: "Frankfurt (FRA)", latency_ms: 45 },
  { id: "nyc", name: "New York (NYC)", latency_ms: 120 },
] as const

/**
 * Bandwidth options
 * First 10 TB is included, additional TB charged per the pricing engine
 */
export const BANDWIDTH_OPTIONS = [
  { label: "1 TB", value: 1, description: "1 TB/month bandwidth" },
  { label: "2 TB", value: 2, description: "2 TB/month bandwidth" },
  { label: "4 TB", value: 4, description: "4 TB/month bandwidth" },
  { label: "8 TB", value: 8, description: "8 TB/month bandwidth" },
  { label: "16 TB", value: 16, description: "16 TB/month bandwidth" },
  { label: "32 TB", value: 32, description: "32 TB/month bandwidth" },
  { label: "50 TB", value: 50, description: "50 TB/month bandwidth" },
  { label: "Unmetered", value: 100, description: "Unlimited bandwidth" },
] as const

/**
 * Billing terms with labels
 * Discounts are defined in pricing.ts
 */
export const BILLING_TERMS = [
  { value: 1, label: "Monthly", discount: 0 },
  { value: 3, label: "3 Months", discount: 10 },
  { value: 6, label: "6 Months", discount: 15 },
  { value: 12, label: "1 Year", discount: 20 },
  { value: 24, label: "2 Years", discount: 25 },
] as const

/**
 * Predefined Cloud Instance plans
 * These are the preset options shown on the homepage
 */
export const PREDEFINED_VPS_PLANS = [
  {
    id: "starter",
    name: "Starter",
    slug: "starter",
    description: "Perfect for small projects",
    cpu: 2,
    ram: 4,
    disks: [{ type: "nvme" as const, sizeGb: 80 }],
    bandwidth: 2,
    priceMonthly: 800,
  },
  {
    id: "growth",
    name: "Growth",
    slug: "growth",
    description: "For growing applications",
    cpu: 4,
    ram: 16,
    disks: [{ type: "nvme" as const, sizeGb: 160 }],
    bandwidth: 4,
    priceMonthly: 1800,
  },
  {
    id: "professional",
    name: "Professional",
    slug: "professional",
    description: "High-performance option",
    cpu: 8,
    ram: 32,
    disks: [{ type: "nvme" as const, sizeGb: 320 }],
    bandwidth: 8,
    priceMonthly: 3800,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    slug: "enterprise",
    description: "For demanding workloads",
    cpu: 16,
    ram: 64,
    disks: [
      { type: "nvme" as const, sizeGb: 500 },
      { type: "ssd" as const, sizeGb: 1000 },
    ],
    bandwidth: 16,
    priceMonthly: 7500,
  },
  {
    id: "ultimate",
    name: "Ultimate",
    slug: "ultimate",
    description: "Maximum performance",
    cpu: 32,
    ram: 128,
    disks: [
      { type: "nvme" as const, sizeGb: 1000 },
      { type: "nvme" as const, sizeGb: 500 },
    ],
    bandwidth: 32,
    priceMonthly: 14000,
  },
  {
    id: "dedicated",
    name: "Dedicated",
    slug: "dedicated",
    description: "Custom specifications",
    cpu: 48,
    ram: 256,
    disks: [
      { type: "nvme" as const, sizeGb: 1500 },
      { type: "ssd" as const, sizeGb: 2000 },
      { type: "ssd" as const, sizeGb: 1000 },
    ],
    bandwidth: 50,
    priceMonthly: 22000,
  },
] as const

/**
 * Helper function: Get total storage from disk array
 */
export function getTotalStorageGb(disks: DiskConfig[]): number {
  return disks.reduce((sum, disk) => sum + disk.sizeGb, 0)
}

/**
 * Helper function: Get disk count
 */
export function getDiskCount(disks: DiskConfig[]): number {
  return disks.length
}

/**
 * Helper function: Get disk labels for display
 */
export function getDiskLabels(disks: DiskConfig[]): string {
  return disks.map((d, i) => `${d.label || `Disk ${i + 1}`} (${d.sizeGb}GB ${d.type.toUpperCase()})`).join(" + ")
}

/**
 * Validation: Check if disk configuration is valid
 */
export function validateDisks(disks: DiskConfig[]): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (disks.length < CONFIGURATOR_LIMITS.disks.min) {
    errors.push(`At least ${CONFIGURATOR_LIMITS.disks.min} disk is required`)
  }

  if (disks.length > CONFIGURATOR_LIMITS.disks.max) {
    errors.push(`Maximum ${CONFIGURATOR_LIMITS.disks.max} disks allowed`)
  }

  disks.forEach((disk, i) => {
    if (!["nvme", "ssd"].includes(disk.type)) {
      errors.push(`Disk ${i + 1}: Invalid storage type`)
    }

    const limits = disk.type === "nvme" 
      ? CONFIGURATOR_LIMITS.storage.nvme 
      : CONFIGURATOR_LIMITS.storage.ssd

    if (disk.sizeGb < limits.min || disk.sizeGb > limits.max) {
      errors.push(`Disk ${i + 1}: Size must be between ${limits.min}GB and ${limits.max}GB`)
    }
  })

  return { valid: errors.length === 0, errors }
}
