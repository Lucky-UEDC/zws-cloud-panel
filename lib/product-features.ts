import { formatBandwidthQuota } from "@/lib/bandwidth-format"

export type ProductSpecRow = {
  label: string
  value: string
}

type ProductFeatureInput = {
  cpuCores?: number | string | null
  ramGb?: number | string | null
  storageGb?: number | string | null
  storageType?: string | null
  requiredStorageType?: string | null
  bandwidthTb?: number | string | null
  specs?: Record<string, unknown> | ProductSpecRow[] | null
  regions?: unknown
  features?: unknown
}

const DEFAULT_NETWORK_FABRIC = "Up to 1.8 Tbps aggregate datacenter capacity"
const DEFAULT_FEATURES = ["DDoS Protection", "Priority Support", "Daily Backups"]
const CORE_SPEC_LABELS = new Set(["vcpu", "ram", "storage", "bandwidth", "includedbandwidth", "networkfabric", "region", "regions", "location"])

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function toNumber(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function normalizeStorageClass(product: ProductFeatureInput): string {
  const raw = String(product.requiredStorageType || product.storageType || "nvme").toLowerCase()
  if (raw.includes("hdd")) return "hdd"
  if (raw.includes("ssd") && !raw.includes("nvme")) return "ssd"
  return "nvme"
}

function storageFeatureLabel(product: ProductFeatureInput): string | null {
  const storageGb = toNumber(product.storageGb)
  if (!storageGb) return null
  const size = formatNumber(storageGb)
  const storageClass = normalizeStorageClass(product)
  if (storageClass === "hdd") return `${size} GB HDD Storage`
  if (storageClass === "ssd") return `${size} GB SSD Storage`
  return `${size} GB NVMe SSD`
}

function storageSpecValue(product: ProductFeatureInput): string | null {
  const storageGb = toNumber(product.storageGb)
  if (!storageGb) return null
  const storageClass = normalizeStorageClass(product)
  const label = storageClass === "hdd" ? "HDD" : storageClass === "ssd" ? "SSD" : "NVMe"
  return `${formatNumber(storageGb)} GB ${label}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : []
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of lines) {
    const trimmed = String(line || "").trim()
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function isGeneratedFeatureLine(line: string): boolean {
  return (
    /^\d+(?:\.\d+)?\s+vCPU Cores$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+GB DDR4 RAM$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+GB (?:NVMe SSD|SSD Storage|HDD Storage)$/i.test(line) ||
    /^\d+(?:\.\d+)?\s+(?:GB|TB) Bandwidth$/i.test(line) ||
    /^Available in .+/i.test(line) ||
    DEFAULT_FEATURES.some((feature) => feature.toLowerCase() === line.toLowerCase())
  )
}

function specsObject(specs: ProductFeatureInput["specs"]): Record<string, unknown> {
  if (!specs || typeof specs !== "object") return {}
  if (Array.isArray(specs)) {
    return specs.reduce<Record<string, unknown>>((acc, row) => {
      if (row?.label) acc[row.label] = row.value
      return acc
    }, {})
  }
  return specs
}

function findSpec(specs: Record<string, unknown>, keys: string[]): unknown {
  const normalized = new Map(Object.entries(specs).map(([key, value]) => [normalizeKey(key), value]))
  for (const key of keys) {
    const value = normalized.get(normalizeKey(key))
    if (value != null && String(value).trim()) return value
  }
  return null
}

function regionLabel(regions: unknown): string | null {
  if (!Array.isArray(regions)) return null
  const names = regions
    .map((region) => {
      if (typeof region === "string") return region
      if (!region || typeof region !== "object") return ""
      const row = region as Record<string, unknown>
      if (row.enabled === false) return ""
      return String(row.name || row.label || row.code || row.slug || "").trim()
    })
    .filter(Boolean)
  return names.length ? names.join(", ") : null
}

function supportFeature(value: unknown): string {
  const text = String(value || "").trim()
  if (!text) return "Priority Support"
  return /support$/i.test(text) ? text : `${text} Support`
}

function backupFeature(value: unknown): string {
  const text = String(value || "").trim()
  if (!text) return "Daily Backups"
  return /backup/i.test(text) ? text : `${text} Backups`
}

export function generateProductFeatures(product: ProductFeatureInput): string[] {
  const rawSpecs = specsObject(product.specs)
  const cpuCores = toNumber(product.cpuCores)
  const ramGb = toNumber(product.ramGb)
  const bandwidthTb = toNumber(product.bandwidthTb)
  const networkFabric = findSpec(rawSpecs, ["networkFabric", "network fabric", "fabric"])
  const region = regionLabel(product.regions) || findSpec(rawSpecs, ["region", "regions", "location"])
  const supportTier = findSpec(rawSpecs, ["supportTier", "support tier", "support"])
  const backupOptions = findSpec(rawSpecs, ["backupOptions", "backup options", "backups", "backup"])
  const generated = [
    cpuCores ? `${formatNumber(cpuCores)} vCPU Cores` : null,
    ramGb ? `${formatNumber(ramGb)} GB DDR4 RAM` : null,
    storageFeatureLabel(product),
    bandwidthTb ? `${formatBandwidthQuota(bandwidthTb)} Bandwidth` : null,
    "DDoS Protection",
    supportFeature(supportTier),
    backupFeature(backupOptions),
    networkFabric ? String(networkFabric) : null,
    region ? `Available in ${region}` : null,
  ].filter((line): line is string => Boolean(line))

  const generatedKeys = new Set(generated.map((line) => line.toLowerCase()))
  const customFeatures = stringArray(product.features).filter((line) => generatedKeys.has(line.toLowerCase()) || !isGeneratedFeatureLine(line))

  return uniqueLines([...generated, ...customFeatures])
}

export function generateProductSpecs(product: ProductFeatureInput): ProductSpecRow[] {
  const rawSpecs = specsObject(product.specs)
  const cpuCores = toNumber(product.cpuCores)
  const ramGb = toNumber(product.ramGb)
  const bandwidthTb = toNumber(product.bandwidthTb)
  const networkFabric = findSpec(rawSpecs, ["networkFabric", "network fabric", "fabric"]) || DEFAULT_NETWORK_FABRIC
  const region = regionLabel(product.regions) || findSpec(rawSpecs, ["region", "regions", "location"])

  const generated: ProductSpecRow[] = [
    cpuCores ? { label: "vCPU", value: `${formatNumber(cpuCores)} cores` } : null,
    ramGb ? { label: "RAM", value: `${formatNumber(ramGb)} GB` } : null,
    storageSpecValue(product) ? { label: "Storage", value: storageSpecValue(product)! } : null,
    bandwidthTb ? { label: "Included Bandwidth", value: formatBandwidthQuota(bandwidthTb) } : null,
    networkFabric ? { label: "Network Fabric", value: String(networkFabric) } : null,
    region ? { label: "Region", value: String(region) } : null,
  ].filter((row): row is ProductSpecRow => Boolean(row))

  const custom = Object.entries(rawSpecs)
    .filter(([label]) => !CORE_SPEC_LABELS.has(normalizeKey(label)))
    .map(([label, value]) => ({
      label,
      value: typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
    }))
    .filter((row) => row.label.trim() && row.value.trim())

  return [...generated, ...custom]
}
