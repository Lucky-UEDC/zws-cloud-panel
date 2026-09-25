import { createProxmoxClient } from "@/lib/proxmox"

const managedPlatformName = () => (process.env.NEXT_PUBLIC_APP_NAME || process.env.APP_NAME || "Cloud").trim() || "Cloud"

type VmNotesInput = {
  customerName?: string | null
  customerEmail?: string | null
  customerId: string
  orderId: string
  productId?: string | null
  productName?: string | null
  productTag?: string | null
  service?: string | null
  vmUuid?: string | null
  vmid?: number | null
  ip?: string | null
  mac?: string | null
  createdAt?: Date | string | null
  provisionedAt?: Date | string | null
  creator?: string | null
  nodeId?: string | null
  nodeName?: string | null
}

export function parseTagList(value: unknown): string[] {
  const raw = String(value || "").trim()
  if (!raw) return []
  return raw
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeTagValue(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9:_-]/g, "")
}

function normalizeCanonicalTagValue(value: string) {
  return normalizeTagValue(value).replace(/:/g, "-")
}

function noteValue(value: unknown, fallback = "-") {
  const text = String(value ?? "").trim()
  return text || fallback
}

function formatProvisionedAt(value: VmNotesInput["provisionedAt"]) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return noteValue(value)
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

export function buildVmIdentityTags(input: { orderId: string; customerId: string; productTag?: string | null }) {
  const product = normalizeCanonicalTagValue(String(input.productTag || "unknown"))
  return [
    `order-${normalizeCanonicalTagValue(input.orderId)}`,
    `customer-${normalizeCanonicalTagValue(input.customerId)}`,
    "service-zws",
    `product-${product || "unknown"}`,
  ]
}

export function parseVmIdentityTags(value: unknown) {
  const tags = parseTagList(value)
  const out: { orderId: string | null; customerId: string | null; service: string | null; product: string | null; raw: string[] } = {
    orderId: null,
    customerId: null,
    service: null,
    product: null,
    raw: tags,
  }

  for (const tag of tags) {
    const lower = tag.toLowerCase()
    if (lower.startsWith("order:")) out.orderId = tag.slice("order:".length)
    else if (lower.startsWith("order-")) out.orderId = tag.slice("order-".length)
    else if (lower.startsWith("customer:")) out.customerId = tag.slice("customer:".length)
    else if (lower.startsWith("customer-")) out.customerId = tag.slice("customer-".length)
    else if (lower.startsWith("service:")) out.service = tag.slice("service:".length).toLowerCase()
    else if (lower.startsWith("service-")) out.service = tag.slice("service-".length).toLowerCase()
    else if (lower.startsWith("product:")) out.product = tag.slice("product:".length)
    else if (lower.startsWith("product-")) out.product = tag.slice("product-".length)
  }

  return out
}

export function isSystemIdentityTag(tag: unknown) {
  const value = String(tag || "").trim().toLowerCase()
  return value.startsWith("customer-") ||
    value.startsWith("customer:") ||
    value.startsWith("order-") ||
    value.startsWith("order:") ||
    value.startsWith("product-") ||
    value.startsWith("product:") ||
    value === "service-zws" ||
    value === "service:zws"
}

export function removeSystemIdentityTags(value: unknown) {
  return parseTagList(value).filter((tag) => !isSystemIdentityTag(tag)).join(";")
}

