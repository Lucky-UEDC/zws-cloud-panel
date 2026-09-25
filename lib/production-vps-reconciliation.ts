import "dotenv/config"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_METRICS_TIMEOUT_MS } from "@/lib/proxmox"
import { withRedisLock } from "@/lib/redis"
import { extractConfiguredVmIp } from "@/lib/vm-ip-discovery"
import { collectGuestDiskUsage } from "@/lib/vm-guest-disk"
import { dbStatusFromPowerState, normalizeProxmoxPowerState } from "@/lib/vm-runtime-status"
import { extractMetadataFromNotes, parseVmIdentityTags } from "@/lib/proxmox-tags"
import { writeStructuredLog } from "@/lib/structured-logger"
import { ensureProvisioningIdentity } from "@/lib/provisioning-identity"

const LOCK_KEY = "lock:production-vps-reconciliation"
const LOCK_TTL_MS = 4 * 60 * 1000
const ACTIVE_IP_STATUSES = ["active", "assigned", "used", "reserved", "pending", "moved"]
const STALE_AFTER_MS = 2 * 60 * 1000

export type ReconcileMode = "dry-run" | "apply"

export type ProductionVpsReconciliationOptions = {
  mode?: ReconcileMode
  reportPath?: string | null
  limit?: number | null
  vpsId?: string | null
  actor?: string
  scheduled?: boolean
}

export type ProductionVpsReconciliationRow = {
  vpsInstanceId: string
  orderId: string | null
  orderNumber: string | null
  vmid: number
  proxmoxNodeId: string | null
  node: string | null
  hostname: string | null
  dbIp: string | null
  cloudInitIp: string | null
  guestAgentIp: string | null
  currentProxmoxIp: string | null
  primaryPoolIp: string | null
  mac: string | null
  guestAgentStatus: "online" | "offline" | "not_checked"
  powerStatus: string
  disk: {
    configuredGb: number | null
    usedGb: number | null
    usageStatus: "reported" | "usage_unavailable" | "not_reported"
  }
  network: {
    netInBytes: string
    netOutBytes: string
    hasTrafficSample: boolean
  }
  monitoring: "active" | "monitoring_unavailable" | "guest_agent_offline" | "offline"
  billingLinked: boolean
  consoleAvailable: boolean
  repairActions: string[]
  remainingFailures: string[]
  quarantinedIncidents: string[]
}

export type ProductionVpsReconciliationReport = {
  generatedAt: string
  mode: ReconcileMode
  scanned: number
  repaired: number
  ipsRepaired: number
  monitoringRepaired: number
  diskRepaired: number
  networkRepaired: number
  activityErrorsCleared: number
  missingVmsMarked: number
  vmsReconstructed: number
  ordersRepaired: number
  customersRepaired: number
  billingRepaired: number
  dnsRepaired: number
  provisioningIdentitiesRepaired: number
  duplicateVmsFound: number
  duplicateIpsFound: number
  inventoryScanned: number
  orphanVmsQuarantined: number
  identityMappingsRepaired: number
  quarantinedIncidents: Array<{ vpsInstanceId: string; orderId: string | null; vmid: number; reason: string; status: string; nextAction: string }>
  remainingFailures: Array<{ vpsInstanceId: string; orderId: string | null; vmid: number; reason: string; nextAction: string }>
  rows: ProductionVpsReconciliationRow[]
}

async function quarantineReconciliationIncident(input: {
  type: string
  nodeId?: string | null
  nodeName?: string | null
  vmid?: number | null
  vpsInstanceId?: string | null
  orderId?: string | null
  customerId?: string | null
  reason: string
  evidence?: Record<string, unknown>
}) {
  const fingerprint = [input.type, input.nodeId || "none", input.vmid || "none", input.vpsInstanceId || "none", input.orderId || "none"].join(":")
  return (prisma as any).vmReconciliationIncident.upsert({
    where: { fingerprint },
    create: {
      fingerprint, type: input.type, status: "QUARANTINED", proxmoxNodeId: input.nodeId || null,
      nodeName: input.nodeName || null, vmid: input.vmid || null, vpsInstanceId: input.vpsInstanceId || null,
      orderId: input.orderId || null, customerId: input.customerId || null, reason: input.reason, evidence: input.evidence || {},
    },
    update: {
      status: "QUARANTINED", lastSeenAt: new Date(), reason: input.reason,
      proxmoxNodeId: input.nodeId || null, nodeName: input.nodeName || null, vmid: input.vmid || null,
      vpsInstanceId: input.vpsInstanceId || null, orderId: input.orderId || null, customerId: input.customerId || null,
      evidence: input.evidence || {}, resolvedAt: null, resolution: {},
    },
  })
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function missingIpIsAllowedForService(vps: any, powerStatus: string, existingPrimary: any) {
  if (existingPrimary || vps.ipAddress || powerStatus === "running") return false
  const statuses = [
    vps.status,
    vps.order?.provisioningStatus,
    vps.order?.status,
  ].map((value) => String(value || "").trim().toLowerCase())
  return statuses.some((status) => ["suspended", "deleted", "terminated", "cancelled", "canceled"].includes(status))
}

function safeBigInt(value: unknown) {
  return BigInt(Math.max(0, Math.floor(numberValue(value))))
}

function bytesToGb(value: unknown) {
  const bytes = numberValue(value)
  return bytes > 0 ? Math.max(1, Math.round(bytes / 1024 / 1024 / 1024)) : null
}

function isUsableIpv4(value: unknown) {
  const ip = String(value || "").trim()
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  const parts = ip.split(".").map(Number)
  return parts.every((part) => part >= 0 && part <= 255) && !ip.startsWith("127.") && !ip.startsWith("169.254.") && ip !== "0.0.0.0"
}

function parseIpConfig(value: unknown) {
  const text = String(value || "")
  const ip = text.match(/(?:^|,)ip=([^,\s/]+)/i)?.[1] || null
  const gateway = text.match(/(?:^|,)gw=([^,\s]+)/i)?.[1] || null
  const cidr = Number(text.match(/(?:^|,)ip=[^,\s/]+\/(\d+)/i)?.[1] || 24)
  return { ip: isUsableIpv4(ip) ? ip : null, gateway, cidr: Number.isFinite(cidr) ? cidr : 24 }
}

function cleanText(value: unknown) {
  return String(value || "").trim()
}

function metadataObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function compactStrings(values: Array<unknown>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))]
}

function firstUsableIpv4(values: Array<unknown>) {
  return values.map((value) => cleanText(value)).find(isUsableIpv4) || null
}

function inferOsFamily(config: Record<string, any> | null | undefined, fallback?: unknown) {
  const text = [config?.ostype, config?.name, config?.description, fallback].map((value) => cleanText(value).toLowerCase()).join(" ")
  if (text.includes("win")) return "windows"
  if (text.includes("ubuntu")) return "ubuntu"
  if (text.includes("debian")) return "debian"
  if (text.includes("centos")) return "centos"
  if (text.includes("alma")) return "almalinux"
  if (text.includes("rocky")) return "rocky"
  return cleanText(config?.ostype || fallback) || null
}

