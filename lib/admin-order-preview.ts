import { calculateBulkPricing, normalizeOrderQuantity } from "@/lib/order-bulk"

export type AdminProvisioningMode =
  | "auto_provision"
  | "link_existing_vm"
  | "external_vm_attachment"
  | "manual_provision_complete"

export type AdminOrderPreviewInput = {
  provisioningMode?: unknown
  termMonths?: unknown
  quantity?: unknown
  discountAmount?: unknown
  backupEnabled?: unknown
  snapshotCount?: unknown
  ipv4Count?: unknown
  product?: any
  offer?: any
  operatingSystem?: any
  selectedNode?: any
  external?: Record<string, any> | null
  manual?: Record<string, any> | null
}

const VALID_TERMS = new Set([1, 3, 6, 12, 24, 36])

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
}

function intValue(value: unknown, fallback = 0) {
  const parsed = Math.floor(Number(value ?? fallback))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeAdminProvisioningMode(value: unknown): AdminProvisioningMode {
  const raw = String(value || "").trim().toLowerCase()
  if (["link_existing_vm", "linked", "link_existing"].includes(raw)) return "link_existing_vm"
  if (["external_vm_attachment", "external", "external_vm"].includes(raw)) return "external_vm_attachment"
  if (["manual_provision_complete", "manual_complete", "manual"].includes(raw)) return "manual_provision_complete"
  return "auto_provision"
}

export function normalizeAdminOrderTerm(value: unknown) {
  const term = intValue(value, 1)
  return VALID_TERMS.has(term) ? term : 1
}

export function billingCycleForTerm(termMonths: unknown) {
  const term = normalizeAdminOrderTerm(termMonths)
  return term === 1 ? "monthly" : `${term}m`
}

function termPriceForProduct(product: any, termMonths: number) {
  if (!product) return 0
  const field = `price${termMonths}m`
  const selected = product[field]
  return money(selected ?? product.price1m)
}

function basePrice(input: AdminOrderPreviewInput, termMonths: number) {
  if (input.offer) return money(input.offer.offerMonthlyPrice) * termMonths
  return termPriceForProduct(input.product, termMonths)
}

function addonPricing(input: AdminOrderPreviewInput, termMonths: number) {
  const product = input.product
  if (!product) {
    return {
      backup: { enabled: false, monthlyPrice: 0, termPrice: 0, storageGb: 0 },
      snapshots: { requested: 0, included: 0, billable: 0, monthlyPrice: 0, termPrice: 0 },
      ipv4: { requested: 1, additional: 0, monthlyPrice: 0, termPrice: 0 },
      totalTermPrice: 0,
    }
  }

  const backupEnabled = Boolean(input.backupEnabled) && Boolean(product.backupEnabled)
  const backupMonthly = backupEnabled ? money(product.backupPrice) : 0
  const snapshotRequested = Math.max(0, intValue(input.snapshotCount, Number(product.snapshotIncludedCount || 0)))
  const snapshotIncluded = Math.max(0, intValue(product.snapshotIncludedCount, 0))
  const snapshotBillable = product.snapshotEnabled ? Math.max(0, snapshotRequested - snapshotIncluded) : 0
  const snapshotMonthly = money(snapshotBillable * money(product.snapshotPrice))
  const ipv4Requested = Math.max(1, intValue(input.ipv4Count, 1))
  const additionalIpv4 = Math.max(0, ipv4Requested - 1)
  const ipv4Monthly = money(additionalIpv4 * money(product.extraIpv4Price))
  const totalMonthly = money(backupMonthly + snapshotMonthly + ipv4Monthly)

  return {
    backup: {
      enabled: backupEnabled,
      monthlyPrice: backupMonthly,
      termPrice: money(backupMonthly * termMonths),
      storageGb: intValue(product.backupStorageGb, 0),
    },
    snapshots: {
      requested: snapshotRequested,
      included: snapshotIncluded,
      billable: snapshotBillable,
      monthlyPrice: snapshotMonthly,
      termPrice: money(snapshotMonthly * termMonths),
    },
    ipv4: {
      requested: ipv4Requested,
      additional: additionalIpv4,
      monthlyPrice: ipv4Monthly,
      termPrice: money(ipv4Monthly * termMonths),
    },
    totalTermPrice: money(totalMonthly * termMonths),
  }
}

function resourceNumber(primary: unknown, fallback: unknown, defaultValue = 0) {
  const parsed = Number(primary ?? fallback ?? defaultValue)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

export function calculateAdminOrderPreview(input: AdminOrderPreviewInput) {
  const mode = normalizeAdminProvisioningMode(input.provisioningMode)
  const termMonths = normalizeAdminOrderTerm(input.termMonths)
  const quantity = mode === "link_existing_vm" || mode === "external_vm_attachment" || mode === "manual_provision_complete"
    ? 1
    : normalizeOrderQuantity(input.quantity)
  const addons = addonPricing(input, termMonths)
  const unitPrice = money(basePrice(input, termMonths) + addons.totalTermPrice)
  const pricing = calculateBulkPricing({
    unitPrice,
    quantity,
    manualDiscount: input.discountAmount,
    taxRate: input.offer?.gstEnabled === false ? 0 : Number(input.offer?.gstPercent ?? 18),
  })
  const perItemDiscount = quantity > 0 ? money(pricing.discountAmount / quantity) : 0
  const perItemTax = quantity > 0 ? money(pricing.taxAmount / quantity) : 0
  const perItemTotal = quantity > 0 ? money(pricing.totalAmount / quantity) : 0

  const external = input.external || {}
  const manual = input.manual || {}
  const override = mode === "external_vm_attachment" ? external : mode === "manual_provision_complete" ? manual : {}
  const resourceSummary = {
    cpu: resourceNumber(override.cpu, input.offer?.vcpu ?? input.product?.cpuCores, 1),
    ramGb: resourceNumber(override.ramGb ?? override.ram, input.offer?.ramGb ?? input.product?.ramGb, 1),
    diskGb: resourceNumber(override.diskGb ?? override.disk, input.offer?.storageGb ?? input.product?.storageGb, 20),
    bandwidthTb: resourceNumber(override.bandwidthTb ?? override.bandwidth, input.offer?.bandwidthTb ?? input.product?.bandwidthTb, 0),
    backups: addons.backup.enabled ? "Enabled" : "Disabled",
    backupStorageGb: addons.backup.storageGb,
    snapshots: addons.snapshots.requested,
    includedSnapshots: addons.snapshots.included,
    additionalIps: addons.ipv4.additional,
  }
  const osName = String(override.operatingSystem || override.os || input.operatingSystem?.name || "").trim() || null
  const hostname = String(override.hostname || "").trim() || null
  const configSummary = {
    os: osName,
    hostname,
    node: input.selectedNode?.name || input.selectedNode?.nodeName || null,
    nodeId: input.selectedNode?.id || null,
    billingTerm: termMonths,
    provisionMethod: mode,
    provider: String(override.provider || override.externalProvider || "").trim() || null,
    location: String(override.location || "").trim() || null,
    externalVmId: String(override.externalVmId || override.vmId || "").trim() || null,
  }

  return {
    provisioningMode: mode,
    termMonths,
    quantity,
    unitPrice,
    pricing: {
      ...pricing,
      perItemDiscount,
      perItemTax,
      perItemTotal,
      taxLabel: "GST",
    },
    addons,
    resourceSummary,
    configSummary,
    pricingSnapshot: {
      unitPrice,
      quantity,
      subtotal: pricing.subtotal,
      discount: pricing.discountAmount,
      manualDiscount: pricing.manualDiscount,
      automaticBulkDiscount: pricing.automaticBulkDiscount,
      discountPercent: pricing.subtotal > 0 ? money((pricing.discountAmount / pricing.subtotal) * 100) : 0,
      taxableAmount: pricing.taxableAmount,
      gst: pricing.taxAmount,
      taxPercent: input.offer?.gstEnabled === false ? 0 : Number(input.offer?.gstPercent ?? 18),
      taxLabel: "GST",
      total: pricing.totalAmount,
      addons,
      resources: resourceSummary,
      config: configSummary,
    },
  }
}