export function buildVmNotes(input: VmNotesInput) {
  const service = noteValue(input.service || input.productTag || input.productName || "zws")
  const product = noteValue(input.productName || input.productTag || input.productId)
  const vmUuid = noteValue(input.vmUuid || input.customerId)
  const platformName = managedPlatformName()
  return [
    `${platformName.toUpperCase()} MANAGED VM`,
    "",
    "Customer:",
    noteValue(input.customerName || input.customerId).toUpperCase(),
    "",
    "Order ID:",
    noteValue(input.orderId),
    "",
    "Service:",
    service,
    "",
    "Product:",
    product,
    "",
    "VM UUID:",
    vmUuid,
    "",
    "Provisioned:",
    formatProvisionedAt(input.provisionedAt),
    "",
    "Managed By:",
    `${platformName} Automation`,
    "",
    "--- INTERNAL METADATA ---",
    "",
    `ORDER_ID=${noteValue(input.orderId)}`,
    `CUSTOMER_ID=${noteValue(input.customerId)}`,
    `SERVICE_ID=${vmUuid}`,
    `VM_UUID=${vmUuid}`,
    `VMID=${noteValue(input.vmid)}`,
    `IP=${noteValue(input.ip)}`,
    `MAC=${noteValue(input.mac)}`,
    `CREATED_AT=${formatProvisionedAt(input.createdAt || input.provisionedAt)}`,
    `ZWS_ORDER=${noteValue(input.orderId)}`,
    `ZWS_SERVICE=${vmUuid}`,
    `ZWS_CUSTOMER=${noteValue(input.customerId)}`,
    `ZWS_EMAIL=${noteValue(input.customerEmail)}`,
    `ZWS_UUID=${vmUuid}`,
    `UUID=${vmUuid}`,
    `customer_id=${noteValue(input.customerId)}`,
    `order_id=${noteValue(input.orderId)}`,
    `product_id=${noteValue(input.productId || input.productTag || product)}`,
    `service=${noteValue(input.service || "zws")}`,
    "managed=true",
    `vm_uuid=${vmUuid}`,
    `creator=${noteValue(input.creator || "panel")}`,
    `node_id=${noteValue(input.nodeId)}`,
    `node_name=${noteValue(input.nodeName)}`,
    `ownership_timestamp=${formatProvisionedAt(input.provisionedAt)}`,
    "",
  ].join("\n")
}

export function extractMetadataFromNotes(value: unknown) {
  const text = String(value || "")
  const metadata: Record<string, string> = {}
  const lines = text.split(/\r?\n/)
  let previousKey: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === "---" || /^-+$/.test(line)) continue
    const keyValue = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/)
    if (keyValue) {
      previousKey = keyValue[1].trim().toLowerCase()
      metadata[previousKey] = keyValue[2].trim()
      continue
    }
    const yaml = line.match(/^([A-Za-z0-9_. -]+):\s*(.*)$/)
    if (yaml) {
      previousKey = yaml[1].trim().toLowerCase().replace(/\s+/g, "_")
      if (yaml[2].trim()) metadata[previousKey] = yaml[2].trim()
      continue
    }
    if (previousKey && !metadata[previousKey]) {
      metadata[previousKey] = line
      previousKey = null
    }
  }

  return {
    ...metadata,
    customerId: metadata.zws_customer || metadata.customer_id || metadata.customer || null,
    customerEmail: metadata.zws_email || metadata.customer_email || metadata.email || null,
    orderId: metadata.zws_order || metadata.order_id || metadata.order || null,
    productId: metadata.product_id || metadata.product || null,
    service: metadata.zws_service || metadata.service || null,
    serviceId: metadata.zws_service || metadata.service_id || metadata.service || null,
    vmUuid: metadata.zws_uuid || metadata.uuid || metadata.vm_uuid || metadata.vm_id || metadata.zws_service || null,
    vmid: metadata.vmid ? Number(metadata.vmid) : null,
    ip: metadata.ip || metadata.public_ip || null,
    mac: metadata.mac || metadata.mac_address || null,
    createdAt: metadata.created_at || metadata.ownership_timestamp || null,
    creator: metadata.creator || null,
    nodeId: metadata.node_id || null,
    nodeName: metadata.node_name || null,
    managed: /^(true|1|yes)$/i.test(String(metadata.managed || "")),
    raw: text,
  }
}