function buildInventoryEvidence(input: { node: any; vm: any; config: Record<string, any> | null }) {
  const notes = extractMetadataFromNotes(input.config?.description)
  const tags = parseVmIdentityTags(input.config?.tags)
  const metadata = metadataObject((input.vm as any)?.metadata)
  const ipconfig = parseIpConfig(input.config?.ipconfig0)
  const ip = firstUsableIpv4([notes.ip, metadata.ipAddress, metadata.ip, ipconfig.ip, extractConfiguredVmIp(input.config)])
  const mac = cleanText(notes.mac || metadata.mac || macFromConfig(input.config)) || null
  const productEvidence = cleanText(notes.productId || tags.product || metadata.productId || metadata.product || "")
  return {
    notes,
    tags,
    metadata,
    orderIds: compactStrings([notes.orderId, tags.orderId, metadata.orderId, metadata.order_id]),
    customerIds: compactStrings([notes.customerId, tags.customerId, metadata.customerId, metadata.customer_id]),
    customerEmails: compactStrings([notes.customerEmail, metadata.customerEmail, metadata.email]),
    productEvidence,
    serviceIds: compactStrings([notes.serviceId, notes.vmUuid, metadata.vpsInstanceId, metadata.serviceId, metadata.vmUuid]),
    vmid: Number(input.vm?.vmid || notes.vmid || 0),
    hostname: cleanText(input.config?.name || input.vm?.name || metadata.hostname || "") || null,
    ip,
    gateway: ipconfig.gateway,
    cidr: ipconfig.cidr,
    dns: cleanText(input.config?.nameserver || input.config?.dns || metadata.dns || "") || null,
    mac,
    osFamily: inferOsFamily(input.config, metadata.os || metadata.osName),
    createdAt: notes.createdAt ? new Date(notes.createdAt) : null,
    managed: Boolean(notes.managed || tags.service === "zws" || metadata.managed === true),
  }
}

async function findUniqueByCandidates<T>(loader: (value: string) => Promise<T | null>, values: string[]) {
  const found: T[] = []
  for (const value of values) {
    const row = await loader(value).catch(() => null)
    if (row && !found.includes(row)) found.push(row)
  }
  return found.length === 1 ? found[0] : null
}

async function findOrderFromEvidence(evidence: ReturnType<typeof buildInventoryEvidence>, nodeId: string): Promise<any | null> {
  const direct = await findUniqueByCandidates((id) => prisma.order.findUnique({
    where: { id },
    include: { customer: true, product: true, vpsInstance: true },
  }) as any, evidence.orderIds)
  if (direct) return direct

  const jobs = await (prisma as any).provisioningJob.findMany({
    where: { proxmoxNodeId: nodeId, vmid: evidence.vmid, orderId: { not: null } },
    select: { orderId: true },
    distinct: ["orderId"],
    take: 2,
  }).catch(() => [])
  if (jobs.length === 1 && jobs[0]?.orderId) {
    return prisma.order.findUnique({ where: { id: jobs[0].orderId }, include: { customer: true, product: true, vpsInstance: true } })
  }

  const logs = await prisma.$queryRaw<Array<{ order_id: string }>>`
    select distinct "orderId" as order_id from panel_logs
    where "orderId" is not null and vmid = ${evidence.vmid}
    limit 2
  `.catch(() => [])
  if (logs.length === 1 && logs[0]?.order_id) {
    return prisma.order.findUnique({ where: { id: logs[0].order_id }, include: { customer: true, product: true, vpsInstance: true } })
  }
  return null
}

async function findCustomerFromEvidence(evidence: ReturnType<typeof buildInventoryEvidence>, order: any | null): Promise<any | null> {
  if (order?.customer) return order.customer
  const direct = await findUniqueByCandidates((id) => prisma.customer.findUnique({ where: { id } }) as any, evidence.customerIds)
  if (direct) return direct
  const byEmail = await findUniqueByCandidates((email) => prisma.customer.findUnique({ where: { email } }) as any, evidence.customerEmails)
  if (byEmail) return byEmail
  return null
}

async function findProductFromEvidence(evidence: ReturnType<typeof buildInventoryEvidence>, order: any | null): Promise<any | null> {
  if (order?.product) return order.product
  const value = evidence.productEvidence
  if (!value) return null
  const product = await prisma.product.findFirst({
    where: {
      deletedAt: null,
      OR: [{ id: value }, { slug: value }, { name: { equals: value, mode: "insensitive" } }],
    },
    orderBy: { createdAt: "asc" },
  }).catch(() => null)
  return product
}

async function findPoolForIp(input: { ip: string; nodeId?: string | null; gateway?: string | null; existingPoolId?: string | null }) {
  const exactAllocation = await prisma.ipAllocation.findFirst({ where: { ipAddress: input.ip }, include: { pool: true }, orderBy: { createdAt: "asc" } }).catch(() => null)
  if (exactAllocation?.pool) return { pool: exactAllocation.pool, allocation: exactAllocation }
  if (input.existingPoolId) {
    const pool = await prisma.ipPool.findUnique({ where: { id: input.existingPoolId } }).catch(() => null)
    if (pool) return { pool, allocation: null }
  }
  const octets = input.ip.split(".")
  const prefix = octets.length === 4 ? `${octets.slice(0, 3).join(".")}.` : ""
  const pools = await prisma.ipPool.findMany({ where: { isActive: true }, orderBy: [{ proxmoxNodeId: "asc" }, { createdAt: "asc" }] }).catch(() => [])
  const matching = pools.filter((pool) => {
    const gateway = cleanText(pool.gateway)
    return (input.gateway && gateway === input.gateway) || (prefix && gateway.startsWith(prefix))
  })
  const nodeMatching = matching.filter((pool) => pool.proxmoxNodeId === input.nodeId)
  const selected = nodeMatching.length === 1 ? nodeMatching[0] : matching.length === 1 ? matching[0] : null
  return { pool: selected, allocation: null }
}

async function createRecoveredOrder(input: { evidence: ReturnType<typeof buildInventoryEvidence>; customer: any; product: any | null; node: any }) {
  if (!input.customer || !input.product) return null
  const orderNumber = `RECOVER-${input.evidence.vmid}-${Date.now()}`
  const price = input.product.price1m || 0
  return prisma.order.create({
    data: {
      orderNumber,
      customerId: input.customer.id,
      productId: input.product.id,
      orderType: "recovered_vm",
      termMonths: 1,
      unitPrice: price,
      quantity: 1,
      subtotal: price,
      taxAmount: 0,
      discountAmount: 0,
      totalAmount: price,
      originalAmount: price,
      finalAmount: price,
      payableAmount: price,
      status: "active",
      provisioningStatus: "ACTIVE",
      provisionedAt: input.evidence.createdAt && !Number.isNaN(input.evidence.createdAt.getTime()) ? input.evidence.createdAt : new Date(),
      hostname: input.evidence.hostname,
      proxmoxNodeId: input.node.id,
      proxmoxNode: input.node.nodeName,
      vmId: input.evidence.vmid,
      metadata: { recoveredBy: "production_vps_reconciliation", evidenceSource: "proxmox_inventory", customerId: input.customer.id, productId: input.product.id },
    },
    include: { customer: true, product: true, vpsInstance: true },
  })
}

async function createRecoveredVps(input: { evidence: ReturnType<typeof buildInventoryEvidence>; order: any; customer: any; product: any | null; node: any }) {
  const existing = await prisma.vpsInstance.findUnique({ where: { orderId: input.order.id } }).catch(() => null)
  if (existing) return existing
  const diskGb = Number(input.product?.storageGb || 0) || null
  return prisma.vpsInstance.create({
    data: {
      customerId: input.customer.id,
      orderId: input.order.id,
      productId: input.product?.id || input.order.productId || null,
      proxmoxNodeId: input.node.id,
      operatingSystemId: input.order.operatingSystemId || null,
      vmid: input.evidence.vmid,
      name: input.evidence.hostname || `vm-${input.evidence.vmid}`,
      hostname: input.evidence.hostname || `vm-${input.evidence.vmid}`,
      vmMacAddress: input.evidence.mac,
      status: "ACTIVE",
      ipAddress: input.evidence.ip,
      username: input.order.adminUsername || "root",
      adminUsername: input.order.adminUsername || "root",
      cpuCores: Number(input.product?.cpuCores || 0) || null,
      ramGb: Number(input.product?.ramGb || 0) || null,
      diskGb,
      diskTotalGb: diskGb,
      billingTermMonths: input.order.termMonths || 1,
      activatedAt: input.order.provisionedAt || new Date(),
      nextRenewalAt: input.order.provisionedAt ? new Date(new Date(input.order.provisionedAt).getTime() + (input.order.termMonths || 1) * 30 * 24 * 60 * 60 * 1000) : null,
      vmOsFamily: input.evidence.osFamily,
      ownershipVerifiedAt: new Date(),
      ownershipEvidence: { source: "production_vps_reconciliation", nodeId: input.node.id, nodeName: input.node.nodeName, vmid: input.evidence.vmid },
      lifecycleMetadata: { recoveredBy: "production_vps_reconciliation" },
    },
    include: { order: true, proxmoxNode: true },
  })
}

function macFromConfig(config: Record<string, any> | null | undefined) {
  for (const [key, value] of Object.entries(config || {})) {
    if (!/^net\d+$/i.test(key)) continue
    const match = String(value || "").match(/(?:^|=|,)([0-9a-f]{2}(?::[0-9a-f]{2}){5})(?:,|$)/i)
    if (match?.[1]) return match[1].toLowerCase()
  }
  return null
}

function diskGbFromConfig(config: Record<string, any> | null | undefined, runtime?: any) {
  const runtimeDisk = bytesToGb(runtime?.maxdisk)
  if (runtimeDisk) return runtimeDisk
  for (const key of ["scsi0", "virtio0", "sata0", "ide0"]) {
    const match = String(config?.[key] || "").match(/(?:size=)?(\d+(?:\.\d+)?)([TGMK])\b/i)
    if (!match) continue
    const amount = Number(match[1] || 0)
    const unit = String(match[2] || "G").toUpperCase()
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (unit === "T") return Math.round(amount * 1024)
    if (unit === "G") return Math.round(amount)
    if (unit === "M") return Math.max(1, Math.round(amount / 1024))
  }
  return null
}

function configuredMemoryGb(config: Record<string, any> | null | undefined, runtime?: any) {
  const memoryMb = numberValue(config?.memory)
  if (memoryMb > 0) return Math.max(1, Math.round(memoryMb / 1024))
  const runtimeBytes = numberValue(runtime?.maxmem)
  return runtimeBytes > 0 ? Math.max(1, Math.round(runtimeBytes / 1024 / 1024 / 1024)) : null
}

function cpuCores(config: Record<string, any> | null | undefined, runtime?: any) {
  const sockets = numberValue(config?.sockets) || 1
  const cores = numberValue(config?.cores)
  if (cores > 0) return Math.max(1, Math.round(cores * sockets))
  const runtimeCpus = numberValue(runtime?.cpus)
  return runtimeCpus > 0 ? Math.max(1, Math.round(runtimeCpus)) : null
}

function errorCode(error: any) {
  return String(error?.code || error?.proxmoxCode || error?.name || "")
}

function isMissingVmError(error: any) {
  const code = errorCode(error)
  const text = String(error?.proxmoxMessage || error?.message || error || "")
  return code === "VM_NOT_FOUND" || code === "NOT_FOUND_404" || /no such vm|vm \d+ not found|qemu-server\/\d+\.conf.*does not exist|does not exist/i.test(text)
}

function failureNextAction(reason: string) {
  if (reason.includes("duplicate_ip")) return "Resolve the conflicting IP owner, then rerun reconciliation."
  if (reason.includes("duplicate_vmid")) return "Merge/relink duplicate panel VPS rows before applying repair."
  if (reason.includes("proxmox_vm_missing")) return "Use the admin recreate/relink flow for the missing VMID."
  if (reason.includes("node_missing")) return "Attach the VPS to an active Proxmox node."
  if (reason.includes("ip_unavailable")) return "Assign a replacement IP only after qm config, cloud-init, and guest agent have no usable IP."
  return "Review the row details and rerun reconciliation after correction."
}

export function extractGuestIpv4Addresses(value: any): string[] {
  const rows = Array.isArray(value?.result)
    ? value.result
    : Array.isArray(value?.data?.result)
      ? value.data.result
      : Array.isArray(value)
        ? value
        : []
  const ips: string[] = []
  for (const row of rows) {
    const addresses = row?.["ip-addresses"] || row?.ipAddresses || row?.addresses || []
    for (const address of Array.isArray(addresses) ? addresses : []) {
      const ip = address?.["ip-address"] || address?.ip || address?.address
      const family = String(address?.["ip-address-type"] || address?.family || "").toLowerCase()
      if (family && !family.includes("ipv4")) continue
      if (isUsableIpv4(ip)) ips.push(String(ip))
    }
  }
  return [...new Set(ips)]
}

async function clearAssignedIpActivityErrors(input: { vps: any; mode: ReconcileMode; actions: string[] }) {
  if (input.mode !== "apply") return 0
  const whereText = "assigned_ip_missing_in_database"
  let cleared = 0
  const order = input.vps.order
  if (order?.provisioningError && String(order.provisioningError).includes(whereText)) {
    await prisma.order.update({ where: { id: order.id }, data: { provisioningError: null } })
    input.actions.push("order_error_cleared:assigned_ip_missing_in_database")
    cleared += 1
  }
  const jobs = await (prisma as any).provisioningJob.updateMany({
    where: {
      OR: [
        { vpsInstanceId: input.vps.id, errorCode: { contains: whereText } },
        { vpsInstanceId: input.vps.id, error: { contains: whereText } },
        { orderId: input.vps.orderId, errorCode: { contains: whereText } },
        { orderId: input.vps.orderId, error: { contains: whereText } },
      ],
    },
    data: { errorCode: null, error: null },
  }).catch(() => ({ count: 0 }))
  if (jobs.count) {
    input.actions.push(`provisioning_job_errors_cleared:${jobs.count}`)
    cleared += jobs.count
  }
  return cleared
}

async function writeReport(path: string, report: ProductionVpsReconciliationReport) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8")
}