export function vmIdentityNotesMatch(value: unknown, input: { orderId: string; customerId: string; vmUuid?: string | null }) {
  const parsed = extractMetadataFromNotes(value)
  const orderMatch = Boolean(parsed.orderId && String(parsed.orderId) === String(input.orderId))
  const customerMatch = Boolean(parsed.customerId && String(parsed.customerId) === String(input.customerId))
  const vmUuidMatch = Boolean(input.vmUuid && parsed.vmUuid && String(parsed.vmUuid) === String(input.vmUuid))
  const managed = parsed.managed || String(parsed.service || "").toLowerCase() === "zws"
  return {
    orderMatch,
    customerMatch,
    vmUuidMatch,
    serviceMatch: managed,
    highConfidence: orderMatch && managed,
    mediumConfidence: (customerMatch || vmUuidMatch) && managed,
    parsed,
  }
}

export function vmIdentityTagsMatch(value: unknown, input: { orderId: string; customerId: string }) {
  const parsed = parseVmIdentityTags(value)
  const orderId = normalizeCanonicalTagValue(input.orderId)
  const customerId = normalizeCanonicalTagValue(input.customerId)
  const parsedOrder = parsed.orderId ? normalizeCanonicalTagValue(parsed.orderId) : null
  const parsedCustomer = parsed.customerId ? normalizeCanonicalTagValue(parsed.customerId) : null
  const service = String(parsed.service || "").toLowerCase()
  const orderMatch = parsedOrder === orderId
  const customerMatch = parsedCustomer === customerId
  const serviceMatch = service === "zws" || service === "vps"
  return {
    orderMatch,
    customerMatch,
    serviceMatch,
    highConfidence: orderMatch && serviceMatch,
    mediumConfidence: customerMatch && serviceMatch,
    parsed,
  }
}

export function mergeProxmoxTags(existing: unknown, required: string[]) {
  const current = parseTagList(existing)
  const lower = new Set(current.map((tag) => tag.toLowerCase()))
  const merged = [...current]
  for (const tag of required) {
    const normalized = normalizeTagValue(tag)
    if (!normalized) continue
    if (lower.has(normalized.toLowerCase())) continue
    merged.push(normalized)
    lower.add(normalized.toLowerCase())
  }
  return merged.join(";")
}

export async function ensureVmIdentityTags(input: {
  host: string
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
  nodeName: string
  vmid: number
  orderId: string
  customerId: string
  productTag?: string | null
  customerName?: string | null
  customerEmail?: string | null
  productName?: string | null
  service?: string | null
  vmUuid?: string | null
  provisionedAt?: Date | string | null
  creator?: string | null
  nodeId?: string | null
}) {
  return ensureVmIdentityNotes(input)
}

export async function ensureVmIdentityNotes(input: {
  host: string
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
  nodeName: string
  vmid: number
  orderId: string
  customerId: string
  productTag?: string | null
  productId?: string | null
  customerName?: string | null
  customerEmail?: string | null
  productName?: string | null
  service?: string | null
  vmUuid?: string | null
  provisionedAt?: Date | string | null
  creator?: string | null
  nodeId?: string | null
}) {
  const client = createProxmoxClient(input.host, input.tokenId, input.tokenSecret, {
    allowInsecureTls: input.allowInsecureTls,
  })
  const config = await client.getVMConfig(input.nodeName, input.vmid).catch(() => ({}))
  const description = buildVmNotes({
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerId: input.customerId,
    orderId: input.orderId,
    productId: input.productId || input.productTag || null,
    productName: input.productName,
    productTag: input.productTag,
    service: input.service || "zws",
    vmUuid: input.vmUuid || input.customerId,
    provisionedAt: input.provisionedAt,
    creator: input.creator || "panel",
    nodeId: input.nodeId || null,
    nodeName: input.nodeName,
  })
  const cleanedTags = removeSystemIdentityTags((config as any)?.tags)
  const patch: Record<string, any> = { description }
  if (String((config as any)?.tags || "") !== cleanedTags) patch.tags = cleanedTags
  if (String((config as any)?.description || "") === description && !("tags" in patch)) {
    return { updated: false, description, tags: cleanedTags }
  }
  await client.updateVMConfig(input.nodeName, input.vmid, patch)
  return { updated: true, description, tags: cleanedTags }
}

export async function migrateLegacyIdentityTagsToNotes(input: Parameters<typeof ensureVmIdentityNotes>[0]) {
  return ensureVmIdentityNotes(input)
}