async function runUnlocked(options: Required<Omit<ProductionVpsReconciliationOptions, "limit" | "vpsId" | "reportPath">> & {
  limit: number | null
  vpsId: string | null
  reportPath: string | null
}) {
  const now = new Date()
  const staleAfter = new Date(now.getTime() + STALE_AFTER_MS)
  const rows: ProductionVpsReconciliationRow[] = []
  const failures: ProductionVpsReconciliationReport["remainingFailures"] = []
  const quarantinedIncidents: ProductionVpsReconciliationReport["quarantinedIncidents"] = []
  const summary = {
    generatedAt: now.toISOString(),
    mode: options.mode,
    scanned: 0,
    repaired: 0,
    ipsRepaired: 0,
    monitoringRepaired: 0,
    diskRepaired: 0,
    networkRepaired: 0,
    activityErrorsCleared: 0,
    missingVmsMarked: 0,
    vmsReconstructed: 0,
    ordersRepaired: 0,
    customersRepaired: 0,
    billingRepaired: 0,
    dnsRepaired: 0,
    provisioningIdentitiesRepaired: 0,
    duplicateVmsFound: 0,
    duplicateIpsFound: 0,
    inventoryScanned: 0,
    orphanVmsQuarantined: 0,
    identityMappingsRepaired: 0,
  }

  const vpsRows = await prisma.vpsInstance.findMany({
    where: {
      deletedAt: null,
      vmid: { gt: 0 },
      ...(options.vpsId ? { OR: [{ id: options.vpsId }, { orderId: options.vpsId }] } : {}),
      ownershipStatus: { notIn: ["external", "manual", "rejected"] },
    },
    include: { order: true, proxmoxNode: true },
    orderBy: { createdAt: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  })

  const inventory = new Map<string, { node: any; vm: any; config: Record<string, any> | null }>()
  const activeNodes = await prisma.proxmoxNode.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  for (const node of activeNodes) {
    if (options.limit && summary.inventoryScanned >= options.limit) break
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: PROXMOX_METRICS_TIMEOUT_MS })
    const listed = await client.getVMList(node.nodeName).catch(async (error: any) => {
      await writeStructuredLog("proxmox-sync", "inventory_failed", { nodeId: node.id, node: node.nodeName, error })
      return []
    })
    for (const vm of listed) {
      if (options.limit && summary.inventoryScanned >= options.limit) break
      const vmid = Number(vm?.vmid || 0)
      if (!Number.isInteger(vmid) || vmid <= 0 || Number((vm as any)?.template || 0) === 1) continue
      const config = await client.getVMConfig(node.nodeName, vmid).catch(() => null)
      if (Number(config?.template || 0) === 1) continue
      inventory.set(`${node.id}:${vmid}`, { node, vm, config })
      summary.inventoryScanned += 1
    }
  }

  const directKeys = new Set(vpsRows.map((row) => `${row.proxmoxNodeId}:${row.vmid}`))
  for (const [key, discovered] of inventory) {
    if (directKeys.has(key)) continue
    const evidence = buildInventoryEvidence(discovered)
    const orderId = evidence.orderIds[0] || ""
    const customerId = evidence.customerIds[0] || ""
    let order = await findOrderFromEvidence(evidence, discovered.node.id)
    const customer = await findCustomerFromEvidence(evidence, order)
    const product = await findProductFromEvidence(evidence, order)
    if (!order && customer && product && evidence.managed && options.mode === "apply") {
      order = await createRecoveredOrder({ evidence, customer, product, node: discovered.node }).catch(async (error) => {
        await writeStructuredLog("proxmox-sync", "recovered_order_create_failed", { nodeId: discovered.node.id, vmid: evidence.vmid, error })
        return null
      })
      if (order) summary.ordersRepaired += 1
    }
    const candidates = order ? await prisma.vpsInstance.findMany({
      where: { orderId: order.id, deletedAt: null, ...(customer ? { customerId: customer.id } : {}) },
      include: { order: true, proxmoxNode: true },
      take: 2,
    }) : []
    let candidate = candidates.length === 1 ? candidates[0] as any : null
    if (!candidate && order && customer && options.mode === "apply") {
      candidate = await createRecoveredVps({ evidence, order, customer, product, node: discovered.node }).catch(async (error) => {
        await writeStructuredLog("proxmox-sync", "recovered_vps_create_failed", { orderId: order?.id, customerId: customer?.id, nodeId: discovered.node.id, vmid: evidence.vmid, error })
        return null
      })
      if (candidate) {
        summary.vmsReconstructed += 1
        summary.customersRepaired += customer ? 1 : 0
        directKeys.add(key)
        vpsRows.push(candidate as any)
      }
    }
    const oldKey = candidate ? `${candidate.proxmoxNodeId}:${candidate.vmid}` : ""
    const safeRelink = Boolean(candidate && !inventory.has(oldKey) && !vpsRows.some((row) => row.id !== candidate.id && row.proxmoxNodeId === discovered.node.id && row.vmid === Number(discovered.vm.vmid)))

    if (safeRelink && candidate) {
      if (options.mode === "apply") {
        await prisma.$transaction([
          prisma.vpsInstance.update({ where: { id: candidate.id }, data: { proxmoxNodeId: discovered.node.id, vmid: Number(discovered.vm.vmid), ownershipVerifiedAt: now, ownershipEvidence: { source: "proxmox_identity", orderId, customerId: customerId || candidate.customerId } } }),
          prisma.order.update({ where: { id: candidate.orderId }, data: { proxmoxNodeId: discovered.node.id, proxmoxNode: discovered.node.nodeName, vmId: Number(discovered.vm.vmid), serviceId: candidate.id } }),
        ])
        candidate.proxmoxNodeId = discovered.node.id
        candidate.vmid = Number(discovered.vm.vmid)
        ;(candidate as any).proxmoxNode = discovered.node
        directKeys.add(key)
      }
      summary.identityMappingsRepaired += 1
      continue
    }
    if (candidate && !safeRelink && oldKey === key) continue

    if (options.mode === "apply") {
      await quarantineReconciliationIncident({
        type: candidate ? "AMBIGUOUS_IDENTITY" : "ORPHAN_VM",
        nodeId: discovered.node.id,
        nodeName: discovered.node.nodeName,
        vmid: Number(discovered.vm.vmid),
        vpsInstanceId: candidate?.id || null,
        orderId: orderId || candidate?.orderId || null,
        customerId: customerId || candidate?.customerId || null,
        reason: candidate ? "Identity evidence conflicts with an existing live mapping" : "Proxmox VM has no deterministic database owner",
        evidence: {
          orderIds: evidence.orderIds,
          customerIds: evidence.customerIds,
          customerEmails: evidence.customerEmails,
          productEvidence: evidence.productEvidence,
          serviceIds: evidence.serviceIds,
          managed: evidence.managed,
        },
      })
    }
    summary.orphanVmsQuarantined += 1
  }

  for (const vps of vpsRows) {
    summary.scanned += 1
    const actions: string[] = []
    const rowFailures: string[] = []
    const rowQuarantinedIncidents: string[] = []
    const node = vps.proxmoxNode
    const duplicateVps = node
      ? await prisma.vpsInstance.findMany({
          where: { id: { not: vps.id }, deletedAt: null, proxmoxNodeId: node.id, vmid: vps.vmid },
          select: { id: true, orderId: true },
        })
      : []
    if (duplicateVps.length) {
      summary.duplicateVmsFound += duplicateVps.length
      rowFailures.push(`duplicate_vmid_rows:${duplicateVps.map((row) => row.id).join(",")}`)
    }

    const baseRow = {
      vpsInstanceId: vps.id,
      orderId: vps.orderId || null,
      orderNumber: vps.order?.orderNumber || null,
      vmid: vps.vmid,
      proxmoxNodeId: vps.proxmoxNodeId || null,
      node: node?.nodeName || null,
      hostname: vps.hostname || vps.name || null,
      dbIp: vps.ipAddress || null,
      cloudInitIp: null,
      guestAgentIp: null,
      currentProxmoxIp: null,
      primaryPoolIp: null,
      mac: vps.vmMacAddress || null,
      guestAgentStatus: "not_checked" as const,
      powerStatus: "unknown",
      disk: { configuredGb: vps.diskTotalGb ? Number(vps.diskTotalGb) : vps.diskGb || null, usedGb: vps.diskUsedGb ? Number(vps.diskUsedGb) : null, usageStatus: "not_reported" as const },
      network: { netInBytes: "0", netOutBytes: "0", hasTrafficSample: false },
      monitoring: "monitoring_unavailable" as const,
      billingLinked: Boolean(vps.order && vps.order.serviceId === vps.id && vps.order.vmId === vps.vmid && vps.order.proxmoxNodeId === vps.proxmoxNodeId),
      consoleAvailable: Boolean(vps.consoleEnabled && node?.nodeName && vps.vmid > 0),
      repairActions: actions,
      remainingFailures: rowFailures,
      quarantinedIncidents: rowQuarantinedIncidents,
    }

    if (!node?.isActive || !node?.nodeName) {
      rowFailures.push("node_missing_or_inactive")
      rows.push(baseRow)
      continue
    }

    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_METRICS_TIMEOUT_MS,
    })

    let runtime: any = null
    let config: Record<string, any> | null = null
    try {
      runtime = await client.getVMStatus(node.nodeName, vps.vmid)
    } catch (error: any) {
      if (isMissingVmError(error)) {
        rowFailures.push("proxmox_vm_missing")
        if (options.mode === "apply" && vps.status !== "MISSING") {
          await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "MISSING" } })
          await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "MISSING" } }).catch(() => null)
          actions.push("vps_marked_missing")
          summary.missingVmsMarked += 1
        } else if (options.mode === "dry-run") {
          actions.push("would_mark_missing")
        }
        rows.push({ ...baseRow, powerStatus: "missing", monitoring: "offline", repairActions: actions, remainingFailures: rowFailures, quarantinedIncidents: rowQuarantinedIncidents })
        continue
      }
      rowFailures.push(`proxmox_status_failed:${String(error?.message || error)}`)
      rows.push(baseRow)
      continue
    }

    config = await client.getVMConfig(node.nodeName, vps.vmid).catch(() => null)
    const powerStatus = normalizeProxmoxPowerState(runtime?.status)
    const dbStatus = dbStatusFromPowerState(powerStatus, vps.status || "UNKNOWN")
    const cloudInitIp = extractConfiguredVmIp(config) || parseIpConfig(config?.ipconfig0).ip
    const mac = macFromConfig(config)
    const diskConfiguredGb = diskGbFromConfig(config, runtime) || vps.diskGb || (vps.diskTotalGb ? Number(vps.diskTotalGb) : null)
    const ramGb = configuredMemoryGb(config, runtime)
    const cores = cpuCores(config, runtime)
    let guestAgentStatus = (powerStatus === "running" ? "offline" : "not_checked") as "online" | "offline" | "not_checked"
    let guestAgentIp: string | null = null
    let guestDisk: Awaited<ReturnType<typeof collectGuestDiskUsage>> | null = null

    if (powerStatus === "running") {
      await client.pingVMGuestAgent(node.nodeName, vps.vmid).then(() => { guestAgentStatus = "online" }).catch(() => { guestAgentStatus = "offline" })
      if (guestAgentStatus === "online") {
        const interfaces = await client.getVMGuestNetworkInterfaces(node.nodeName, vps.vmid).catch(() => null)
        guestAgentIp = extractGuestIpv4Addresses(interfaces)[0] || null
        guestDisk = await collectGuestDiskUsage({
          client,
          nodeName: node.nodeName,
          vmid: vps.vmid,
          osHint: vps.vmOsFamily || vps.name || vps.hostname,
        }).catch(() => null)
      }
    }

    const currentProxmoxIp = cloudInitIp || guestAgentIp || null
    const ipconfig = parseIpConfig(config?.ipconfig0)
    const primaryIp = currentProxmoxIp || vps.ipAddress

    const existingPrimary = await (prisma as any).ipAssignment.findFirst({
      where: { vpsInstanceId: vps.id, isPrimary: true, status: { in: ACTIVE_IP_STATUSES } },
      orderBy: [{ assignmentDate: "desc" }, { createdAt: "desc" }],
    }).catch(() => null)
    if (!primaryIp) {
      if (missingIpIsAllowedForService(vps, powerStatus, existingPrimary)) {
        actions.push("ip_not_required_for_inactive_service")
      } else {
        rowFailures.push("ip_unavailable_after_qm_cloud_init_guest_agent")
      }
    }
    let poolAllocation: any = primaryIp
      ? await prisma.ipAllocation.findFirst({
          where: { ipAddress: primaryIp, status: { in: ACTIVE_IP_STATUSES } },
          include: { pool: true },
          orderBy: { createdAt: "asc" },
        }).catch(() => null)
      : null
    const poolMatch = primaryIp
      ? await findPoolForIp({ ip: primaryIp, nodeId: node.id, gateway: ipconfig.gateway, existingPoolId: existingPrimary?.poolId || poolAllocation?.poolId || null })
      : { pool: null, allocation: null }
    if (!poolAllocation && poolMatch.allocation) poolAllocation = poolMatch.allocation as any
    const matchedPool = (poolAllocation as any)?.pool || poolMatch.pool || null
    let conflictingAssignment = primaryIp
      ? await (prisma as any).ipAssignment.findFirst({
          where: { assignedIp: primaryIp, vpsInstanceId: { not: vps.id }, status: { in: ACTIVE_IP_STATUSES } },
        }).catch(() => null)
      : null
    if (conflictingAssignment?.vpsInstanceId) {
      const conflictingOwner = await prisma.vpsInstance.findUnique({
        where: { id: conflictingAssignment.vpsInstanceId },
        select: { id: true, deletedAt: true, status: true },
      }).catch(() => null)
      const staleOwner = !conflictingOwner || Boolean(conflictingOwner.deletedAt) || ["deleted", "terminated", "cancelled", "canceled"].includes(String(conflictingOwner.status || "").toLowerCase())
      if (staleOwner) {
        actions.push(options.mode === "apply" ? `stale_ip_assignment_released:${conflictingAssignment.id}` : `would_release_stale_ip_assignment:${conflictingAssignment.id}`)
        if (options.mode === "apply") {
          await (prisma as any).ipAssignment.update({ where: { id: conflictingAssignment.id }, data: { status: "released", releasedAt: now } }).catch(() => null)
        }
        conflictingAssignment = null
      }
    }
    const conflictingVps = primaryIp
      ? await prisma.vpsInstance.findFirst({ where: { id: { not: vps.id }, deletedAt: null, ipAddress: primaryIp }, select: { id: true, orderId: true } }).catch(() => null)
      : null
    if (conflictingAssignment || conflictingVps) {
      summary.duplicateIpsFound += 1
      const conflictReason = `duplicate_ip_conflict:${primaryIp}`
      if (options.mode === "apply") {
        const incident = await quarantineReconciliationIncident({
          type: "DUPLICATE_IP", nodeId: node.id, nodeName: node.nodeName, vmid: vps.vmid,
          vpsInstanceId: vps.id, orderId: vps.orderId, customerId: vps.customerId,
          reason: `IP ${primaryIp} is claimed by more than one active service`,
          evidence: { ip: primaryIp, conflictingAssignmentId: conflictingAssignment?.id || null, conflictingVpsId: conflictingVps?.id || null },
        })
        rowQuarantinedIncidents.push(`${conflictReason}:${incident.id}`)
      } else {
        rowFailures.push(conflictReason)
      }
    }

    const previousMetrics = await (prisma as any).vmMetricsCache.findUnique({ where: { vpsInstanceId: vps.id } }).catch(() => null)
    const seconds = previousMetrics?.recordedAt ? Math.max(1, Math.floor((now.getTime() - new Date(previousMetrics.recordedAt).getTime()) / 1000)) : 0
    const netIn = safeBigInt(runtime?.netin)
    const netOut = safeBigInt(runtime?.netout)
    const rxRate = previousMetrics && seconds > 0 && netIn >= BigInt(previousMetrics.networkInBytes || 0) ? (netIn - BigInt(previousMetrics.networkInBytes || 0)) / BigInt(seconds) : BigInt(0)
    const txRate = previousMetrics && seconds > 0 && netOut >= BigInt(previousMetrics.networkOutBytes || 0) ? (netOut - BigInt(previousMetrics.networkOutBytes || 0)) / BigInt(seconds) : BigInt(0)
    const hasTrafficSample = Boolean(previousMetrics && (rxRate > BigInt(0) || txRate > BigInt(0)))
    const monitoring: ProductionVpsReconciliationRow["monitoring"] = powerStatus !== "running"
      ? "offline"
      : guestAgentStatus === "offline"
        ? "guest_agent_offline"
        : "active"
    const diskUsedGb = guestDisk?.ok
      ? Number((guestDisk.usedBytes / 1_000_000_000).toFixed(2))
      : (vps.diskUsedGb ? Number(vps.diskUsedGb) : null)
    const diskUsageStatus = diskConfiguredGb ? (diskUsedGb ? "reported" : "usage_unavailable") : "not_reported"
    if (!diskConfiguredGb) rowFailures.push("disk_configured_size_unavailable")

    if (options.mode === "apply" && !rowFailures.some((failure) => failure.startsWith("duplicate_vmid"))) {
      const vpsData: any = {
        status: dbStatus,
        proxmoxNodeId: node.id,
        hostname: config?.name || vps.hostname || vps.name || null,
        vmMacAddress: mac || vps.vmMacAddress || null,
        cpuCores: cores || vps.cpuCores,
        ramGb: ramGb || vps.ramGb,
        diskGb: diskConfiguredGb || vps.diskGb,
        diskTotalGb: diskConfiguredGb || vps.diskTotalGb,
        diskUsedGb: diskUsedGb || vps.diskUsedGb,
        diskUsagePercent: guestDisk?.ok && guestDisk.totalBytes > 0
          ? Number(((guestDisk.usedBytes / guestDisk.totalBytes) * 100).toFixed(2))
          : vps.diskUsagePercent,
        diskUsageSource: guestDisk?.ok ? guestDisk.source : "configured_size",
        diskUsageCheckedAt: now,
      }
      if (primaryIp && !conflictingAssignment && !conflictingVps && vps.ipAddress !== primaryIp) {
        vpsData.ipAddress = primaryIp
        actions.push(vps.ipAddress ? "vps_ip_corrected" : "vps_ip_repaired")
        summary.ipsRepaired += 1
      }
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: vpsData })
      actions.push("vps_runtime_fields_refreshed")
      summary.monitoringRepaired += 1
      if (diskConfiguredGb) summary.diskRepaired += 1

      await (prisma as any).vmRuntime.upsert({
        where: { vpsInstanceId: vps.id },
        create: {
          vpsInstanceId: vps.id,
          customerId: vps.customerId,
          orderId: vps.orderId,
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          hostname: config?.name || vps.hostname || vps.name,
          status: dbStatus,
          runtimeStatus: powerStatus,
          powerState: powerStatus,
          cpuCores: cores,
          ramGb,
          diskGb: diskConfiguredGb,
          nodeName: node.nodeName,
          syncSource: "production_vps_reconciliation",
          lastSyncedAt: now,
          staleAfter,
          metadata: { guestAgentStatus, monitoring },
        },
        update: {
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          hostname: config?.name || vps.hostname || vps.name,
          status: dbStatus,
          runtimeStatus: powerStatus,
          powerState: powerStatus,
          cpuCores: cores,
          ramGb,
          diskGb: diskConfiguredGb,
          nodeName: node.nodeName,
          syncSource: "production_vps_reconciliation",
          lastSyncedAt: now,
          staleAfter,
          metadata: { guestAgentStatus, monitoring },
        },
      })
      await (prisma as any).vmMetricsCache.upsert({
        where: { vpsInstanceId: vps.id },
        create: {
          vpsInstanceId: vps.id,
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          runtimeStatus: powerStatus,
          cpuPercent: numberValue(runtime?.cpu) * 100,
          ramUsedBytes: safeBigInt(runtime?.mem),
          ramTotalBytes: safeBigInt(runtime?.maxmem),
          diskUsedBytes: safeBigInt(guestDisk?.ok ? guestDisk.usedBytes : 0),
          diskTotalBytes: safeBigInt(guestDisk?.ok ? guestDisk.totalBytes : runtime?.maxdisk || (diskConfiguredGb ? diskConfiguredGb * 1024 ** 3 : 0)),
          diskFreeBytes: safeBigInt(guestDisk?.ok ? guestDisk.freeBytes : 0),
          diskReadBytes: safeBigInt(runtime?.diskread),
          diskWriteBytes: safeBigInt(runtime?.diskwrite),
          networkInBytes: netIn,
          networkOutBytes: netOut,
          rxRateBps: rxRate,
          txRateBps: txRate,
          uptimeSeconds: safeBigInt(runtime?.uptime),
          source: "production_vps_reconciliation",
          recordedAt: now,
          staleAfter,
          metadata: {
            guestAgentStatus,
            monitoring,
            trafficSample: hasTrafficSample ? "sampled" : "no_delta",
            diskUsage: guestDisk ? {
              ok: guestDisk.ok,
              source: guestDisk.source,
              totalBytes: guestDisk.totalBytes,
              usedBytes: guestDisk.usedBytes,
              freeBytes: guestDisk.freeBytes,
              error: guestDisk.error || null,
            } : { ok: false, source: "guest_agent_unavailable" },
          },
        },
        update: {
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          runtimeStatus: powerStatus,
          cpuPercent: numberValue(runtime?.cpu) * 100,
          ramUsedBytes: safeBigInt(runtime?.mem),
          ramTotalBytes: safeBigInt(runtime?.maxmem),
          diskUsedBytes: safeBigInt(guestDisk?.ok ? guestDisk.usedBytes : 0),
          diskTotalBytes: safeBigInt(guestDisk?.ok ? guestDisk.totalBytes : runtime?.maxdisk || (diskConfiguredGb ? diskConfiguredGb * 1024 ** 3 : 0)),
          diskFreeBytes: safeBigInt(guestDisk?.ok ? guestDisk.freeBytes : 0),
          diskReadBytes: safeBigInt(runtime?.diskread),
          diskWriteBytes: safeBigInt(runtime?.diskwrite),
          networkInBytes: netIn,
          networkOutBytes: netOut,
          rxRateBps: rxRate,
          txRateBps: txRate,
          uptimeSeconds: safeBigInt(runtime?.uptime),
          source: "production_vps_reconciliation",
          recordedAt: now,
          staleAfter,
          metadata: {
            guestAgentStatus,
            monitoring,
            trafficSample: hasTrafficSample ? "sampled" : "no_delta",
            diskUsage: guestDisk ? {
              ok: guestDisk.ok,
              source: guestDisk.source,
              totalBytes: guestDisk.totalBytes,
              usedBytes: guestDisk.usedBytes,
              freeBytes: guestDisk.freeBytes,
              error: guestDisk.error || null,
            } : { ok: false, source: "guest_agent_unavailable" },
          },
        },
      })
      actions.push("runtime_and_metrics_cache_upserted")
      if (previousMetrics && seconds > 0) {
        const rxBytes = netIn >= BigInt(previousMetrics.networkInBytes || 0) ? netIn - BigInt(previousMetrics.networkInBytes || 0) : BigInt(0)
        const txBytes = netOut >= BigInt(previousMetrics.networkOutBytes || 0) ? netOut - BigInt(previousMetrics.networkOutBytes || 0) : BigInt(0)
        await (prisma as any).bandwidthUsageSample.create({
          data: {
            vpsInstanceId: vps.id,
            customerId: vps.customerId,
            productId: vps.productId,
            proxmoxNodeId: node.id,
            ipAddress: primaryIp,
            vmid: vps.vmid,
            rxBytes,
            txBytes,
            totalBytes: rxBytes + txBytes,
            rxRateBps: rxRate,
            txRateBps: txRate,
            peakRateBps: rxRate > txRate ? rxRate : txRate,
            source: "production_vps_reconciliation",
            recordedAt: now,
            metadata: { nodeName: node.nodeName },
          },
        }).catch(() => null)
      }

      let assignment = existingPrimary
      if (primaryIp && !conflictingAssignment && !conflictingVps && matchedPool) {
        if (!poolAllocation) {
          poolAllocation = await prisma.ipAllocation.create({
            data: {
              poolId: matchedPool.id,
              nodeId: node.id,
              ipAddress: primaryIp,
              status: "assigned",
              vpsInstanceId: vps.id,
              vmid: vps.vmid,
              hostname: vps.hostname || vps.name || null,
              assignedBy: "production_vps_reconciliation",
              releasedAt: null,
            },
          }).catch(() => null)
          if (poolAllocation) {
            actions.push("ip_allocation_created")
            summary.ipsRepaired += 1
          }
        } else if (poolAllocation.vpsInstanceId !== vps.id || !ACTIVE_IP_STATUSES.includes(String(poolAllocation.status || "").toLowerCase())) {
          const allocationOwner = poolAllocation.vpsInstanceId ? await prisma.vpsInstance.findUnique({
            where: { id: poolAllocation.vpsInstanceId },
            select: { id: true, ipAddress: true, deletedAt: true, status: true },
          }).catch(() => null) : null
          const staleAllocationOwner = !allocationOwner || Boolean(allocationOwner.deletedAt) || allocationOwner.ipAddress !== primaryIp || ["deleted", "terminated", "cancelled", "canceled"].includes(String(allocationOwner.status || "").toLowerCase())
          if (!poolAllocation.vpsInstanceId || staleAllocationOwner || poolAllocation.vpsInstanceId === vps.id) {
            poolAllocation = await prisma.ipAllocation.update({
              where: { id: poolAllocation.id },
              data: { nodeId: node.id, status: "assigned", vpsInstanceId: vps.id, vmid: vps.vmid, hostname: vps.hostname || vps.name || null, assignedBy: "production_vps_reconciliation", releasedAt: null, allocationLockKey: null },
            }).catch(() => poolAllocation)
            actions.push("ip_allocation_refreshed")
            summary.ipsRepaired += 1
          }
        }
      }
      if (primaryIp && !conflictingAssignment && !conflictingVps && !assignment) {
        assignment = await (prisma as any).ipAssignment.create({
          data: {
            vpsInstanceId: vps.id,
            customerId: vps.customerId,
            vmid: vps.vmid,
            hostname: vps.hostname || vps.name || null,
            nodeId: node.id,
            nodeName: node.nodeName,
            poolId: poolAllocation?.poolId || matchedPool?.id || null,
            poolName: matchedPool?.name || null,
            allocationId: poolAllocation?.id || null,
            assignedIp: primaryIp,
            gateway: ipconfig.gateway || matchedPool?.gateway || null,
            cidr: ipconfig.cidr || matchedPool?.cidr || null,
            dns: matchedPool?.dns || cleanText(config?.nameserver) || "1.1.1.1",
            bridge: matchedPool?.bridgeOverride || matchedPool?.bridge || null,
            isPrimary: true,
            status: "active",
            billingIp: primaryIp,
            cloudInitIp,
            guestAgentIp,
            proxmoxIp: currentProxmoxIp,
            source: "production_vps_reconciliation",
            metadata: { repairedBy: options.actor, poolMatched: Boolean(poolAllocation) },
          },
        })
        actions.push("primary_ip_assignment_created")
        summary.ipsRepaired += 1
      } else if (primaryIp && assignment) {
        await (prisma as any).ipAssignment.update({
          where: { id: assignment.id },
          data: {
            vmid: vps.vmid,
            hostname: vps.hostname || vps.name || null,
            nodeId: node.id,
            nodeName: node.nodeName,
            assignedIp: primaryIp,
            poolId: assignment.poolId || poolAllocation?.poolId || matchedPool?.id || null,
            poolName: assignment.poolName || matchedPool?.name || null,
            allocationId: assignment.allocationId || poolAllocation?.id || null,
            gateway: assignment.gateway || ipconfig.gateway || matchedPool?.gateway || null,
            cidr: assignment.cidr || ipconfig.cidr || matchedPool?.cidr || null,
            dns: assignment.dns || matchedPool?.dns || cleanText(config?.nameserver) || "1.1.1.1",
            bridge: assignment.bridge || matchedPool?.bridgeOverride || matchedPool?.bridge || null,
            billingIp: assignment.billingIp || primaryIp,
            cloudInitIp,
            guestAgentIp,
            proxmoxIp: currentProxmoxIp,
            source: "production_vps_reconciliation",
          },
        })
        actions.push("primary_ip_assignment_refreshed")
        if (!assignment.dns) summary.dnsRepaired += 1
      }

      if (primaryIp && !conflictingAssignment && !conflictingVps) {
        const currentHistory = await (prisma as any).ipHistory.findFirst({
          where: {
            ip: primaryIp,
            vpsInstanceId: vps.id,
            vmid: vps.vmid,
            status: "active",
            reason: "production_vps_reconciliation",
          },
          orderBy: { assignedAt: "desc" },
        }).catch(() => null)
        if (!currentHistory) {
          await (prisma as any).ipHistory.create({
            data: {
              ip: primaryIp,
              assignedIp: primaryIp,
              vpsInstanceId: vps.id,
              vmid: vps.vmid,
              customerId: vps.customerId,
              nodeId: node.id,
              nodeName: node.nodeName,
              assignmentId: assignment?.id || null,
              allocationId: poolAllocation?.id || null,
              status: "active",
              reason: "production_vps_reconciliation",
              source: "production_vps_reconciliation",
              metadata: { cloudInitIp, guestAgentIp, currentProxmoxIp },
            },
          }).catch(() => null)
        }
        summary.activityErrorsCleared += await clearAssignedIpActivityErrors({ vps, mode: options.mode, actions })
      }

      const primaryInterface = await (prisma as any).vmNetworkInterface.upsert({
        where: { vpsInstanceId_name: { vpsInstanceId: vps.id, name: "net0" } },
        create: {
          vpsInstanceId: vps.id,
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          name: "net0",
          isPrimary: true,
          macAddress: mac,
          metadata: { source: "production_vps_reconciliation" },
        },
        update: {
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          isPrimary: true,
          macAddress: mac,
          metadata: { source: "production_vps_reconciliation" },
        },
      }).catch(() => null)
      if (primaryIp && !conflictingAssignment && !conflictingVps) {
        const existingVmIp = await (prisma as any).vmIpAssignment.findFirst({
          where: { vpsInstanceId: vps.id, isPrimary: true, role: "primary", status: { in: ACTIVE_IP_STATUSES } },
          orderBy: { createdAt: "desc" },
        }).catch(() => null)
        const vmIpData = {
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          poolId: poolAllocation?.poolId || matchedPool?.id || null,
          interfaceId: primaryInterface?.id || null,
          ipAllocationId: poolAllocation?.id || null,
          family: "ipv4",
          assignmentType: "address",
          role: "primary",
          ipAddress: primaryIp,
          cidr: assignment?.cidr || ipconfig.cidr || matchedPool?.cidr || null,
          gateway: assignment?.gateway || ipconfig.gateway || matchedPool?.gateway || null,
          bridge: assignment?.bridge || matchedPool?.bridgeOverride || matchedPool?.bridge || null,
          vlanTag: matchedPool?.vlanTag || null,
          status: "active",
          isPrimary: true,
          metadata: { source: "production_vps_reconciliation", dns: assignment?.dns || matchedPool?.dns || cleanText(config?.nameserver) || null },
          attachedAt: now,
          detachedAt: null,
        }
        if (existingVmIp) {
          await (prisma as any).vmIpAssignment.update({ where: { id: existingVmIp.id }, data: vmIpData }).catch(() => null)
          actions.push("vm_ip_assignment_refreshed")
        } else {
          await (prisma as any).vmIpAssignment.create({ data: { vpsInstanceId: vps.id, ...vmIpData } }).catch(() => null)
          actions.push("vm_ip_assignment_created")
        }
      }
      const networkData = {
        customerId: vps.customerId,
        proxmoxNodeId: node.id,
        vmid: vps.vmid,
        primaryAssignedIp: primaryIp || null,
        primaryAssignmentId: assignment?.id || null,
        primaryPoolId: poolAllocation?.poolId || assignment?.poolId || matchedPool?.id || null,
        primaryAllocationId: poolAllocation?.id || assignment?.allocationId || null,
        primaryGateway: ipconfig.gateway || assignment?.gateway || matchedPool?.gateway || null,
        primaryCidr: ipconfig.cidr || assignment?.cidr || matchedPool?.cidr || null,
        primaryDns: assignment?.dns || matchedPool?.dns || cleanText(config?.nameserver) || null,
        primaryBridge: assignment?.bridge || matchedPool?.bridgeOverride || matchedPool?.bridge || null,
        cloudInitIp,
        discoveredIp: guestAgentIp,
        proxmoxIp: currentProxmoxIp,
        source: "production_vps_reconciliation",
        importedAt: now,
        lastSyncedAt: now,
        metadata: { mac, netInBytes: netIn.toString(), netOutBytes: netOut.toString(), trafficSample: hasTrafficSample ? "sampled" : "no_delta" },
      }
      await (prisma as any).vmNetwork.upsert({ where: { vpsInstanceId: vps.id }, create: { vpsInstanceId: vps.id, ...networkData }, update: networkData })
      await (prisma as any).vmNetworkCache.upsert({ where: { vpsInstanceId: vps.id }, create: { vpsInstanceId: vps.id, ...networkData }, update: networkData })
      actions.push("network_cache_upserted")
      summary.networkRepaired += 1
      if (primaryIp && vps.orderId) {
        await ensureProvisioningIdentity({
          orderId: vps.orderId,
          vpsInstanceId: vps.id,
          vmUuid: vps.id,
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          publicIp: primaryIp,
          macAddress: mac || vps.vmMacAddress || null,
        }).then(() => {
          actions.push("provisioning_identity_upserted")
          summary.provisioningIdentitiesRepaired += 1
        }).catch(async (error) => {
          rowFailures.push(`provisioning_identity_repair_failed:${String(error?.message || error)}`)
          await quarantineReconciliationIncident({
            type: "PROVISIONING_IDENTITY_REPAIR_FAILED",
            nodeId: node.id,
            nodeName: node.nodeName,
            vmid: vps.vmid,
            vpsInstanceId: vps.id,
            orderId: vps.orderId,
            customerId: vps.customerId,
            reason: String(error?.message || error),
            evidence: { publicIp: primaryIp, mac: mac || vps.vmMacAddress || null },
          }).catch(() => null)
        })
      }

      if (vps.order && (!vps.order.serviceId || vps.order.serviceId !== vps.id || vps.order.vmId !== vps.vmid || vps.order.proxmoxNodeId !== node.id)) {
        await prisma.order.update({
          where: { id: vps.order.id },
          data: { serviceId: vps.id, vmId: vps.vmid, proxmoxNodeId: node.id, proxmoxNode: node.nodeName, customerId: vps.order.customerId || vps.customerId },
        })
        actions.push("billing_linkage_repaired")
        summary.billingRepaired += 1
        if (!vps.order.customerId) summary.customersRepaired += 1
      }

      await (prisma as any).vmAuditLog.create({
        data: {
          eventType: "PRODUCTION_VPS_RECONCILED",
          severity: rowFailures.length ? "WARN" : "INFO",
          actorType: "SYSTEM",
          actorEmail: options.actor,
          vpsInstanceId: vps.id,
          customerId: vps.customerId,
          orderId: vps.orderId,
          proxmoxNodeId: node.id,
          vmid: vps.vmid,
          targetType: "vps_instance",
          targetId: vps.id,
          reason: "production_vps_reconciliation",
          status: rowFailures.length ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
          newValue: { actions, failures: rowFailures },
        },
      }).catch(() => null)
    } else if (options.mode === "dry-run") {
      actions.push("would_refresh_vps_runtime_fields")
      actions.push("would_upsert_runtime_metrics_network_caches")
      if (primaryIp && !conflictingAssignment && !conflictingVps && (!vps.ipAddress || !existingPrimary)) actions.push("would_repair_primary_ip")
      if (vps.order && (!vps.order.serviceId || vps.order.serviceId !== vps.id || vps.order.vmId !== vps.vmid || vps.order.proxmoxNodeId !== node.id)) actions.push("would_repair_billing_linkage")
    }

    const row: ProductionVpsReconciliationRow = {
      ...baseRow,
      hostname: config?.name || baseRow.hostname,
      cloudInitIp,
      guestAgentIp,
      currentProxmoxIp,
      primaryPoolIp: poolAllocation?.ipAddress || existingPrimary?.assignedIp || null,
      mac: mac || vps.vmMacAddress || null,
      guestAgentStatus,
      powerStatus,
      disk: { configuredGb: diskConfiguredGb, usedGb: diskUsedGb, usageStatus: diskUsageStatus },
      network: { netInBytes: netIn.toString(), netOutBytes: netOut.toString(), hasTrafficSample },
      monitoring,
      billingLinked: Boolean(vps.order && (vps.order.serviceId === vps.id || actions.includes("billing_linkage_repaired")) && (vps.order.vmId === vps.vmid || actions.includes("billing_linkage_repaired"))),
      consoleAvailable: Boolean(vps.consoleEnabled && node.nodeName && vps.vmid > 0),
      repairActions: actions,
      remainingFailures: rowFailures,
      quarantinedIncidents: rowQuarantinedIncidents,
    }
    rows.push(row)
    if (actions.length) summary.repaired += 1
  }

  for (const row of rows) {
    for (const reason of row.quarantinedIncidents) {
      quarantinedIncidents.push({ vpsInstanceId: row.vpsInstanceId, orderId: row.orderId, vmid: row.vmid, reason, status: "QUARANTINED", nextAction: "Review quarantined evidence; do not change customer ownership without deterministic proof." })
    }
    for (const reason of row.remainingFailures) {
      failures.push({ vpsInstanceId: row.vpsInstanceId, orderId: row.orderId, vmid: row.vmid, reason, nextAction: failureNextAction(reason) })
    }
  }

  const report: ProductionVpsReconciliationReport = { ...summary, quarantinedIncidents, remainingFailures: failures, rows }
  if (options.reportPath) await writeReport(options.reportPath, report)
  return report
}

export async function runProductionVpsReconciliation(input: ProductionVpsReconciliationOptions = {}) {
  const options = {
    mode: input.mode || "dry-run" as ReconcileMode,
    reportPath: input.reportPath || null,
    limit: input.limit && input.limit > 0 ? Math.floor(input.limit) : null,
    vpsId: input.vpsId || null,
    actor: input.actor || "script:reconcile-production-vps",
    scheduled: Boolean(input.scheduled),
  }
  return withRedisLock(LOCK_KEY, LOCK_TTL_MS, () => runUnlocked(options))
}
