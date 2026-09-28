import crypto from "node:crypto"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { performVpsPowerAction, type VpsPowerAction } from "@/lib/vps-control"
import { enqueueProvisioningJob, enqueueReinstallJob, retryStartVps, MIN_PROXMOX_VMID, MAX_PROXMOX_VMID } from "@/lib/provision"
import { assertPaymentVerifiedForProvisioning } from "@/lib/payment-state"
import { createPanelLog } from "@/lib/panel-log"
import { createAuditLog } from "@/lib/audit-log"
import { withRedisLock } from "@/lib/redis"
import { robustlyStopVm } from "@/lib/vm-power-control"
import { lifecycleDates, resolveImportedRenewalDueAt, suspendOverdueVps } from "@/lib/renewals"
import { buildVmNotes, ensureVmIdentityNotes, extractMetadataFromNotes, parseVmIdentityTags, vmIdentityNotesMatch, vmIdentityTagsMatch } from "@/lib/proxmox-tags"
import { normalizeVmAutomationState, normalizeVmLifecycleState } from "@/lib/vm-state-machine"
import { requestVmDeletion } from "@/lib/vm-deletion"
import { discoverVmIpAddress } from "@/lib/vm-ip-discovery"
import { encryptSecretValue } from "@/lib/secret-crypto"
import { markRuntimeCompleteIfReady, probeVmRuntimeHealth } from "@/lib/vm-runtime-health"
import { applyBandwidthThrottle, restoreBandwidthThrottle } from "@/lib/bandwidth-enforcement"
import { persistVpsConsoleMetadata } from "@/lib/console-metadata"
import { resolveCanonicalVmDataForVpsIds } from "@/lib/vm-db-truth"
import { expandGuestPrimaryDisk } from "@/lib/vm-guest-disk"
import { resolveVmGuestOs, type VmGuestOsKind } from "@/lib/vm-os-detection"
import { scanDuplicateManagedVms } from "@/lib/vm-duplicate-quarantine"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"

function nowIso() {
  return new Date().toISOString()
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index++
      results[currentIndex] = await worker(items[currentIndex])
    }
  })
  await Promise.all(runners)
  return results
}

function asObj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function parsePrimaryIp(config: Record<string, any>, orderMetadata: Record<string, any>) {
  const explicit = String(orderMetadata.ipAddress || orderMetadata.primaryIp || orderMetadata.ip || "").trim()
  if (explicit) return explicit
  const ipconfig0 = String(config.ipconfig0 || "")
  const match = ipconfig0.match(/(?:^|,)ip=([^,\s/]+)/)
  const ip = match?.[1]
  return ip && ip !== "dhcp" ? ip : null
}

function vmRuntimeStatus(value: unknown) {
  const status = String(value || "").toLowerCase()
  if (status === "running") return "ACTIVE"
  if (status === "stopped") return "STOPPED"
  if (status === "paused") return "PAUSED"
  return status ? status.toUpperCase() : "UNKNOWN"
}

function runtimeMetrics(runtime: any) {
  const maxmem = Number(runtime?.maxmem || 0)
  const mem = Number(runtime?.mem || 0)
  const maxdisk = Number(runtime?.maxdisk || 0)
  const disk = Number(runtime?.disk || 0)
  return {
    runtimeStatus: String(runtime?.status || "unknown").toLowerCase(),
    cpuPercent: Math.max(0, Math.min(100, Number(runtime?.cpu || 0) * 100)),
    ramUsedBytes: mem,
    ramTotalBytes: maxmem,
    ramPercent: maxmem > 0 ? Math.max(0, Math.min(100, (mem / maxmem) * 100)) : 0,
    diskUsedBytes: disk,
    diskTotalBytes: maxdisk,
    diskPercent: maxdisk > 0 ? Math.max(0, Math.min(100, (disk / maxdisk) * 100)) : 0,
    networkInBytes: Number(runtime?.netin || 0),
    networkOutBytes: Number(runtime?.netout || 0),
    diskReadBytes: Number(runtime?.diskread || 0),
    diskWriteBytes: Number(runtime?.diskwrite || 0),
    uptimeSeconds: Number(runtime?.uptime || 0),
  }
}

function randomSuffix(size = 6) {
  return crypto.randomBytes(size).toString("hex")
}

function assertInt(value: unknown, label: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return parsed
}

function isSafePanelVmid(value: unknown) {
  const vmid = Number(value)
  return Number.isInteger(vmid) && vmid >= MIN_PROXMOX_VMID && vmid <= MAX_PROXMOX_VMID
}

function vmDetailsError(code: string, message: string, status = 200) {
  return Object.assign(new Error(message), { code, status })
}

function relationDiagnostic(name: string, value: unknown, required: boolean, repairAvailable = false) {
  return {
    name,
    exists: Boolean(value),
    status: value ? "exists" : "missing",
    required,
    optional: !required,
    repairAvailable,
  }
}

function safeOrderFallback(vps: any) {
  return {
    id: vps?.orderId || null,
    orderNumber: vps?.orderId || "Unlinked order",
    status: "UNKNOWN",
    provisioningStatus: null,
    provisioningError: "Order relation is missing.",
    termMonths: vps?.billingTermMonths || 1,
    templateVmid: null,
    osName: null,
    metadata: {},
    createdAt: vps?.createdAt || new Date(),
  }
}

function fatalVmDetailsResult(vpsId: string, error: any, relationRows: any[] = []) {
  const code = String(error?.code || "VM_DETAILS_LOAD_FAILED")
  const message = String(error?.message || "Unable to load VM details.")
  return {
    ok: false,
    success: false,
    vps: null,
    overview: {},
    lifecycle: {},
    diagnostics: {
      latestError: message,
      errorCode: code,
      supportCode: `VM-DETAIL-${Date.now().toString(36).toUpperCase()}`,
    },
    relations: relationRows,
    warnings: [message],
    recoverableErrors: [],
    fatalError: { code, message, vpsId },
    timeline: [],
    logs: [],
  }
}

async function getVpsForAdminDetails(vpsId: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id: vpsId }, { orderId: vpsId }] },
  })
  if (!vps) throw vmDetailsError("VM_NOT_FOUND", "VM not found", 404)

  const [
    customer,
    product,
    order,
    proxmoxNode,
    operatingSystem,
    ipAllocations,
    provisioningJobs,
    invoices,
    payments,
    networkInterfaces,
  ] = await Promise.all([
    prisma.customer.findUnique({ where: { id: vps.customerId }, select: { id: true, email: true, name: true } }).catch(() => null),
    vps.productId ? prisma.product.findUnique({ where: { id: vps.productId }, select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, bandwidthTb: true } }).catch(() => null) : null,
    prisma.order.findUnique({ where: { id: vps.orderId } }).catch(() => null),
    vps.proxmoxNodeId ? prisma.proxmoxNode.findUnique({ where: { id: vps.proxmoxNodeId } }).catch(() => null) : null,
    vps.operatingSystemId ? prisma.osTemplate.findUnique({ where: { id: vps.operatingSystemId } }).catch(() => null) : null,
    prisma.ipAllocation.findMany({
      where: { vpsInstanceId: vps.id, status: { in: ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"] } },
      include: { pool: true },
      orderBy: { createdAt: "desc" },
    }).catch(() => []),
    prisma.provisioningJob.findMany({
      where: { OR: [{ vpsInstanceId: vps.id }, { orderId: vps.orderId }] },
      orderBy: { createdAt: "desc" },
      include: {
        steps: { orderBy: { createdAt: "asc" } },
        logs: { orderBy: { createdAt: "desc" }, take: 120 },
      },
    }).catch(() => []),
    prisma.invoice.findMany({ where: { OR: [{ orderId: vps.orderId }, { customerId: vps.customerId }] }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []),
    prisma.payment.findMany({ where: { OR: [{ orderId: vps.orderId }, { customerId: vps.customerId }] }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []),
    (prisma as any).vmNetworkInterface?.findMany
      ? (prisma as any).vmNetworkInterface.findMany({ where: { vpsInstanceId: vps.id }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => [])
      : Promise.resolve([]),
  ])

  const attached: any = {
    ...vps,
    customer,
    product,
    order: order || safeOrderFallback(vps),
    proxmoxNode,
    operatingSystem,
    ipAllocations,
    provisioningJobs,
    invoices,
    payments,
    networkInterfaces,
  }
  const backed = isProxmoxBackedService(attached)
  const relations = [
    relationDiagnostic("VM", attached, true),
    relationDiagnostic("Customer", customer, true, true),
    relationDiagnostic("Order", order, true, true),
    relationDiagnostic("Node", proxmoxNode, backed, true),
    relationDiagnostic("Product", product, false, true),
    relationDiagnostic("Invoice", invoices.length, false, true),
    relationDiagnostic("Payment", payments.length, false, true),
    relationDiagnostic("IP Assignment", ipAllocations.length, false, true),
    relationDiagnostic("Network", networkInterfaces.length, false, true),
    relationDiagnostic("Credentials", attached.passwordEncrypted || attached.username || attached.adminUsername, false, true),
    relationDiagnostic("OS Template", operatingSystem, false, true),
  ]
  const warnings = relations
    .filter((relation) => relation.status === "missing")
    .map((relation) => `${relation.name} relation is missing${relation.required ? " and requires repair" : ""}.`)
  if (backed && !proxmoxNode) warnings.push("VM node configuration is missing. Proxmox actions are unavailable until the node relation is repaired.")
  return { vps: attached, relations, warnings, recoverableErrors: warnings.map((message) => ({ code: "relation_missing", message })) }
}

async function getVpsForAdmin(vpsId: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id: vpsId }, { orderId: vpsId }],
      deletedAt: null,
      order: { deletedAt: null, status: { not: "DELETED" } },
    },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, bandwidthTb: true } },
      order: true,
      proxmoxNode: true,
      operatingSystem: true,
      ipAllocations: {
        where: { status: { in: ["RESERVED", "reserved", "ASSIGNED", "assigned", "USED", "used"] } },
        include: { pool: true },
        orderBy: { createdAt: "desc" },
      },
      provisioningJobs: {
        orderBy: { createdAt: "desc" },
        include: {
          steps: { orderBy: { createdAt: "asc" } },
          logs: { orderBy: { createdAt: "desc" }, take: 120 },
        },
      },
    },
  })

  if (!vps) throw new Error("VM not found")
  if (!isProxmoxBackedService(vps)) return vps
  if (!vps.proxmoxNode) throw new Error("VM node configuration is missing")
  return vps
}

function isProxmoxBackedService(vps: any) {
  const source = String(vps?.provisioningSource || "panel").toLowerCase()
  const mode = String(vps?.provisionMode || "").toLowerCase()
  const ownershipStatus = String(vps?.ownershipStatus || "").toLowerCase()
  return Boolean(vps?.vmid && vps?.proxmoxNodeId) &&
    !["external", "manual", "manual_complete"].includes(source) &&
    !["external", "manual_complete"].includes(mode) &&
    !["external", "manual"].includes(ownershipStatus)
}

function proxmoxClientForVps(vps: Awaited<ReturnType<typeof getVpsForAdmin>>) {
  if (!isProxmoxBackedService(vps)) throw new Error("Proxmox actions are unavailable for external or manually completed services")
  const node = vps.proxmoxNode
  if (!node) throw vmDetailsError("node_unavailable", "VM node configuration is missing", 503)
  return createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
  })
}

export async function applyVmidNodeSync(input: {
  vpsId: string
  orderId: string
  oldVmid: number
  newVmid: number
  oldNodeId?: string | null
  newNodeId?: string | null
}) {
  await prisma.$transaction(async (tx) => {
    await tx.vpsInstance.update({
      where: { id: input.vpsId },
      data: {
        vmid: input.newVmid,
        ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}),
      },
    })
    await tx.provisioningJob.updateMany({ where: { vpsInstanceId: input.vpsId }, data: { vmid: input.newVmid } })
    await tx.provisioningJob.updateMany({
      where: { orderId: input.orderId, vmid: input.oldVmid, ...(input.oldNodeId ? { proxmoxNodeId: input.oldNodeId } : {}) },
      data: { vmid: input.newVmid, ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}) },
    })
    await tx.ipAllocation.updateMany({
      where: { vpsInstanceId: input.vpsId },
      data: { vmid: input.newVmid, ...(input.newNodeId ? { nodeId: input.newNodeId } : {}) },
    })
    await tx.vmIpAssignment.updateMany({
      where: { vpsInstanceId: input.vpsId },
      data: { vmid: input.newVmid, ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}) },
    })
    await tx.vmNetworkInterface.updateMany({
      where: { vpsInstanceId: input.vpsId },
      data: { vmid: input.newVmid, ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}) },
    })
    await tx.vmNetworkEvent.updateMany({
      where: { vpsInstanceId: input.vpsId },
      data: { vmid: input.newVmid, ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}) },
    })
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        vmId: input.newVmid,
        ...(input.newNodeId ? { proxmoxNodeId: input.newNodeId } : {}),
      },
    }).catch(() => undefined)
  })
}

async function logAdminVmAction(input: {
  vps: Awaited<ReturnType<typeof getVpsForAdmin>>
  actorEmail: string
  action: string
  result?: Record<string, unknown> | null
}) {
  await createPanelLog({
    category: "Provisioning",
    message: "admin_vm_action_executed",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: input.vps.customerId,
    orderId: input.vps.orderId,
    vpsInstanceId: input.vps.id,
    vmid: input.vps.vmid,
    metadata: {
      action: input.action,
      result: input.result || null,
    },
  }).catch(() => null)

  await createAuditLog({
    action: "VM_ACTION",
    actorEmail: input.actorEmail,
    customerId: input.vps.customerId,
    targetType: "vps_instance",
    targetId: input.vps.id,
    oldValue: { status: input.vps.status, vmid: input.vps.vmid },
    newValue: { action: input.action, result: input.result || null },
    metadata: { action: input.action, vmid: input.vps.vmid },
  }).catch(() => null)
}

function serializeSpecFromConfig(config: Record<string, any>) {
  return {
    sockets: Number(config.sockets || 0) || null,
    cores: Number(config.cores || 0) || null,
    memoryMb: Number(config.memory || 0) || null,
    disk: config.scsi0 || config.virtio0 || config.sata0 || null,
    net0: config.net0 || null,
    citype: config.citype || null,
    ipconfig0: config.ipconfig0 || null,
    nameserver: config.nameserver || null,
    searchdomain: config.searchdomain || null,
    ostype: config.ostype || null,
    ide2: config.ide2 || null,
  }
}

function bytesToGb(value: unknown) {
  const bytes = Number(value || 0)
  return bytes > 0 ? Math.round(bytes / 1024 / 1024 / 1024) : null
}

function memoryMbToGb(value: unknown) {
  const mb = Number(value || 0)
  return mb > 0 ? Math.round(mb / 1024) : null
}

function cpuCoresFromConfig(config: Record<string, any>, runtime?: any) {
  const sockets = Number(config.sockets || 0) || 1
  const cores = Number(config.cores || 0)
  const runtimeCpus = Number(runtime?.cpus || 0)
  return cores > 0 ? cores * sockets : runtimeCpus > 0 ? runtimeCpus : null
}

function diskGbFromConfig(config: Record<string, any>, runtime?: any) {
  const runtimeDisk = bytesToGb(runtime?.maxdisk)
  if (runtimeDisk) return runtimeDisk
  for (const key of ["scsi0", "virtio0", "sata0", "ide0"]) {
    const text = String(config[key] || "")
    const match = text.match(/(?:size=)?(\d+(?:\.\d+)?)([TGMK])\b/i)
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

function osFromVmConfig(config: Record<string, any>, orderOs?: string | null) {
  return String(orderOs || config.ostype || config.citype || "").trim() || null
}

type ExistingVmValidationCheck = {
  key: "node_reachable" | "vm_found" | "vm_accessible" | "vm_not_assigned" | "vm_not_locked" | "vm_not_pending_deletion"
  label: string
  ok: boolean
  error?: string | null
}

function validationCheck(key: ExistingVmValidationCheck["key"], label: string, ok: boolean, error?: string | null): ExistingVmValidationCheck {
  return { key, label, ok, error: ok ? null : error || label }
}

function firstValidationError(checks: ExistingVmValidationCheck[]) {
  return checks.find((check) => !check.ok)?.error || null
}

function vmHasDeletionLock(config: Record<string, any>, runtime?: any) {
  const lock = String(config.lock || runtime?.lock || "").trim().toLowerCase()
  if (!lock) return false
  return ["delete", "destroy", "deleting"].some((item) => lock.includes(item))
}

async function findPendingDeletionForMapping(input: { nodeId: string; vmid: number }) {
  return (prisma as any).vmDeletionJob.findFirst({
    where: {
      proxmoxNodeId: input.nodeId,
      vmid: input.vmid,
      completedAt: null,
      status: { notIn: ["deleted", "delete_completed", "completed", "cancelled", "canceled"] },
    },
    select: { id: true, status: true, vpsInstanceId: true, orderId: true },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
}

export async function findActiveVmMapping(input: { nodeId: string; vmid: number; excludeVpsId?: string | null }) {
  return prisma.vpsInstance.findFirst({
    where: {
      proxmoxNodeId: input.nodeId,
      vmid: input.vmid,
      deletedAt: null,
      ...(input.excludeVpsId ? { id: { not: input.excludeVpsId } } : {}),
    },
    include: {
      customer: { select: { id: true, email: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      proxmoxNode: { select: { id: true, name: true, nodeName: true } },
    },
  })
}

export async function assertVmMappingAvailable(input: { nodeId: string; vmid: number; excludeVpsId?: string | null }) {
  const assigned = await findActiveVmMapping(input)
  if (!assigned) return null
  const customer = assigned.customer?.name || assigned.customer?.email || assigned.customerId
  const order = assigned.order?.orderNumber || assigned.orderId
  const error = new Error(`VM is already assigned to ${customer} (${order})`)
  ;(error as any).assigned = {
    vpsId: assigned.id,
    customerId: assigned.customerId,
    customer,
    orderId: assigned.orderId,
    order,
    nodeId: assigned.proxmoxNodeId,
    nodeName: assigned.proxmoxNode?.nodeName || null,
    vmid: assigned.vmid,
  }
  throw error
}

function proxmoxClientForNode(node: { host: string; tokenId: string; tokenSecret: string; allowInsecureTls: boolean }) {
  return createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
  })
}

export async function loadExistingVmPreview(input: { nodeId: string; vmid: number; excludeVpsId?: string | null }) {
  const vmid = assertInt(input.vmid, "vmid")
  const node = await prisma.proxmoxNode.findFirst({ where: { id: input.nodeId, isActive: true } })
  if (!node) throw new Error("Node not found or inactive")
  const client = proxmoxClientForNode(node)
  const [assigned, nodeStatus, runtime, config, pendingDeletion] = await Promise.all([
    findActiveVmMapping({ nodeId: node.id, vmid, excludeVpsId: input.excludeVpsId || null }),
    client.getNodeStats(node.nodeName).catch(() => null),
    client.getVMStatus(node.nodeName, vmid).catch(() => null),
    client.getVMConfig(node.nodeName, vmid).catch(() => null),
    findPendingDeletionForMapping({ nodeId: node.id, vmid }),
  ])
  const nodeReachable = Boolean(nodeStatus)
  const vmFound = Boolean(runtime || config)
  const configReadable = Boolean(config)
  const cfg = (config || {}) as Record<string, any>
  const deletionLocked = vmHasDeletionLock(cfg, runtime)
  const locked = Boolean(String(cfg.lock || runtime?.lock || "").trim())
  const pendingDelete = Boolean(pendingDeletion || deletionLocked)
  const discoveredIp = configReadable ? await discoverVmIpAddress({
      client,
      nodeName: node.nodeName,
      vmid,
      config: cfg,
      allocatedIp: parsePrimaryIp(cfg, {}),
      hostname: String(cfg.name || runtime?.name || `vm-${vmid}`),
    }).catch(() => null) : null
  const notes = extractMetadataFromNotes(cfg.description)
  const checks = [
    validationCheck("node_reachable", "Node Reachable", nodeReachable, "Node unreachable"),
    validationCheck("vm_found", "VM Found", vmFound, "VM not found"),
    validationCheck("vm_accessible", "VM Accessible", configReadable, "VM configuration unavailable"),
    validationCheck("vm_not_assigned", "VM Not Assigned", !assigned, "VM already assigned"),
    validationCheck("vm_not_pending_deletion", "VM Not Pending Deletion", !pendingDelete, "VM pending deletion"),
    validationCheck("vm_not_locked", "VM Not Locked", !locked, "VM locked"),
  ]
  const validationError = firstValidationError(checks)
  const preview = {
    vmid,
    nodeId: node.id,
    node: node.nodeName,
    nodeName: node.nodeName,
    nodeLabel: node.name,
    name: String(cfg.name || runtime?.name || `vm-${vmid}`),
    cpu: cpuCoresFromConfig(cfg, runtime),
    ramGb: memoryMbToGb(cfg.memory) || bytesToGb(runtime?.maxmem),
    diskGb: diskGbFromConfig(cfg, runtime),
    ip: discoveredIp?.ipAddress || parsePrimaryIp(cfg, {}) || null,
    os: osFromVmConfig(cfg),
    status: String(runtime?.status || "unknown").toLowerCase(),
    uptimeSeconds: Number(runtime?.uptime || 0),
    uptime: Number(runtime?.uptime || 0),
    notes: String(cfg.description || ""),
    currentNotes: String(cfg.description || ""),
    lock: String(cfg.lock || runtime?.lock || "") || null,
    pendingDeletion: pendingDeletion ? { id: pendingDeletion.id, status: pendingDeletion.status } : null,
    validation: {
      ok: !validationError,
      error: validationError,
      errors: checks.filter((check) => !check.ok).map((check) => check.error).filter(Boolean),
      checks,
    },
    identity: {
      orderId: notes.orderId || null,
      serviceId: (notes as any).serviceId || null,
      customerId: notes.customerId || null,
      uuid: notes.vmUuid || null,
      managed: notes.managed || String(notes.service || "").toLowerCase() === "zws",
    },
    assigned: assigned ? {
      vpsId: assigned.id,
      customerId: assigned.customerId,
      customer: assigned.customer?.name || assigned.customer?.email || assigned.customerId,
      orderId: assigned.orderId,
      order: assigned.order?.orderNumber || assigned.orderId,
    } : null,
    vmConfig: serializeSpecFromConfig(cfg),
  }
  return preview
}

export async function getAdminVmDetails(vpsId: string) {
  let loaded: Awaited<ReturnType<typeof getVpsForAdminDetails>>
  try {
    loaded = await getVpsForAdminDetails(vpsId)
  } catch (error: any) {
    console.error("[ADMIN_VM_DETAILS_FATAL]", {
      vpsId,
      code: error?.code || null,
      message: error?.message || String(error),
      stack: error?.stack || null,
    })
    return fatalVmDetailsResult(vpsId, error)
  }
  const vps = loaded.vps
  const order = vps.order || safeOrderFallback(vps)
  const detailDiagnostics = {
    relations: loaded.relations,
    warnings: loaded.warnings,
    recoverableErrors: loaded.recoverableErrors,
  }
  if (!isProxmoxBackedService(vps)) {
    const lifecycle = lifecycleDates({
      createdAt: vps.createdAt,
      termMonths: order.termMonths,
      renewalDueAt: vps.renewalDueAt || vps.nextRenewalAt,
      graceDays: vps.graceDays,
      penaltyWindowDays: (vps as any).penaltyWindowDays,
      terminationWindowDays: (vps as any).terminationWindowDays,
      retentionDays: vps.retentionDays,
    })
    return {
      vps,
      runtime: null,
      config: null,
      lifecycle: {
        orderCreatedAt: lifecycle.orderCreatedAt,
        nextBillingDate: lifecycle.renewalDueAt,
        renewalDueAt: lifecycle.renewalDueAt,
        gracePeriodEnds: lifecycle.gracePeriodEnds,
        serviceSuspensionDate: vps.suspendAt || lifecycle.suspendAt,
        suspendAt: vps.suspendAt || lifecycle.suspendAt,
        penaltyActivation: vps.penaltyAt || lifecycle.penaltyAt,
        penaltyAt: vps.penaltyAt || lifecycle.penaltyAt,
        terminationAt: vps.terminationAt || lifecycle.terminationAt,
        permanentDeletionDate: vps.deletionAt || lifecycle.deletionAt,
        deletionAt: vps.deletionAt || lifecycle.deletionAt,
        dataRetentionWindow: `${vps.retentionDays || lifecycle.dataRetentionWindowDays} days`,
        billingCycle: vps.billingCycle || "monthly",
        autoRenewal: vps.autoSuspendEnabled && vps.autoDeleteEnabled ? "Automation active" : "Manual review",
        outstandingBalance: 0,
        serviceStatus: vps.status,
      },
      ok: true,
      success: true,
      relations: loaded.relations,
      warnings: loaded.warnings,
      recoverableErrors: loaded.recoverableErrors,
      fatalError: null,
      automationState: normalizeVmAutomationState(vps.automationPausedAt || vps.remindersPausedAt ? "paused" : order.provisioningStatus || vps.status),
      stateMachine: {
        lifecycleState: normalizeVmLifecycleState(vps.status),
        automationState: normalizeVmAutomationState(order.provisioningStatus || vps.status),
        rawStatus: vps.status,
        provisioningStatus: order.provisioningStatus || null,
      },
      metricsSource: { runtime: "unavailable", cpu: "manual", memory: "manual", disk: "manual", network: "manual" },
      storageEnterprise: { source: "manual", health: "Not managed by Proxmox", replicationStatus: "External/manual service" },
      networkIntelligence: null,
      diagnostics: {
        proxmoxStatusAvailable: false,
        proxmoxConfigAvailable: false,
        latestError: order.provisioningError || loaded.warnings[0] || null,
        noProxmoxRequired: true,
        ...detailDiagnostics,
      },
      activity: {
        latestLog: vps.provisioningJobs[0]?.logs?.[0] || null,
        latestStep: vps.provisioningJobs[0]?.currentStep || null,
      },
      overview: {
        vmid: vps.vmid,
        hostname: vps.name,
        node: null,
        status: vps.status,
        powerState: "external",
        templateUsed: null,
        os: vps.operatingSystem?.name || order.osName || "Unknown",
        ipv4: vps.ipAddress || null,
        macAddress: vps.vmMacAddress || null,
        ipv6: asObj(order.metadata).ipv6 || null,
        bandwidth: (vps as any).bandwidthTb || vps.product?.bandwidthTb || null,
        ramGb: vps.ramGb || vps.product?.ramGb || null,
        cpu: vps.cpuCores || vps.product?.cpuCores || null,
        diskGb: vps.diskGb || vps.product?.storageGb || null,
        createdAt: vps.createdAt,
        activatedAt: vps.activatedAt,
        renewalDate: lifecycle.renewalDueAt,
        renewalDueAt: lifecycle.renewalDueAt,
        suspendAt: vps.suspendAt || lifecycle.suspendAt,
        penaltyAt: vps.penaltyAt || lifecycle.penaltyAt,
        terminationAt: vps.terminationAt || lifecycle.terminationAt,
        deletionAt: vps.deletionAt || lifecycle.deletionAt,
        provisioningStatus: order.provisioningStatus || null,
        latestUpid: null,
        latestStep: vps.provisioningJobs[0]?.currentStep || null,
        latestError: order.provisioningError || loaded.warnings[0] || null,
        latestLogMessage: vps.provisioningJobs[0]?.logs?.[0]?.message || null,
        health: null,
        vmConfig: {},
      },
      timeline: vps.provisioningJobs[0]?.steps || [],
      logs: vps.provisioningJobs[0]?.logs || [],
    }
  }
  const canonical = (await resolveCanonicalVmDataForVpsIds([vps.id])).get(vps.id) || {}
  const metric = canonical.metrics || null
  const stateCache = canonical.state || null
  const runtime = metric ? {
    status: metric.runtimeStatus || stateCache?.runtimeStatus || stateCache?.runtime_status || null,
    cpu: Number(metric.cpuPercent || 0) / 100,
    mem: Number(metric.ramUsedBytes || 0),
    maxmem: Number(metric.ramTotalBytes || 0),
    disk: Number(metric.diskUsedBytes || 0),
    maxdisk: Number(metric.diskTotalBytes || 0),
    diskread: Number(metric.diskReadBytes || 0),
    diskwrite: Number(metric.diskWriteBytes || 0),
    netin: Number(metric.networkInBytes || 0),
    netout: Number(metric.networkOutBytes || 0),
    uptime: Number(metric.uptimeSeconds || 0),
  } : null
  const config = {
    ...asObj(stateCache?.proxmoxState || stateCache?.proxmox_state),
    ...asObj(canonical.network?.diagnosticOnly || canonical.network?.diagnostic_only),
  }
  const runtimeHealth = null
  const assignedPrimaryIp = canonical.primaryIp || null
  if (assignedPrimaryIp) vps.ipAddress = assignedPrimaryIp

  const latestJob = vps.provisioningJobs[0] || null
  const latestLog = latestJob?.logs?.[0] || null
  const lifecycle = lifecycleDates({
    createdAt: vps.createdAt,
    termMonths: order.termMonths,
    renewalDueAt: vps.renewalDueAt || vps.nextRenewalAt,
    graceDays: vps.graceDays,
    penaltyWindowDays: (vps as any).penaltyWindowDays,
    terminationWindowDays: (vps as any).terminationWindowDays,
    retentionDays: vps.retentionDays,
  })
  const automationState = normalizeVmAutomationState(
    vps.automationPausedAt || vps.remindersPausedAt ? "paused" : latestJob?.status || order.provisioningStatus || vps.status
  )
  const lifecycleSuspendAt = vps.suspendAt && lifecycle.deletionAt && vps.suspendAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.suspendAt : lifecycle.suspendAt
  const lifecyclePenaltyAt = vps.penaltyAt && lifecycle.deletionAt && vps.penaltyAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.penaltyAt : lifecycle.penaltyAt
  const lifecycleTerminationAt = vps.terminationAt && lifecycle.deletionAt && vps.terminationAt.getTime() <= lifecycle.deletionAt.getTime() ? vps.terminationAt : lifecycle.terminationAt
  const lifecycleDeletionAt = vps.deletionAt || lifecycle.deletionAt

  return {
    ok: true,
    success: true,
    vps,
    runtime,
    config,
    lifecycle: {
      orderCreatedAt: lifecycle.orderCreatedAt,
      nextBillingDate: lifecycle.renewalDueAt,
      renewalDueAt: lifecycle.renewalDueAt,
      gracePeriodEnds: lifecycle.gracePeriodEnds,
      serviceSuspensionDate: lifecycleSuspendAt,
      suspendAt: lifecycleSuspendAt,
      penaltyActivation: lifecyclePenaltyAt,
      penaltyAt: lifecyclePenaltyAt,
      terminationAt: lifecycleTerminationAt,
      permanentDeletionDate: lifecycleDeletionAt,
      deletionAt: lifecycleDeletionAt,
      dataRetentionWindow: `${vps.retentionDays || lifecycle.dataRetentionWindowDays} days`,
      billingCycle: vps.billingCycle || "monthly",
      autoRenewal: vps.autoSuspendEnabled && vps.autoDeleteEnabled ? "Automation active" : "Manual review",
      outstandingBalance: 0,
      serviceStatus: vps.status,
    },
    relations: loaded.relations,
    warnings: loaded.warnings,
    recoverableErrors: loaded.recoverableErrors,
    fatalError: null,
    automationState,
    stateMachine: {
      lifecycleState: normalizeVmLifecycleState(vps.status),
      automationState,
      rawStatus: vps.status,
      provisioningStatus: order.provisioningStatus || null,
    },
    metricsSource: {
      runtime: runtime ? "cached" : "unavailable",
      cpu: runtime ? "cached" : "unavailable",
      memory: runtime?.maxmem ? "cached" : "unavailable",
      disk: runtime?.maxdisk ? "cached" : "unavailable",
      network: runtime ? "cached" : "unavailable",
    },
    storageEnterprise: {
      source: runtime?.maxdisk ? "cached" : "unavailable",
      health: runtime?.maxdisk ? "Not reported by guest/node" : "Unavailable",
      replicationStatus: runtime?.maxdisk ? "Not reported by guest/node" : "Unavailable",
    },
    networkIntelligence: null,
    diagnostics: {
      proxmoxStatusAvailable: Boolean(runtime),
      proxmoxConfigAvailable: Boolean(config),
      latestError: latestJob?.error || order.provisioningError || loaded.warnings[0] || null,
      runtimeHealth,
      syncStatus: stateCache?.syncStatus || stateCache?.sync_status || null,
      cachedProxmoxState: stateCache?.proxmoxState || stateCache?.proxmox_state || {},
      ...detailDiagnostics,
    },
    activity: {
      latestLog,
      latestStep: latestJob?.currentStep || null,
    },
    overview: {
      vmid: vps.vmid,
      hostname: vps.name,
      node: vps.proxmoxNode?.nodeName || null,
      status: vps.status,
      powerState: String(runtime?.status || "unknown").toLowerCase(),
      templateUsed: order.templateVmid || vps.operatingSystem?.proxmoxVmid || null,
      os: vps.operatingSystem?.name || order.osName || "Unknown",
      ipv4: vps.ipAddress || null,
      macAddress: vps.vmMacAddress || canonical.macAddress || null,
      ipv6: asObj(order.metadata).ipv6 || null,
      bandwidth: vps.product?.bandwidthTb || null,
      ramGb: vps.ramGb || vps.product?.ramGb || null,
      cpu: vps.cpuCores || vps.product?.cpuCores || null,
      diskGb: vps.diskGb || vps.product?.storageGb || null,
      createdAt: vps.createdAt,
      activatedAt: vps.activatedAt,
      renewalDate: lifecycle.renewalDueAt,
      renewalDueAt: lifecycle.renewalDueAt,
      suspendAt: lifecycleSuspendAt,
      penaltyAt: lifecyclePenaltyAt,
      terminationAt: lifecycleTerminationAt,
      deletionAt: lifecycleDeletionAt,
      penaltyAppliedAt: vps.penaltyAppliedAt,
      lastReminderLevel: vps.lastReminderLevel,
      lastReminderSentAt: vps.lastReminderSentAt,
      autoSuspendEnabled: vps.autoSuspendEnabled,
      autoDeleteEnabled: vps.autoDeleteEnabled,
      automationPausedAt: vps.automationPausedAt,
      remindersPausedAt: vps.remindersPausedAt,
      retentionDays: vps.retentionDays,
      suspensionDelayDays: vps.graceDays,
      deletionDelayDays: Math.max(0, Math.round(((vps.deletionAt || lifecycle.deletionAt || new Date()).getTime() - (vps.suspendAt || lifecycle.suspendAt || new Date()).getTime()) / 86400000)),
      penaltyWindowDays: (vps as any).penaltyWindowDays,
      terminationWindowDays: (vps as any).terminationWindowDays,
      provisioningStatus: order.provisioningStatus || null,
      latestUpid: latestJob?.latestUpid || null,
      latestStep: latestJob?.currentStep || null,
      latestError: latestJob?.error || order.provisioningError || loaded.warnings[0] || null,
      latestLogMessage: latestLog?.message || null,
      health: runtimeHealth,
      vmConfig: serializeSpecFromConfig((config || {}) as Record<string, any>),
    },
    timeline: latestJob?.steps || [],
    logs: latestJob?.logs || [],
  }
}

export async function runAdminVmAction(input: {
  vpsId: string
  action:
    | VpsPowerAction
    | "shutdown"
    | "emergency_shutdown"
    | "reset"
    | "force_reboot"
    | "force_kill"
    | "suspend"
    | "unsuspend"
    | "lock"
    | "unlock"
    | "sync_vmid"
    | "retry_start"
    | "retry_provision"
    | "force_retry"
    | "reinstall"
    | "manual_provision"
    | "delete_failed_vm"
    | "delete"
    | "terminate"
    | "reassign_node"
    | "reset_provisioning_state"
    | "rebuild_cloud_init_network"
    | "sync_proxmox_state"
    | "reset_password"
    | "resize_disk"
    | "change_bandwidth_limit"
    | "migrate_storage"
    | "mark_provision_complete"
    | "mark_provision_failed"
    | "attach_existing_vm"
    | "detach_vm"
    | "convert_to_external_vm"
    | "convert_to_managed_vm"
    | "refresh_vm_data"
    | "sync_vm_configuration"
    | "sync_vm_ip"
    | "recalculate_billing"
    | "generate_credentials"
    | "send_welcome_email"
  actorEmail: string
  payload?: Record<string, any>
}) {
  const normalized = String(input.action || "").trim().toLowerCase().replace(/[\s-]+/g, "_")

  if (["start", "stop", "reboot", "forcestop"].includes(normalized)) {
    const result = await performVpsPowerAction({
      vpsId: input.vpsId,
      action: normalized === "forcestop" ? "forceStop" : (normalized as VpsPowerAction),
      requestedBy: input.actorEmail,
      requestedRole: "admin",
    })
    const vps = await getVpsForAdmin(input.vpsId).catch(() => null)
    if (vps) {
      await logAdminVmAction({
        vps,
        actorEmail: input.actorEmail,
        action: normalized,
        result: result && typeof result === "object" ? (result as Record<string, unknown>) : { ok: true },
      })
    }
    return result
  }

  const vps = await getVpsForAdmin(input.vpsId)
  const payload = input.payload || {}

  if (normalized === "mark_provision_complete") {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "ACTIVE", activatedAt: vps.activatedAt || new Date() } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { status: "active", provisioningStatus: "ACTIVE", provisioningError: null, provisionedAt: new Date() } }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "ACTIVE" } })
    return { ok: true, status: "ACTIVE" }
  }

  if (normalized === "mark_provision_failed") {
    const reason = String(payload.reason || payload.error || "Marked failed by admin").trim()
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "FAILED" } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "FAILED", provisioningError: reason } }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "FAILED", reason } })
    return { ok: true, status: "FAILED", reason }
  }

  if (normalized === "detach_vm" || normalized === "convert_to_external_vm") {
    const provider = String(payload.provider || (vps as any).serviceProvider || "External").trim()
    const externalVmId = String(payload.externalVmId || (vps as any).externalVmId || (vps.vmid ? String(vps.vmid) : "")).trim() || null
    await (prisma as any).vpsInstance.update({
      where: { id: vps.id },
      data: {
        proxmoxNodeId: null,
        vmid: 0,
        provisionMode: "external",
        provisioningSource: "external",
        ownershipStatus: "external",
        serviceProvider: provider,
        externalVmId,
        consoleEnabled: false,
        consoleType: "none",
        ownershipEvidence: { detachedAt: nowIso(), actor: input.actorEmail, previousNodeId: vps.proxmoxNodeId, previousVmid: vps.vmid },
      },
    })
    await prisma.order.update({ where: { id: vps.orderId }, data: { vmId: 0, proxmoxNodeId: null, proxmoxNode: null, provisioningStatus: "ACTIVE", provisioningError: null } }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { provider, externalVmId } })
    return { ok: true, status: "EXTERNAL", provider, externalVmId }
  }

  if (normalized === "convert_to_managed_vm") {
    if (!vps.proxmoxNodeId || !vps.vmid) throw new Error("Attach a Proxmox node and VMID before converting to managed")
    await (prisma as any).vpsInstance.update({
      where: { id: vps.id },
      data: { provisionMode: "linked", provisioningSource: "linked", ownershipStatus: "verified", ownershipVerifiedAt: new Date(), consoleEnabled: true, consoleType: "auto" },
    })
    await prisma.order.update({ where: { id: vps.orderId }, data: { vmId: vps.vmid, proxmoxNodeId: vps.proxmoxNodeId, provisioningStatus: "ACTIVE", provisioningError: null } }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { nodeId: vps.proxmoxNodeId, vmid: vps.vmid } })
    return { ok: true, status: "MANAGED", nodeId: vps.proxmoxNodeId, vmid: vps.vmid }
  }

  if (normalized === "attach_existing_vm") {
    const nodeId = String(payload.nodeId || payload.proxmoxNodeId || "").trim()
    const vmid = assertInt(payload.vmid || payload.vmId, "vmid")
    const attached = await reassignVmMapping({ vpsId: vps.id, nodeId, vmid, actorEmail: input.actorEmail, reason: String(payload.reason || "admin_attach_existing_vm") })
    await (prisma as any).vpsInstance.update({ where: { id: vps.id }, data: { provisionMode: "linked", provisioningSource: "linked", ownershipStatus: "verified", consoleEnabled: true, consoleType: "auto" } }).catch(() => null)
    return { ok: true, attached }
  }

  if (normalized === "refresh_vm_data" || normalized === "sync_vm_configuration" || normalized === "sync_vm_ip") {
    if (isProxmoxBackedService(vps)) return syncVmStateFromProxmox({ vpsId: vps.id, actorEmail: input.actorEmail })
    const patch: Record<string, any> = {}
    if (payload.ipAddress || payload.ip) patch.ipAddress = String(payload.ipAddress || payload.ip)
    if (payload.hostname) patch.name = String(payload.hostname)
    if (payload.cpuCores || payload.cpu) patch.cpuCores = Number(payload.cpuCores || payload.cpu)
    if (payload.ramGb) patch.ramGb = Number(payload.ramGb)
    if (payload.diskGb) patch.diskGb = Number(payload.diskGb)
    if (Object.keys(patch).length) await prisma.vpsInstance.update({ where: { id: vps.id }, data: patch })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { external: true, patch } })
    return { ok: true, external: true, patch }
  }

  if (normalized === "recalculate_billing") {
    const renewalAmount = Number(vps.order.payableAmount ?? vps.order.finalAmount ?? vps.order.totalAmount ?? 0)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { renewalAmount: Number.isFinite(renewalAmount) ? renewalAmount : null } })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { renewalAmount } })
    return { ok: true, renewalAmount }
  }

  if (normalized === "generate_credentials") {
    const password = String(payload.password || `Zws-${randomSuffix(10)}!`)
    const username = String(payload.username || vps.username || vps.adminUsername || "root")
    const encrypted = encryptSecretValue(password)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { username, adminUsername: username, passwordEncrypted: encrypted } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { adminUsername: username, passwordEncrypted: encrypted } }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { username, passwordGenerated: true } })
    return { ok: true, username, password }
  }

  if (normalized === "send_welcome_email") {
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { queued: false, reason: "email_template_not_invoked" } })
    return { ok: true, queued: false, message: "Welcome email action recorded" }
  }

  const client = proxmoxClientForVps(vps)

  if (normalized === "shutdown" || normalized === "emergency_shutdown") {
    await client.shutdownVM(vps.proxmoxNode!.nodeName, vps.vmid)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "STOPPING" } })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "STOPPING" } })
    return { ok: true, status: "STOPPING" }
  }

  if (normalized === "reset" || normalized === "force_reboot") {
    await client.resetVM(vps.proxmoxNode!.nodeName, vps.vmid)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "REBOOTING" } })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "REBOOTING" } })
    return { ok: true, status: "REBOOTING" }
  }

  if (normalized === "force_kill") {
    const stopResult = await robustlyStopVm({ client, node: vps.proxmoxNode!.nodeName, vmid: vps.vmid, sshUsername: (vps.proxmoxNode as any)?.sshUsername })
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: stopResult.stopped ? "STOPPED" : "RUNNING" } })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: stopResult.stopped ? "STOPPED" : "FORCE_KILL_FAILED", via: stopResult.via } })
    return { ok: stopResult.stopped, status: stopResult.stopped ? "STOPPED" : "RUNNING" }
  }

  if (normalized === "suspend") {
    await suspendOverdueVps(vps)
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "SUSPENDED" } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "SUSPENDED" } })
    return { ok: true, status: "SUSPENDED" }
  }

  if (normalized === "unsuspend") {
    const [runtime, existingConfig] = await Promise.all([
      client.getVMStatus(vps.proxmoxNode!.nodeName, vps.vmid).catch(() => null),
      client.getVMConfig(vps.proxmoxNode!.nodeName, vps.vmid).catch(() => null),
    ])
    if (!runtime && !existingConfig) {
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "MISSING", suspendedAt: null, suspensionReason: "VM missing from Proxmox; recovery queued" } })
      await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "MISSING", provisioningError: "VM missing from Proxmox; recovery queued" } }).catch(() => undefined)
      await (prisma as any).vmProvisioningIdentity.updateMany({ where: { orderId: vps.orderId }, data: { phase: "FAILED", resumePhase: "NEW", cloneCompletedAt: null, lastError: "vm_missing_unsuspend_recovery" } }).catch(() => undefined)
      const recoveryJob = await enqueueProvisioningJob(vps.orderId, `admin:${input.actorEmail}:missing_vm_unsuspend`, { retryBlocked: true })
      await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "RECOVERY_QUEUED", jobId: recoveryJob.id, vmid: vps.vmid } })
      return { ok: true, status: "RECOVERY_QUEUED", jobId: recoveryJob.id, vmid: vps.vmid, recreated: false }
    }
    const meta = asObj(vps.lifecycleMetadata)
    if (meta.previousOnboot !== undefined && meta.previousOnboot !== null) {
      await client.updateVMConfig(vps.proxmoxNode!.nodeName, vps.vmid, { onboot: Number(meta.previousOnboot) ? 1 : 0 }).catch(() => undefined)
    }
    await client.startVM(vps.proxmoxNode!.nodeName, vps.vmid).catch(() => undefined)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "ACTIVE", suspendedAt: null, suspensionReason: null, deletionAt: null } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "ACTIVE", provisioningError: null } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "ACTIVE" } })
    return { ok: true, status: "ACTIVE" }
  }

  if (normalized === "lock") {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "LOCKED" as any } }).catch(async () => {
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "SUSPENDED", suspendedAt: new Date() } })
    })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "WAITING_FOR_ADMIN" } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "WAITING_FOR_ADMIN" } })
    return { ok: true, status: "WAITING_FOR_ADMIN" }
  }

  if (normalized === "unlock") {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "ACTIVE", suspendedAt: null } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "ACTIVE", provisioningError: null } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "ACTIVE" } })
    return { ok: true, status: "ACTIVE" }
  }

  if (normalized === "sync_vmid") {
    return syncVmIdFromProxmox({ vpsId: vps.id, actorEmail: input.actorEmail })
  }

  if (normalized === "sync_proxmox_state") {
    const synced = await syncVmStateFromProxmox({ vpsId: vps.id, actorEmail: input.actorEmail })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: synced as any })
    return synced
  }

  if (normalized === "retry_start") {
    const retried = await retryStartVps(vps.id, input.actorEmail)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { retried: true } })
    return retried
  }

  if (normalized === "retry_provision" || normalized === "force_retry") {
    const retried = await retryFailedProvisionStep({
      vpsId: vps.id,
      actorEmail: input.actorEmail,
      reason: normalized,
    })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: retried as any })
    return retried
  }

  if (normalized === "manual_provision") {
    await assertPaymentVerifiedForProvisioning(vps.orderId)
    await prisma.provisioningJob.updateMany({
      where: { orderId: vps.orderId, status: { in: ["failed", "waiting_for_admin"] } },
      data: { status: "queued", currentStep: "QUEUED", displayStatus: "Queued", error: null, errorCode: null, nextRetryAt: null, dedupeKey: null },
    })
    const job = await enqueueProvisioningJob(vps.orderId, `admin:${input.actorEmail}`)
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "QUEUED", provisioningError: null } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { jobId: job?.id || null } })
    return { queued: true, jobId: job?.id || null }
  }

  if (normalized === "reinstall") {
    const payload = input.payload || {}
    const templateId = String(payload.templateId || vps.operatingSystemId || "").trim()
    if (!templateId) throw new Error("Reinstall requires an operating system template")
    const loginMethod = ["password", "ssh", "password_ssh"].includes(String(payload.loginMethod))
      ? String(payload.loginMethod) as "password" | "ssh" | "password_ssh"
      : "password"
    const queued = await adminQueueReinstall({
      vpsId: vps.id,
      templateId,
      hostname: String(payload.hostname || vps.name),
      loginMethod,
      password: payload.password ? String(payload.password) : null,
      sshPublicKey: payload.sshPublicKey ? String(payload.sshPublicKey) : null,
      sshKeyId: payload.sshKeyId ? String(payload.sshKeyId) : null,
      preserveIp: payload.preserveIp !== false,
      reason: payload.reason ? String(payload.reason) : "admin_recovery_reinstall",
      actorEmail: input.actorEmail,
    })
    await logAdminVmAction({
      vps,
      actorEmail: input.actorEmail,
      action: normalized,
      result: queued && typeof queued === "object" ? (queued as Record<string, unknown>) : { queued: true },
    })
    return queued
  }

  if (normalized === "reset_provisioning_state") {
    await assertPaymentVerifiedForProvisioning(vps.orderId)
    await prisma.provisioningJob.updateMany({
      where: { orderId: vps.orderId, status: { in: ["failed", "waiting_for_admin", "retrying"] } },
      data: { status: "queued", currentStep: "QUEUED", displayStatus: "Queued", error: null, errorCode: null, nextRetryAt: null, completedAt: null, dedupeKey: null },
    })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "QUEUED", provisioningError: null } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "QUEUED" } })
    return { reset: true, status: "QUEUED" }
  }

  if (normalized === "reassign_node") {
    await assertPaymentVerifiedForProvisioning(vps.orderId)
    await prisma.order.update({ where: { id: vps.orderId }, data: { proxmoxNodeId: null, proxmoxNode: null, provisioningStatus: "SELECTING_NODE", provisioningError: null } }).catch(() => undefined)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { proxmoxNodeId: null, status: "CREATING" } }).catch(() => undefined)
    const job = await enqueueProvisioningJob(vps.orderId, `admin:${input.actorEmail}:reassign_node`)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { jobId: job?.id || null } })
    return { queued: true, jobId: job?.id || null, status: "SELECTING_NODE" }
  }

  if (normalized === "delete_failed_vm") {
    const now = new Date()
    if (!["FAILED", "REPAIR_NEEDED", "START_FAILED"].includes(String(vps.status || "").toUpperCase())) {
      throw new Error("Delete Failed VM is only available for failed VM records")
    }
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { status: "DELETED", deletedAt: now } })
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "FAILED_DELETED", provisioningError: null, deletedAt: now, isActive: false } }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "DELETED" } })
    return { deleted: true }
  }

  if (normalized === "delete" || normalized === "terminate") {
    const result = await requestVmDeletion({
      vpsId: vps.id,
      actorEmail: input.actorEmail,
      reason: normalized,
    })
    await logAdminVmAction({
      vps,
      actorEmail: input.actorEmail,
      action: normalized,
      result: result && typeof result === "object" ? result as Record<string, unknown> : { queued: true },
    })
    return result
  }

  if (normalized === "rebuild_cloud_init_network") {
    const retried = await retryFailedProvisionStep({
      vpsId: vps.id,
      actorEmail: input.actorEmail,
      reason: "rebuild_cloud_init_network",
    })
    await logAdminVmAction({
      vps,
      actorEmail: input.actorEmail,
      action: normalized,
      result: retried && typeof retried === "object" ? (retried as Record<string, unknown>) : { queued: true },
    })
    return retried
  }

  if (normalized === "reset_password") {
    const password = String(input.payload?.password || "").trim()
    if (password.length < 8) throw new Error("Password must be at least 8 characters")
    const username = String(input.payload?.username || vps.username || vps.adminUsername || "root").trim()
    // The password is set inside the guest, by the OS profile for the guest that
    // actually answered. The Cloud-Init version wrote `ciuser`/`cipassword` and
    // ran `qm cloudinit update`, which changed the password on the next boot
    // rather than now, and did nothing at all for a guest with no cloud-init
    // drive.
    const service = new GuestAutomationService(
      guestContextFor({ vpsInstanceId: vps.id, vmid: vps.vmid, node: vps.proxmoxNode! }),
    )
    const changed = await service.setPassword({
      username,
      password,
      metadata: osMetadataForVps(vps),
      actor: { requestedBy: input.actorEmail, role: "admin" },
    })
    if (!changed.ok) throw new Error(`password_reset_failed:${changed.errorCode}`)
    const encrypted = encryptSecretValue(password)
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: { username, adminUsername: username, passwordEncrypted: encrypted },
    })
    await prisma.order.update({
      where: { id: vps.orderId },
      data: { adminUsername: username, passwordEncrypted: encrypted },
    }).catch(() => undefined)
    await logAdminVmAction({
      vps,
      actorEmail: input.actorEmail,
      action: normalized,
      result: { status: "PASSWORD_RESET", username, runId: changed.runId, os: changed.detected.osId, template: changed.template?.name || null },
    })
    return { ok: true, status: "PASSWORD_RESET", username }
  }

  if (normalized === "resize_disk") {
    const disk = String(input.payload?.disk || input.payload?.proxmoxDiskKey || "scsi0").trim()
    const sizeGb = Number(input.payload?.sizeGb || input.payload?.diskGb || 0)
    if (!Number.isFinite(sizeGb) || sizeGb <= 0) throw new Error("Disk size must be a positive GB value")
    const currentDiskGb = Number(vps.diskGb || 0)
    if (currentDiskGb > 0 && sizeGb < currentDiskGb) throw new Error("Disk resize cannot shrink the current disk")
    const result = await client.resizeDisk(vps.proxmoxNode!.nodeName, vps.vmid, disk, `${Math.ceil(sizeGb)}G`)
    const guestResize = await expandGuestPrimaryDisk({
      client,
      nodeName: vps.proxmoxNode!.nodeName,
      vmid: vps.vmid,
      os: resolveVmGuestOs({
        osType: vps.operatingSystem?.osType,
        osFamily: vps.operatingSystem?.osFamily,
        category: vps.operatingSystem?.category,
        osName: vps.operatingSystem?.name,
        vmOsFamily: vps.vmOsFamily,
        orderOsName: vps.order?.osName,
      }),
      previousTotalBytes: vps.diskTotalGb ? Number(vps.diskTotalGb) * 1_000_000_000 : null,
    }).catch((error) => ({ ok: false, error: error?.message || String(error) }))
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { diskGb: Math.ceil(sizeGb) } })
    await (prisma as any).vpsDisk.upsert({
      where: { vpsId_proxmoxDiskKey: { vpsId: vps.id, proxmoxDiskKey: disk } },
      update: { sizeGb: Math.ceil(sizeGb), status: "ACTIVE" },
      create: { vpsId: vps.id, proxmoxDiskKey: disk, displayName: disk, sizeGb: Math.ceil(sizeGb), isPrimary: true, status: "ACTIVE" },
    }).catch(() => undefined)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { status: "DISK_RESIZED", disk, sizeGb: Math.ceil(sizeGb), guestResize } })
    return { ok: true, status: "DISK_RESIZED", disk, sizeGb: Math.ceil(sizeGb), result, guestResize }
  }

  if (normalized === "change_bandwidth_limit") {
    const restore = Boolean(input.payload?.restore || input.payload?.unthrottle)
    const result = restore
      ? await restoreBandwidthThrottle({ vpsId: vps.id, actor: input.actorEmail, reason: "admin_manual_restore" })
      : await applyBandwidthThrottle({
          vpsId: vps.id,
          actor: input.actorEmail,
          throttleRateMbps: Number(input.payload?.throttleRateMbps || input.payload?.limitMbps || 0.5),
          force: true,
        })
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: result as Record<string, unknown> })
    return result
  }

  if (normalized === "migrate_storage") {
    const disk = String(input.payload?.disk || input.payload?.proxmoxDiskKey || "scsi0").trim()
    const storage = String(input.payload?.storage || input.payload?.storageId || "").trim()
    if (!storage) throw new Error("Target storage is required")
    const result = await client.moveDisk(vps.proxmoxNode!.nodeName, vps.vmid, disk, storage)
    const pool = await (prisma as any).nodeStoragePoolConfig.findFirst({
      where: { proxmoxNodeId: vps.proxmoxNodeId, OR: [{ storageId: storage }, { proxmoxStorageId: storage }] },
      select: { id: true },
    }).catch(() => null)
    await (prisma as any).vpsDisk.updateMany({
      where: { vpsId: vps.id, proxmoxDiskKey: disk },
      data: { storagePoolId: pool?.id || null },
    }).catch(() => null)
    await logAdminVmAction({ vps, actorEmail: input.actorEmail, action: normalized, result: { disk, storage } })
    return { ok: true, status: "STORAGE_MIGRATION_STARTED", disk, storage, result }
  }

  throw new Error("Unsupported action")
}

async function waitForVmStopped(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number) {
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    const runtime = await client.getVMStatus(nodeName, vmid).catch(() => null)
    const status = String(runtime?.status || "").toLowerCase()
    if (!status || status === "stopped") return true
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  return false
}

export async function changeVmIdSafely(input: {
  vpsId: string
  targetVmid: number
  reason?: string | null
  actorEmail: string
}) {
  const targetVmid = assertInt(input.targetVmid, "targetVmid")
  const source = await getVpsForAdmin(input.vpsId)
  if (source.vmid === targetVmid) {
    return { changed: false, reason: "vmid_already_matches", vmid: source.vmid }
  }

  return withRedisLock(`vmid-change:${source.id}`, 120000, async () => {
    const refreshed = await getVpsForAdmin(source.id)
    const client = proxmoxClientForVps(refreshed)
    const nodeName = refreshed.proxmoxNode!.nodeName

    const [runtime, vmList, dbConflict] = await Promise.all([
      client.getVMStatus(nodeName, refreshed.vmid).catch(() => null),
      client.getVMList(nodeName).catch(() => []),
      prisma.vpsInstance.findFirst({ where: { vmid: targetVmid, deletedAt: null, id: { not: refreshed.id } }, select: { id: true } }),
    ])

    if (!runtime) throw new Error("Source VM does not exist on Proxmox")
    if (dbConflict) throw new Error("Target VMID is already used by another VPS record")
    if (vmList.some((vm) => Number(vm.vmid) === targetVmid)) throw new Error("Target VMID already exists on Proxmox")

    const status = String(runtime.status || "").toLowerCase()
    if (status === "running") {
      const stopResult = await client.shutdownVM(nodeName, refreshed.vmid)
      const stopUpid = String(stopResult?.data || stopResult || "")
      if (stopUpid && stopUpid.includes("UPID")) await client.waitForTask(nodeName, stopUpid, 120000).catch(() => undefined)
      const stopped = await waitForVmStopped(client, nodeName, refreshed.vmid)
      if (!stopped) {
        await client.stopVM(nodeName, refreshed.vmid).catch(() => undefined)
        const forcedStopped = await waitForVmStopped(client, nodeName, refreshed.vmid)
        if (!forcedStopped) throw new Error("Unable to stop source VM before VMID migration")
      }
    }

    const cloneName = `${refreshed.name || `vm-${refreshed.vmid}`}`
    const cloneResult = await client.cloneVM(nodeName, refreshed.vmid, targetVmid, cloneName, { full: 1 })
    const cloneUpid = String(cloneResult?.data || cloneResult || "")
    if (cloneUpid.includes("UPID")) await client.waitForTask(nodeName, cloneUpid, 300000)

    const [newVm, oldVmConfig] = await Promise.all([
      client.getVMStatus(nodeName, targetVmid).catch(() => null),
      client.getVMConfig(nodeName, refreshed.vmid).catch(() => null),
    ])
    if (!newVm) throw new Error("Target VM clone was not created")

    await prisma.$transaction(async (tx) => {
      await tx.vpsInstance.update({ where: { id: refreshed.id }, data: { vmid: targetVmid, updatedAt: new Date() } })
      await tx.provisioningJob.updateMany({ where: { vpsInstanceId: refreshed.id }, data: { vmid: targetVmid } })
      await tx.provisioningJob.updateMany({ where: { orderId: refreshed.orderId, vmid: refreshed.vmid }, data: { vmid: targetVmid } })
      await tx.ipAllocation.updateMany({ where: { vpsInstanceId: refreshed.id }, data: { vmid: targetVmid } })
      await tx.order.update({ where: { id: refreshed.orderId }, data: { vmId: targetVmid } }).catch(() => undefined)
    })
    await ensureVmIdentityNotes({
      host: refreshed.proxmoxNode!.host,
      tokenId: refreshed.proxmoxNode!.tokenId,
      tokenSecret: refreshed.proxmoxNode!.tokenSecret,
      allowInsecureTls: refreshed.proxmoxNode!.allowInsecureTls,
      nodeName,
      vmid: targetVmid,
      orderId: refreshed.orderId,
      customerId: refreshed.customerId,
      productTag: refreshed.product?.id || refreshed.productId || null,
      productId: refreshed.productId || null,
      customerName: refreshed.customer?.name || refreshed.customer?.email || null,
      productName: refreshed.product?.name || null,
      vmUuid: refreshed.id,
    }).catch(() => undefined)

    await client.deleteVM(nodeName, refreshed.vmid).catch(() => undefined)

    await createPanelLog({
      category: "Provisioning",
      message: "admin_vmid_changed",
      actorType: "admin",
      actorEmail: input.actorEmail,
      customerId: refreshed.customerId,
      orderId: refreshed.orderId,
      vpsInstanceId: refreshed.id,
      vmid: targetVmid,
      metadata: {
        oldVmid: refreshed.vmid,
        newVmid: targetVmid,
        reason: input.reason || null,
        oldVmConfig: serializeSpecFromConfig((oldVmConfig || {}) as Record<string, any>),
        changedAt: nowIso(),
      },
    }).catch(() => null)

    await createAuditLog({
      action: "VMID_CHANGED",
      actorEmail: input.actorEmail,
      customerId: refreshed.customerId,
      targetType: "vps_instance",
      targetId: refreshed.id,
      oldValue: { vmid: refreshed.vmid },
      newValue: { vmid: targetVmid },
      metadata: { reason: input.reason || null },
    }).catch(() => null)

    return {
      changed: true,
      oldVmid: refreshed.vmid,
      newVmid: targetVmid,
      node: nodeName,
      sourceStopped: true,
    }
  })
}

export async function syncVmIdFromProxmox(input: { vpsId: string; actorEmail: string }) {
  const vps = await getVpsForAdmin(input.vpsId)
  const client = proxmoxClientForVps(vps)
  const nodeName = vps.proxmoxNode!.nodeName
  const vmList = await client.getVMList(nodeName)
  const identityNotes = buildVmNotes({
    orderId: vps.orderId,
    customerId: vps.customerId,
    productId: vps.productId || null,
    productName: vps.product?.name || null,
    customerName: vps.customer?.name || vps.customer?.email || null,
    vmUuid: vps.id,
    service: "zws",
  })
  const matches: Array<{ vmid: number; method: "notes" | "description" | "tag"; confidence: "high" | "medium"; score: number }> = []
  for (const vm of vmList) {
    const vmid = Number(vm.vmid)
    if (!Number.isInteger(vmid) || vmid <= 0) continue
    const cfg = await client.getVMConfig(nodeName, vmid).catch(() => ({}))
    const notes = vmIdentityNotesMatch((cfg as any)?.description, { orderId: vps.orderId, customerId: vps.customerId, vmUuid: vps.id })
    if (notes.highConfidence) {
      matches.push({ vmid, method: "notes", confidence: "high", score: 100 })
      continue
    }
    if (notes.mediumConfidence) {
      matches.push({ vmid, method: "notes", confidence: "medium", score: 80 })
      continue
    }
    const description = String((cfg as any)?.description || "").toLowerCase()
    if (description.includes(String(vps.orderId).toLowerCase()) || description.includes(String(vps.id).toLowerCase())) {
      matches.push({ vmid, method: "description", confidence: "medium", score: 70 })
      continue
    }
    const tags = vmIdentityTagsMatch((cfg as any)?.tags, { orderId: vps.orderId, customerId: vps.customerId })
    if (tags.highConfidence) {
      matches.push({ vmid, method: "tag", confidence: "high", score: 60 })
      continue
    }
    if (tags.mediumConfidence) {
      matches.push({ vmid, method: "tag", confidence: "medium", score: 40 })
    }
  }

  matches.sort((a, b) => b.score - a.score || a.vmid - b.vmid)
  const bestMatch = matches[0] || null
  const byName = vmList.find((vm) => String(vm.name || "").trim().toLowerCase() === String(vps.name || "").trim().toLowerCase()) || null
  const chosen = bestMatch ? { vmid: bestMatch.vmid, method: bestMatch.method, confidence: bestMatch.confidence } :
    byName ? { vmid: Number(byName.vmid), method: "name_fallback" as const, confidence: "low" as const } :
    null
  if (!chosen || !Number.isInteger(chosen.vmid) || chosen.vmid <= 0) {
    return { synced: false, reason: "matching_vm_not_found", currentVmid: vps.vmid }
  }
  if (chosen.vmid === vps.vmid) {
    await ensureVmIdentityNotes({
      host: vps.proxmoxNode!.host,
      tokenId: vps.proxmoxNode!.tokenId,
      tokenSecret: vps.proxmoxNode!.tokenSecret,
      allowInsecureTls: vps.proxmoxNode!.allowInsecureTls,
      nodeName: nodeName,
      vmid: vps.vmid,
      orderId: vps.orderId,
      customerId: vps.customerId,
      productTag: vps.product?.id || vps.productId || null,
      productId: vps.productId || null,
      customerName: vps.customer?.name || vps.customer?.email || null,
      productName: vps.product?.name || null,
      vmUuid: vps.id,
    }).catch(() => undefined)
    return { synced: false, reason: "already_synced", vmid: vps.vmid, method: chosen.method, confidence: chosen.confidence }
  }

  const nextVmid = chosen.vmid
  await applyVmidNodeSync({
    vpsId: vps.id,
    orderId: vps.orderId,
    oldVmid: vps.vmid,
    newVmid: nextVmid,
    oldNodeId: vps.proxmoxNodeId,
    newNodeId: vps.proxmoxNodeId,
  })
  await ensureVmIdentityNotes({
    host: vps.proxmoxNode!.host,
    tokenId: vps.proxmoxNode!.tokenId,
    tokenSecret: vps.proxmoxNode!.tokenSecret,
    allowInsecureTls: vps.proxmoxNode!.allowInsecureTls,
    nodeName: nodeName,
    vmid: nextVmid,
    orderId: vps.orderId,
    customerId: vps.customerId,
    productTag: vps.product?.id || vps.productId || null,
    productId: vps.productId || null,
    customerName: vps.customer?.name || vps.customer?.email || null,
    productName: vps.product?.name || null,
    vmUuid: vps.id,
  }).catch(() => undefined)

  await createPanelLog({
    category: "Provisioning",
    message: "admin_vmid_synced_from_proxmox",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    orderId: vps.orderId,
    vpsInstanceId: vps.id,
    vmid: nextVmid,
    metadata: { previousVmid: vps.vmid, discoveredVmid: nextVmid, node: nodeName, method: chosen.method, confidence: chosen.confidence, requiredNotesPreview: identityNotes.slice(0, 240) },
  }).catch(() => null)

  await createAuditLog({
    action: "VMID_SYNCED_FROM_PROXMOX",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    targetType: "vps_instance",
    targetId: vps.id,
    oldValue: { vmid: vps.vmid },
    newValue: { vmid: nextVmid },
    metadata: { node: nodeName, method: chosen.method, confidence: chosen.confidence },
  }).catch(() => null)

  return { synced: true, oldVmid: vps.vmid, newVmid: nextVmid, node: nodeName, method: chosen.method, confidence: chosen.confidence }
}

export async function syncVmStateFromProxmox(input: { vpsId: string; actorEmail: string }) {
  const vps = await getVpsForAdmin(input.vpsId)
  const client = proxmoxClientForVps(vps)
  const nodeName = vps.proxmoxNode!.nodeName
  const [runtime, config] = await Promise.all([
    client.getVMStatus(nodeName, vps.vmid).catch(() => null),
    client.getVMConfig(nodeName, vps.vmid).catch(() => null),
  ])
  if (!runtime && !config) {
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: "MISSING",
        ownershipStatus: "missing_on_node",
        ownershipEvidence: {
          checkedAt: nowIso(),
          nodeId: vps.proxmoxNodeId,
          nodeName,
          vmid: vps.vmid,
          reason: "runtime_and_config_unavailable",
        },
      },
    }).catch(() => null)
    await prisma.order.update({ where: { id: vps.orderId }, data: { provisioningStatus: "MISSING", provisioningError: "VM is missing from Proxmox" } }).catch(() => null)
    await createPanelLog({
      category: "Provisioning",
      level: "error",
      message: "admin_vm_state_sync_missing",
      actorType: "admin",
      actorEmail: input.actorEmail,
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { nodeName },
    }).catch(() => null)
    return { synced: true, status: "MISSING", runtimeStatus: "missing", ipAddress: vps.ipAddress || null, ipSource: "none", metrics: null }
  }

  const health = await probeVmRuntimeHealth({
    client,
    nodeName,
    vmid: vps.vmid,
    runtime,
    config,
    allocatedIp: vps.ipAddress,
    hostname: vps.name,
    dbStatus: vps.status,
  }).catch(() => null)
  const status = health?.panelStatus || (runtime ? vmRuntimeStatus(runtime.status) : vps.status)
  if (health?.completionEligible) {
    await markRuntimeCompleteIfReady({ vpsId: vps.id, health, actor: "admin_sync_proxmox_state" }).catch(() => null)
  }
  const patch: Record<string, any> = {
    status,
    ...(health?.ipAddress ? { ipAddress: health.ipAddress } : {}),
    ownershipStatus: "verified",
    ownershipVerifiedAt: new Date(),
    ownershipEvidence: {
      checkedAt: nowIso(),
      nodeId: vps.proxmoxNodeId,
      nodeName,
      vmid: vps.vmid,
      source: "admin_sync_proxmox_state",
      runtimeStatus: runtime?.status || null,
      ipSource: health?.ipSource || "none",
      health,
    },
  }
  await prisma.vpsInstance.update({ where: { id: vps.id }, data: patch }).catch(() => null)
  await prisma.order.update({
    where: { id: vps.orderId },
    data: {
      provisioningStatus: status,
      ...(status === "ACTIVE" ? { status: "active", provisioningError: null } : {}),
      ...(health?.ipAddress ? { vmId: vps.vmid } : {}),
    },
  }).catch(() => null)
  await createPanelLog({
    category: "Provisioning",
    message: "admin_vm_state_synced_from_proxmox",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    orderId: vps.orderId,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    metadata: {
      nodeName,
      status,
      runtimeStatus: runtime?.status || null,
      ipAddress: health?.ipAddress || null,
      ipSource: health?.ipSource || "none",
      health,
      metrics: runtime ? runtimeMetrics(runtime) : null,
    },
  }).catch(() => null)

  return {
    synced: true,
    status,
    runtimeStatus: runtime?.status || "unknown",
    ipAddress: health?.ipAddress || vps.ipAddress || null,
    ipSource: health?.ipSource || "none",
    health,
    metrics: runtime ? runtimeMetrics(runtime) : null,
  }
}

export async function relinkVmByOrderIdentity(input: { vpsId: string; actorEmail: string }) {
  const vps = await getVpsForAdmin(input.vpsId)
  const result = await syncVmIdFromProxmox({ vpsId: vps.id, actorEmail: input.actorEmail })
  return { scanned: 1, updated: result.synced ? 1 : 0, details: [result] }
}

export async function scanAndRelinkVmsByOrderTags(input: {
  actorEmail: string
  nodeId?: string | null
  orderId?: string | null
  vpsId?: string | null
}) {
  await scanDuplicateManagedVms({ actorEmail: input.actorEmail, nodeId: input.nodeId, apply: true })
  const nodes = await prisma.proxmoxNode.findMany({
    where: input.nodeId ? { id: String(input.nodeId) } : undefined,
    select: { id: true, nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
    orderBy: { createdAt: "asc" },
  })

  const details: Array<Record<string, unknown>> = []
  let scanned = 0
  let updated = 0
  let conflicts = 0

  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const vmList = await client.getVMList(node.nodeName).catch(() => [])
    for (const vm of vmList) {
      const vmid = Number(vm.vmid)
      if (!Number.isInteger(vmid) || vmid <= 0) continue
      scanned += 1
      const config: Record<string, any> = await client.getVMConfig(node.nodeName, vmid).catch(() => ({} as Record<string, any>))
      const notes = extractMetadataFromNotes((config as any)?.description)
      const tags = parseVmIdentityTags((config as any)?.tags)
      const orderId = String(notes.orderId || tags.orderId || "").trim()
      const customerId = String(notes.customerId || tags.customerId || "").trim()
      const service = String(notes.service || tags.service || "").trim().toLowerCase()
      if (!orderId || !["zws", "vps"].includes(service)) continue
      const quarantined = await (prisma as any).duplicateVmIncident.findUnique({ where: { vmid }, select: { status: true } }).catch(() => null)
      if (quarantined && ["QUARANTINED", "QUARANTINE_FAILED"].includes(quarantined.status)) {
        details.push({ node: node.nodeName, vmid, orderId, status: "skipped", reason: "duplicate_quarantined" })
        continue
      }
      if (input.orderId && orderId !== String(input.orderId)) continue

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { vpsInstance: true },
      })
      if (!order?.vpsInstance || order.vpsInstance.deletedAt) {
        details.push({ node: node.nodeName, vmid, orderId, status: "skipped", reason: "order_or_vps_missing" })
        continue
      }
      if (input.vpsId && order.vpsInstance.id !== String(input.vpsId)) continue
      if (customerId && order.vpsInstance.customerId !== customerId) {
        conflicts += 1
        details.push({ node: node.nodeName, vmid, orderId, vpsId: order.vpsInstance.id, status: "conflict", reason: "customer_tag_mismatch" })
        continue
      }

      const vmidChanged = Number(order.vpsInstance.vmid) !== vmid
      const nodeChanged = String(order.vpsInstance.proxmoxNodeId || "") !== String(node.id)
      if (vmidChanged || nodeChanged) {
        await applyVmidNodeSync({
          vpsId: order.vpsInstance.id,
          orderId: order.id,
          oldVmid: Number(order.vpsInstance.vmid || 0) || vmid,
          newVmid: vmid,
          oldNodeId: order.vpsInstance.proxmoxNodeId,
          newNodeId: node.id,
        })
        await prisma.order.update({
          where: { id: order.id },
          data: {
            proxmoxNode: node.nodeName,
            provisioningStatus: order.provisioningStatus === "FAILED" ? "ACTIVE" : order.provisioningStatus,
            provisioningError: vmidChanged || nodeChanged ? null : order.provisioningError,
          },
        }).catch(() => undefined)
        updated += 1
        details.push({ node: node.nodeName, vmid, orderId, vpsId: order.vpsInstance.id, status: "updated", vmidChanged, nodeChanged })
      } else {
        details.push({ node: node.nodeName, vmid, orderId, vpsId: order.vpsInstance.id, status: "unchanged" })
      }

      await ensureVmIdentityNotes({
        host: node.host,
        tokenId: node.tokenId,
        tokenSecret: node.tokenSecret,
        allowInsecureTls: node.allowInsecureTls,
        nodeName: node.nodeName,
        vmid,
        orderId,
        customerId: order.vpsInstance.customerId,
        productTag: order.vpsInstance.productId || null,
        productId: order.vpsInstance.productId || null,
        customerName: null,
        productName: null,
        vmUuid: order.vpsInstance.id,
      }).catch(() => undefined)
    }
  }

  await createPanelLog({
    category: "Provisioning",
    message: "admin_vps_relink_scan",
    actorType: "admin",
    actorEmail: input.actorEmail,
    metadata: { scanned, updated, conflicts, nodeId: input.nodeId || null, orderId: input.orderId || null, vpsId: input.vpsId || null },
  }).catch(() => null)

  await createAuditLog({
    action: "VM_RELINK_SCAN",
    actorEmail: input.actorEmail,
    targetType: "system",
    targetId: "proxmox_vps_relink",
    oldValue: null,
    newValue: { scanned, updated, conflicts },
    metadata: { nodeId: input.nodeId || null, orderId: input.orderId || null, vpsId: input.vpsId || null },
  }).catch(() => null)

  return { scanned, updated, conflicts, details: details.slice(0, 500) }
}

const REPAIRABLE_ORDER_STATUSES = ["paid", "active", "completed", "payment_verified", "verification_pending"]

type ProxmoxRepairMatch = {
  node: {
    id: string
    nodeName: string
    host: string
    tokenId: string
    tokenSecret: string
    allowInsecureTls: boolean
  }
  vmid: number
  name: string
  status: string | null
  config: Record<string, any>
  runtime: Record<string, any> | null
  method: "identity"
}

async function findProxmoxVmForOrder(order: any): Promise<{ match: ProxmoxRepairMatch | null; scanned: number; conflicts: string[] }> {
  const nodes = await prisma.proxmoxNode.findMany({
    where: order.proxmoxNodeId ? { id: order.proxmoxNodeId } : { isActive: true },
    select: { id: true, nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
    orderBy: { createdAt: "asc" },
  })
  const matches: ProxmoxRepairMatch[] = []
  let scanned = 0
  const conflicts: string[] = []

  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    const list = await client.getVMList(node.nodeName).catch((error: any) => {
      conflicts.push(`${node.nodeName}: ${error?.message || "vm list failed"}`)
      return []
    })
    for (const vm of list) {
      const vmid = Number(vm.vmid)
      if (!Number.isInteger(vmid) || vmid <= 0) continue
      scanned += 1
      const vmName = String(vm.name || "").trim()
      let method: ProxmoxRepairMatch["method"] | null = null
      const config: Record<string, any> = await client.getVMConfig(node.nodeName, vmid).catch(() => ({} as Record<string, any>))
      const notes = extractMetadataFromNotes((config as any)?.description)
      const tags = parseVmIdentityTags((config as any)?.tags)
      const noteOrderId = String(notes.orderId || tags.orderId || "").trim()
      if (noteOrderId && noteOrderId === String(order.id)) method = "identity"
      if (!method) continue
      const runtime = await client.getVMStatus(node.nodeName, vmid).catch(() => null)
      matches.push({ node, vmid, name: vmName || String(config.name || `vm-${vmid}`), status: String(vm.status || runtime?.status || "") || null, config, runtime, method })
    }
  }

  if (matches.length > 1) {
    conflicts.push(`multiple_matches:${matches.map((item) => `${item.node.nodeName}/${item.vmid}`).join(",")}`)
    return { match: null, scanned, conflicts }
  }
  return { match: matches[0] || null, scanned, conflicts }
}

export async function repairPaidOrderVmLink(input: { orderId: string; actorEmail: string }) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: input.orderId }, { orderNumber: input.orderId }], deletedAt: null },
    include: { vpsInstance: true, customer: true, product: true },
  })
  if (!order) throw new Error("Order not found")
  const status = String(order.status || "").toLowerCase()
  if (!REPAIRABLE_ORDER_STATUSES.includes(status)) {
    return { repaired: false, reason: "order_not_paid", orderId: order.id, status }
  }
  if (!order.customerId) return { repaired: false, reason: "missing_customer", orderId: order.id }
  if (order.vpsInstance && !order.vpsInstance.deletedAt) {
    const existing = order.vpsInstance
    const liveEnough = Boolean(existing.vmid && existing.ipAddress && ["active", "running", "stopped", "ACTIVE", "STOPPED"].includes(String(existing.status || "")))
    if (liveEnough && String(order.provisioningStatus || "").toUpperCase() !== "ACTIVE") {
      await prisma.$transaction([
        prisma.order.update({
          where: { id: order.id },
          data: {
            serviceId: existing.id,
            vmId: existing.vmid,
            proxmoxNodeId: existing.proxmoxNodeId,
            hostname: order.hostname || existing.name,
            adminUsername: order.adminUsername || existing.adminUsername || existing.username,
            passwordEncrypted: order.passwordEncrypted || existing.passwordEncrypted,
            provisioningStatus: "ACTIVE",
            provisioningError: null,
            provisionedAt: order.provisionedAt || new Date(),
            status: ["paid", "payment_verified", "completed"].includes(status) ? "active" : order.status,
          },
        }),
        prisma.provisioningJob.updateMany({
          where: { orderId: order.id, vpsInstanceId: existing.id, status: { in: ["queued", "running", "retrying", "failed", "waiting_for_admin"] } },
          data: { status: "completed", currentStep: "ACTIVE", displayStatus: "Active", error: null, errorCode: null, completedAt: new Date(), dedupeKey: null },
        }) as any,
      ]).catch(async () => {
        await prisma.order.update({ where: { id: order.id }, data: { serviceId: existing.id, vmId: existing.vmid, provisioningStatus: "ACTIVE", provisioningError: null, status: "active" } }).catch(() => null)
      })
      return { repaired: true, reason: "already_linked_status_repaired", orderId: order.id, vpsId: existing.id, vmid: existing.vmid, ipAddress: existing.ipAddress }
    }
    return { repaired: false, reason: "already_linked", orderId: order.id, vpsId: existing.id }
  }

  const discovery = await findProxmoxVmForOrder(order)
  if (!discovery.match) {
    await createPanelLog({
      category: "Provisioning",
      level: "warn",
      message: "admin_repair_vm_link_skipped",
      actorType: "admin",
      actorEmail: input.actorEmail,
      customerId: order.customerId,
      orderId: order.id,
      metadata: { scanned: discovery.scanned, conflicts: discovery.conflicts, hostname: order.hostname || null },
    }).catch(() => null)
    return { repaired: false, reason: discovery.conflicts.length ? "conflict" : "vm_not_found", orderId: order.id, scanned: discovery.scanned, conflicts: discovery.conflicts }
  }

  const match = discovery.match
  const metadata = asObj(order.metadata)
  const config = match.config || {}
  const memoryMb = Number(config.memory || 0) || (Number(match.runtime?.maxmem || 0) > 0 ? Number(match.runtime?.maxmem || 0) / 1024 / 1024 : 0)
  const diskBytes = Number(match.runtime?.maxdisk || 0)
  const ipAddress = parsePrimaryIp(config, metadata)
  const username = String(order.adminUsername || config.ciuser || metadata.username || "").trim() || null
  const passwordEncrypted = order.passwordEncrypted || String(metadata.passwordEncrypted || "") || null
  const activatedAt = order.provisionedAt || order.updatedAt || new Date()
  const vpsCreatedAt = new Date()
  const dates = lifecycleDates({ createdAt: vpsCreatedAt, termMonths: Math.max(1, Number(order.termMonths || 1)), graceDays: 2, retentionDays: 7 })
  const renewalDueAt = dates.renewalDueAt

  const vps = await prisma.vpsInstance.upsert({
    where: { orderId: order.id },
    update: {
      deletedAt: null,
      customerId: order.customerId,
      productId: order.productId || null,
      nodeClassId: order.nodeClassId || null,
      storagePoolId: order.storagePoolId || null,
      proxmoxNodeId: match.node.id,
      operatingSystemId: order.operatingSystemId || null,
      vmid: match.vmid,
      name: match.name,
      status: vmRuntimeStatus(match.runtime?.status || match.status),
      ipAddress,
      username,
      adminUsername: username,
      passwordEncrypted,
      cpuCores: Number(config.cores || match.runtime?.cpus || 0) || order.product?.cpuCores || null,
      ramGb: memoryMb > 0 ? Math.round(memoryMb / 1024) : order.product?.ramGb || null,
      diskGb: diskBytes > 0 ? Math.round(diskBytes / 1024 / 1024 / 1024) : order.product?.storageGb || null,
      billingTermMonths: Math.max(1, Number(order.termMonths || 1)),
      activatedAt,
      renewalDueAt,
      nextRenewalAt: renewalDueAt,
      suspendAt: dates.suspendAt,
      penaltyAt: dates.penaltyAt,
      terminationAt: dates.terminationAt,
      deletionAt: dates.deletionAt,
      editedAt: new Date(),
      editReason: "Repair VM Link",
    },
    create: {
      customerId: order.customerId,
      orderId: order.id,
      productId: order.productId || null,
      nodeClassId: order.nodeClassId || null,
      storagePoolId: order.storagePoolId || null,
      proxmoxNodeId: match.node.id,
      operatingSystemId: order.operatingSystemId || null,
      vmid: match.vmid,
      name: match.name,
      status: vmRuntimeStatus(match.runtime?.status || match.status),
      ipAddress,
      username,
      adminUsername: username,
      passwordEncrypted,
      cpuCores: Number(config.cores || match.runtime?.cpus || 0) || order.product?.cpuCores || null,
      ramGb: memoryMb > 0 ? Math.round(memoryMb / 1024) : order.product?.ramGb || null,
      diskGb: diskBytes > 0 ? Math.round(diskBytes / 1024 / 1024 / 1024) : order.product?.storageGb || null,
      billingTermMonths: Math.max(1, Number(order.termMonths || 1)),
      createdAt: vpsCreatedAt,
      activatedAt,
      renewalDueAt,
      nextRenewalAt: renewalDueAt,
      suspendAt: dates.suspendAt,
      penaltyAt: dates.penaltyAt,
      terminationAt: dates.terminationAt,
      deletionAt: dates.deletionAt,
      editedAt: new Date(),
      editReason: "Repair VM Link",
    },
  })
  await persistVpsConsoleMetadata({ vpsId: vps.id, osTemplateId: order.operatingSystemId || null })

  await prisma.order.update({
    where: { id: order.id },
    data: {
      serviceId: vps.id,
      vmId: match.vmid,
      proxmoxNodeId: match.node.id,
      proxmoxNode: match.node.nodeName,
      hostname: order.hostname || match.name,
      adminUsername: username || order.adminUsername,
      passwordEncrypted: passwordEncrypted || order.passwordEncrypted,
      provisioningStatus: "ACTIVE",
      provisioningError: null,
      provisionedAt: order.provisionedAt || new Date(),
      status: ["paid", "payment_verified", "completed"].includes(status) ? "active" : order.status,
    },
  })

  await ensureVmIdentityNotes({
    host: match.node.host,
    tokenId: match.node.tokenId,
    tokenSecret: match.node.tokenSecret,
    allowInsecureTls: match.node.allowInsecureTls,
    nodeName: match.node.nodeName,
    vmid: match.vmid,
    orderId: order.id,
    customerId: order.customerId,
    productTag: order.productId || null,
    productId: order.productId || null,
    customerName: order.customer?.name || order.customer?.email || null,
    productName: order.product?.name || null,
    vmUuid: vps.id,
  }).catch(() => undefined)

  await createPanelLog({
    category: "Provisioning",
    message: "admin_repair_vm_link",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: order.customerId,
    orderId: order.id,
    vpsInstanceId: vps.id,
    vmid: match.vmid,
    metadata: { nodeId: match.node.id, nodeName: match.node.nodeName, hostname: match.name, method: match.method, ipAddress, restoredUsername: Boolean(username), restoredPassword: Boolean(passwordEncrypted) },
  }).catch(() => null)
  await createAuditLog({
    action: "VM_LINK_REPAIRED",
    actorEmail: input.actorEmail,
    customerId: order.customerId,
    targetType: "order",
    targetId: order.id,
    oldValue: { serviceId: order.serviceId, vmId: order.vmId, proxmoxNodeId: order.proxmoxNodeId },
    newValue: { serviceId: vps.id, vmId: match.vmid, proxmoxNodeId: match.node.id },
    metadata: { method: match.method, nodeName: match.node.nodeName, ipAddress },
  }).catch(() => null)

  return { repaired: true, orderId: order.id, vpsId: vps.id, vmid: match.vmid, node: match.node.nodeName, ipAddress, method: match.method }
}

export async function repairPaidOrdersMissingVmLinks(input: { actorEmail: string; limit?: number }) {
  const limit = Math.max(1, Math.min(Number(input.limit || 25), 100))
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: REPAIRABLE_ORDER_STATUSES },
      vpsInstance: null,
      customerId: { not: null },
    },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "desc" },
  })
  const results = []
  for (const order of orders) {
    results.push(await repairPaidOrderVmLink({ orderId: order.id, actorEmail: input.actorEmail }).catch((error: any) => ({
      repaired: false,
      orderId: order.id,
      reason: error?.message || "repair_failed",
    })))
  }
  return { scanned: orders.length, repaired: results.filter((row: any) => row.repaired).length, results }
}

export async function importExistingVm(input: {
  nodeId: string
  vmid: number
  orderId: string
  customerId: string
  actorEmail: string
  reason?: string | null
  originalSignupDate?: unknown
  existingExpiryDate?: unknown
  customRenewalDate?: unknown
  prepaidRemainingDays?: unknown
  activatedAt?: unknown
  allowDefaultMonthly?: boolean
  autoSuspendEnabled?: boolean
  autoDeleteEnabled?: boolean
  pauseReminders?: boolean
  preservePaidStatus?: boolean
  preservedInvoiceNumber?: string | null
}) {
  const vmid = assertInt(input.vmid, "vmid")
  const [node, order, customer] = await Promise.all([
    prisma.proxmoxNode.findUnique({ where: { id: input.nodeId } }),
    prisma.order.findUnique({ where: { id: input.orderId }, include: { vpsInstance: true } }),
    prisma.customer.findUnique({ where: { id: input.customerId } }),
  ])

  if (!node) throw new Error("Node not found")
  if (!order) throw new Error("Order not found")
  if (!customer) throw new Error("Customer not found")
  if (order.vpsInstance && order.vpsInstance.deletedAt === null) throw new Error("Order already has an active VPS record")
  await assertVmMappingAvailable({ nodeId: node.id, vmid })

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
  })

  const [runtime, config] = await Promise.all([
    client.getVMStatus(node.nodeName, vmid).catch(() => null),
    client.getVMConfig(node.nodeName, vmid).catch(() => null),
  ])
  if (!runtime || !config) throw new Error("Proxmox VM not found for selected node/vmid")

  const hostname = String(config.name || `vm-${vmid}`)
  const cpu = Number(config.cores || 0) || Number(config.sockets || 1)
  const memoryMb = Number(config.memory || 0)
  const importedRenewal = resolveImportedRenewalDueAt({
    existingExpiryDate: input.existingExpiryDate,
    customRenewalDate: input.customRenewalDate,
    prepaidRemainingDays: input.prepaidRemainingDays,
    existingRenewalDate: order.vpsInstance?.nextRenewalAt,
    allowDefaultMonthly: input.allowDefaultMonthly === true,
  })
  const activatedAt = input.activatedAt ? new Date(String(input.activatedAt)) : input.originalSignupDate ? new Date(String(input.originalSignupDate)) : (order.provisionedAt || order.createdAt)
  const safeActivatedAt = Number.isNaN(activatedAt.getTime()) ? (order.provisionedAt || order.createdAt) : activatedAt
  const editor = await prisma.adminProfile.findUnique({ where: { email: String(input.actorEmail).toLowerCase() }, select: { id: true } }).catch(() => null)
  const renewalDueAt = importedRenewal.renewalDueAt
  const dates = lifecycleDates({ renewalDueAt, graceDays: 2, retentionDays: 7 })
  const billingPatch = {
    billingTermMonths: Math.max(1, Number(order.termMonths || 1)),
    activatedAt: safeActivatedAt,
    renewalDueAt,
    nextRenewalAt: renewalDueAt,
    suspendAt: dates.suspendAt,
    penaltyAt: dates.penaltyAt,
    terminationAt: dates.terminationAt,
    manualExpiryOverride: Boolean(renewalDueAt),
    manualCreatedDateOverride: Boolean(input.originalSignupDate || input.activatedAt),
    createdAtManual: input.originalSignupDate ? safeActivatedAt : null,
    activatedAtManual: input.activatedAt || input.originalSignupDate ? safeActivatedAt : null,
    renewalAtManual: renewalDueAt,
    suspendAtManual: dates.suspendAt,
    terminationAtManual: dates.suspendAt,
    deletionAtManual: null,
    editedByAdminId: editor?.id || null,
    editedAt: new Date(),
    editReason: input.reason || "Imported existing VM",
    autoSuspendEnabled: input.autoSuspendEnabled !== false,
    autoDeleteEnabled: input.autoDeleteEnabled !== false,
    remindersPausedAt: input.pauseReminders ? new Date() : null,
    lifecycleMetadata: {
      importRenewalSource: importedRenewal.source,
      originalSignupDate: input.originalSignupDate || null,
      existingExpiryDate: input.existingExpiryDate || null,
      customRenewalDate: input.customRenewalDate || null,
      prepaidRemainingDays: input.prepaidRemainingDays ?? null,
      importedAt: nowIso(),
      preservedInvoiceNumber: input.preservedInvoiceNumber || null,
    },
  }

  const vps = await prisma.vpsInstance.upsert({
    where: { orderId: order.id },
    update: {
      customerId: customer.id,
      proxmoxNodeId: node.id,
      vmid,
      name: hostname,
      status: String(runtime.status || "stopped").toLowerCase() === "running" ? "ACTIVE" : "STOPPED",
      cpuCores: cpu || null,
      ramGb: memoryMb > 0 ? Math.round(memoryMb / 1024) : null,
      orderId: order.id,
      provisionMode: "linked",
      provisioningSource: "imported",
      ownershipStatus: "verified",
      ownershipVerifiedAt: new Date(),
      ...billingPatch,
    },
    create: {
      customerId: customer.id,
      orderId: order.id,
      proxmoxNodeId: node.id,
      vmid,
      name: hostname,
      status: String(runtime.status || "stopped").toLowerCase() === "running" ? "ACTIVE" : "STOPPED",
      cpuCores: cpu || null,
      ramGb: memoryMb > 0 ? Math.round(memoryMb / 1024) : null,
      ipAddress: String(config.ipconfig0 || "").includes("ip=") ? String(config.ipconfig0) : null,
      provisionMode: "linked",
      provisioningSource: "imported",
      ownershipStatus: "verified",
      ownershipVerifiedAt: new Date(),
      ownershipEvidence: { importedAt: nowIso(), actor: input.actorEmail, nodeId: node.id, nodeName: node.nodeName, vmid },
      ...billingPatch,
    },
  })
  await persistVpsConsoleMetadata({ vpsId: vps.id, osTemplateId: order.operatingSystemId || null })

  await prisma.order.update({
    where: { id: order.id },
    data: {
      customerId: customer.id,
      proxmoxNodeId: node.id,
      vmId: vmid,
      serviceId: vps.id,
      proxmoxNode: node.nodeName,
      provisioningStatus: "ACTIVE",
      provisioningError: null,
      status: input.preservePaidStatus && ["paid", "active", "payment_verified"].includes(String(order.status || "").toLowerCase()) ? order.status : "active",
    },
  })
  await ensureVmIdentityNotes({
    host: node.host,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
    nodeName: node.nodeName,
    vmid,
    orderId: order.id,
    customerId: customer.id,
    productTag: order.productId || null,
    productId: order.productId || null,
    customerName: customer.name || customer.email || null,
    productName: null,
    vmUuid: vps.id,
  }).catch(() => undefined)

  await createPanelLog({
    category: "Provisioning",
    message: "admin_import_existing_vm",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: customer.id,
    orderId: order.id,
    vpsInstanceId: vps.id,
    vmid,
    metadata: {
      nodeId: node.id,
      nodeName: node.nodeName,
      reason: input.reason || null,
      renewalDueAt,
      renewalSource: importedRenewal.source,
      vmSpec: serializeSpecFromConfig(config),
    },
  }).catch(() => null)

  await createAuditLog({
    action: "VM_IMPORTED",
    actorEmail: input.actorEmail,
    customerId: customer.id,
    targetType: "vps_instance",
    targetId: vps.id,
    oldValue: null,
    newValue: { vmid, nodeId: node.id, orderId: order.id, renewalDueAt },
    metadata: { reason: input.reason || null, renewalSource: importedRenewal.source },
  }).catch(() => null)

  return {
    imported: true,
    vpsId: vps.id,
    orderId: order.id,
    vmid,
    node: node.nodeName,
    status: vps.status,
  }
}

export async function bindExistingVmToOrder(input: {
  orderId: string
  customerId: string
  nodeId: string
  vmid: number
  actorEmail: string
  source?: "linked" | "imported"
  reason?: string | null
  serviceCreatedAt?: Date | string | null
  serviceDueAt?: Date | string | null
}) {
  const vmid = assertInt(input.vmid, "vmid")
  const [order, customer, node] = await Promise.all([
    prisma.order.findUnique({ where: { id: input.orderId }, include: { vpsInstance: true, customer: true, product: true, operatingSystem: true } }),
    prisma.customer.findUnique({ where: { id: input.customerId } }),
    prisma.proxmoxNode.findFirst({ where: { id: input.nodeId, isActive: true } }),
  ])
  if (!order) throw new Error("Order not found")
  if (!customer) throw new Error("Customer not found")
  if (!node) throw new Error("Node not found or inactive")
  if (order.customerId && order.customerId !== customer.id) throw new Error("Order belongs to a different customer")
  if (order.vpsInstance && !order.vpsInstance.deletedAt) throw new Error("Order already has an active VPS record")
  const preview = await loadExistingVmPreview({ nodeId: node.id, vmid })
  if (!preview.validation?.ok) {
    const error = new Error(preview.validation?.error || "Existing VM validation failed")
    ;(error as any).assigned = preview.assigned || null
    ;(error as any).validation = preview.validation || null
    throw error
  }

  const client = proxmoxClientForNode(node)
  const [runtime, config] = await Promise.all([
    client.getVMStatus(node.nodeName, vmid).catch(() => null),
    client.getVMConfig(node.nodeName, vmid).catch(() => null),
  ])
  const cfg = (config || {}) as Record<string, any>
  const discovered = await discoverVmIpAddress({
    client,
    nodeName: node.nodeName,
    vmid,
    config: cfg,
    allocatedIp: parsePrimaryIp(cfg, asObj(order.metadata)),
    hostname: String(cfg.name || order.hostname || runtime?.name || `vm-${vmid}`),
  }).catch(() => null)
  const createdAt = input.serviceCreatedAt ? new Date(input.serviceCreatedAt) : order.createdAt || new Date()
  const renewalDueAt = input.serviceDueAt ? new Date(input.serviceDueAt) : null
  const dates = lifecycleDates({
    orderCreatedAt: createdAt,
    termMonths: Math.max(1, Number(order.termMonths || 1)),
    renewalDueAt,
    graceDays: 2,
    retentionDays: 7,
  })
  const hostname = String(cfg.name || order.hostname || runtime?.name || `vm-${vmid}`)
  const status = vmRuntimeStatus(runtime?.status || "unknown")
  const ipAddress = discovered?.ipAddress || parsePrimaryIp(cfg, asObj(order.metadata))
  const vps = await prisma.vpsInstance.create({
    data: {
      customerId: customer.id,
      orderId: order.id,
      productId: order.productId || null,
      nodeClassId: order.nodeClassId || null,
      storagePoolId: order.storagePoolId || null,
      proxmoxNodeId: node.id,
      operatingSystemId: order.operatingSystemId || null,
      vmid,
      provisionMode: "linked",
      provisioningSource: input.source || "linked",
      ownershipStatus: "verified",
      ownershipVerifiedAt: new Date(),
      ownershipEvidence: {
        linkedAt: nowIso(),
        actor: input.actorEmail,
        reason: input.reason || null,
        nodeId: node.id,
        nodeName: node.nodeName,
        vmid,
        vmSpec: serializeSpecFromConfig(cfg),
      },
      name: hostname,
      status: status === "UNKNOWN" ? "ACTIVE" : status,
      ipAddress,
      username: order.adminUsername || null,
      adminUsername: order.adminUsername || null,
      passwordEncrypted: order.passwordEncrypted || null,
      accessMethod: order.accessMethod || null,
      sshKeyId: order.sshKeyId || null,
      cpuCores: cpuCoresFromConfig(cfg, runtime) || order.product?.cpuCores || null,
      ramGb: memoryMbToGb(cfg.memory) || bytesToGb(runtime?.maxmem) || order.product?.ramGb || null,
      diskGb: diskGbFromConfig(cfg, runtime) || order.product?.storageGb || null,
      billingCycle: Math.max(1, Number(order.termMonths || 1)) === 1 ? "monthly" : `${Math.max(1, Number(order.termMonths || 1))}m`,
      billingTermMonths: Math.max(1, Number(order.termMonths || 1)),
      createdAt,
      activatedAt: createdAt,
      renewalDueAt: dates.renewalDueAt,
      nextRenewalAt: dates.renewalDueAt,
      suspendAt: dates.suspendAt,
      penaltyAt: dates.penaltyAt,
      terminationAt: dates.terminationAt,
      deletionAt: dates.deletionAt,
      manualCreatedDateOverride: Boolean(input.serviceCreatedAt),
      manualExpiryOverride: Boolean(input.serviceDueAt),
      createdAtManual: input.serviceCreatedAt ? createdAt : null,
      activatedAtManual: input.serviceCreatedAt ? createdAt : null,
      renewalAtManual: input.serviceDueAt ? dates.renewalDueAt : null,
      lifecycleMetadata: {
        linkedExistingVm: true,
        linkedAt: nowIso(),
        linkedBy: input.actorEmail,
        linkReason: input.reason || null,
        linkedServiceCreatedAt: input.serviceCreatedAt ? createdAt.toISOString() : null,
        linkedServiceDueAt: input.serviceDueAt && dates.renewalDueAt ? dates.renewalDueAt.toISOString() : null,
      },
    },
  })
  await persistVpsConsoleMetadata({ vpsId: vps.id, osTemplateId: order.operatingSystemId || null })
  await prisma.order.update({
    where: { id: order.id },
    data: {
      customerId: customer.id,
      serviceId: vps.id,
      vmId: vmid,
      proxmoxNodeId: node.id,
      proxmoxNode: node.nodeName,
      hostname,
      provisioningStatus: "ACTIVE",
      provisioningError: null,
      provisionedAt: new Date(),
      status: "active",
      metadata: {
        ...asObj(order.metadata),
        provisionMode: "linked",
        linkedExistingVm: {
          actor: input.actorEmail,
          linkedAt: nowIso(),
          nodeId: node.id,
          nodeName: node.nodeName,
          vmid,
          reason: input.reason || null,
        },
      },
    },
  })
  await prisma.provisioningJob.updateMany({
    where: { orderId: order.id, status: { in: ["queued", "running", "retrying", "waiting_for_admin"] } },
    data: { status: "completed", currentStep: "LINKED_EXISTING_VM", displayStatus: "Linked existing VM", completedAt: new Date(), error: null, errorCode: null, dedupeKey: null },
  }).catch(() => undefined)
  await ensureVmIdentityNotes({
    host: node.host,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
    nodeName: node.nodeName,
    vmid,
    orderId: order.id,
    customerId: customer.id,
    productTag: order.product?.id || order.productId || null,
    productId: order.productId || null,
    customerName: customer.name || customer.email || null,
    customerEmail: customer.email || null,
    productName: order.product?.name || null,
    vmUuid: vps.id,
  }).catch(() => undefined)
  await createPanelLog({
    category: "Provisioning",
    message: "admin_linked_existing_vm",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: customer.id,
    orderId: order.id,
    vpsInstanceId: vps.id,
    vmid,
    metadata: { nodeId: node.id, nodeName: node.nodeName, reason: input.reason || null, ipAddress, provisionMode: "linked" },
  }).catch(() => null)
  await createAuditLog({
    action: "ADMIN_LINKED_EXISTING_VM",
    actorEmail: input.actorEmail,
    customerId: customer.id,
    targetType: "vps_instance",
    targetId: vps.id,
    oldValue: null,
    newValue: { orderId: order.id, nodeId: node.id, nodeName: node.nodeName, vmid },
    metadata: { orderNumber: order.orderNumber, customer: customer.email || customer.name || customer.id, timestamp: nowIso() },
  }).catch(() => null)

  return { linked: true, orderId: order.id, vpsId: vps.id, vmid, node: node.nodeName, ipAddress, status: vps.status }
}

export async function reassignVmMapping(input: {
  vpsId: string
  nodeId: string
  vmid: number
  actorEmail: string
  reason?: string | null
}) {
  const vmid = assertInt(input.vmid, "vmid")
  const vps = await getVpsForAdmin(input.vpsId)
  const node = await prisma.proxmoxNode.findFirst({ where: { id: input.nodeId, isActive: true } })
  if (!node) throw new Error("Node not found or inactive")
  await assertVmMappingAvailable({ nodeId: node.id, vmid, excludeVpsId: vps.id })
  const client = proxmoxClientForNode(node)
  const [runtime, config] = await Promise.all([
    client.getVMStatus(node.nodeName, vmid).catch(() => null),
    client.getVMConfig(node.nodeName, vmid).catch(() => null),
  ])
  if (!runtime && !config) throw new Error("Proxmox VM not found for selected node/vmid")
  const oldValue = { nodeId: vps.proxmoxNodeId, nodeName: vps.proxmoxNode?.nodeName || null, vmid: vps.vmid }
  await applyVmidNodeSync({
    vpsId: vps.id,
    orderId: vps.orderId,
    oldVmid: vps.vmid,
    newVmid: vmid,
    oldNodeId: vps.proxmoxNodeId,
    newNodeId: node.id,
  })
  const cfg = (config || {}) as Record<string, any>
  await prisma.vpsInstance.update({
    where: { id: vps.id },
    data: {
      name: String(cfg.name || runtime?.name || vps.name),
      status: vmRuntimeStatus(runtime?.status || vps.status),
      ownershipStatus: "verified",
      ownershipVerifiedAt: new Date(),
      ownershipEvidence: {
        reassignedAt: nowIso(),
        actor: input.actorEmail,
        reason: input.reason || null,
        previous: oldValue,
        next: { nodeId: node.id, nodeName: node.nodeName, vmid },
      },
    },
  }).catch(() => null)
  await prisma.order.update({ where: { id: vps.orderId }, data: { proxmoxNode: node.nodeName, provisioningStatus: "ACTIVE", provisioningError: null } }).catch(() => null)
  await ensureVmIdentityNotes({
    host: node.host,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
    nodeName: node.nodeName,
    vmid,
    orderId: vps.orderId,
    customerId: vps.customerId,
    productTag: vps.product?.id || vps.productId || null,
    productId: vps.productId || null,
    customerName: vps.customer?.name || vps.customer?.email || null,
    productName: vps.product?.name || null,
    vmUuid: vps.id,
  }).catch(() => undefined)
  await createPanelLog({
    category: "Provisioning",
    message: "admin_vm_reassigned",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    orderId: vps.orderId,
    vpsInstanceId: vps.id,
    vmid,
    metadata: { oldValue, newValue: { nodeId: node.id, nodeName: node.nodeName, vmid }, reason: input.reason || null },
  }).catch(() => null)
  await createAuditLog({
    action: "VM_REASSIGNED",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    targetType: "vps_instance",
    targetId: vps.id,
    oldValue,
    newValue: { nodeId: node.id, nodeName: node.nodeName, vmid },
    metadata: { reason: input.reason || null },
  }).catch(() => null)
  return { reassigned: true, old: oldValue, next: { nodeId: node.id, nodeName: node.nodeName, vmid } }
}

export function scoreIdentityMatch(input: {
  notes: ReturnType<typeof extractMetadataFromNotes>
  orderId: string
  serviceId: string
  customerId: string
}) {
  const noteOrder = String(input.notes.orderId || "").trim()
  const noteService = String((input.notes as any).serviceId || input.notes.service || "").trim()
  const noteCustomer = String(input.notes.customerId || "").trim()
  const noteUuid = String((input.notes as any).zws_uuid || (input.notes as any).uuid || (input.notes as any).vm_uuid || (input.notes as any).vm_id || "").trim()
  if (noteUuid && noteUuid === input.serviceId) return { score: 400, method: "uuid" }
  if (noteOrder && noteOrder === input.orderId) return { score: 300, method: "order_id" }
  if (noteService && noteService === input.serviceId) return { score: 200, method: "service_id" }
  if (noteCustomer && noteCustomer === input.customerId) return { score: 100, method: "customer_id" }
  return { score: 0, method: "none" }
}

export async function autoFindVmForService(input: {
  vpsId: string
  nodeId: string
  actorEmail: string
  apply?: boolean
}) {
  const vps = await getVpsForAdmin(input.vpsId)
  const node = await prisma.proxmoxNode.findFirst({ where: { id: input.nodeId, isActive: true } })
  if (!node) throw new Error("Node not found or inactive")
  const client = proxmoxClientForNode(node)
  const list = await client.getVMList(node.nodeName).catch(() => [])
  const matches: Array<{ vmid: number; name: string; score: number; method: string; status: string | null }> = []
  for (const row of list) {
    const vmid = Number(row.vmid || 0)
    if (!Number.isInteger(vmid) || vmid <= 0) continue
    const config = await client.getVMConfig(node.nodeName, vmid).catch(() => ({} as Record<string, any>))
    const notes = extractMetadataFromNotes((config as any).description)
    const scored = scoreIdentityMatch({ notes, orderId: vps.orderId, serviceId: vps.id, customerId: vps.customerId })
    if (scored.score <= 0) continue
    matches.push({ vmid, name: String((config as any).name || row.name || `vm-${vmid}`), score: scored.score, method: scored.method, status: row.status || null })
  }
  matches.sort((a, b) => b.score - a.score || a.vmid - b.vmid)
  const best = matches[0] || null
  if (!best) return { found: false, reason: "matching_vm_not_found", scanned: list.length, matches: [] }
  const ties = matches.filter((item) => item.score === best.score)
  if (ties.length > 1) return { found: false, reason: "multiple_equal_matches", scanned: list.length, matches: ties }
  if (!input.apply) return { found: true, scanned: list.length, match: best, matches: matches.slice(0, 10) }
  const reassigned = await reassignVmMapping({
    vpsId: vps.id,
    nodeId: node.id,
    vmid: best.vmid,
    actorEmail: input.actorEmail,
    reason: `auto_find:${best.method}`,
  })
  return { found: true, scanned: list.length, match: best, reassigned }
}

export async function scanVmInfrastructure(input: { actorEmail: string; nodeId?: string | null; repair?: boolean }) {
  await scanDuplicateManagedVms({ actorEmail: input.actorEmail, nodeId: input.nodeId, apply: Boolean(input.repair) })
  const nodes = await prisma.proxmoxNode.findMany({
    where: input.nodeId ? { id: input.nodeId } : undefined,
    orderBy: { createdAt: "asc" },
  })
  const activeVps = await prisma.vpsInstance.findMany({
    where: { deletedAt: null },
    include: { order: true, customer: { select: { id: true, email: true, name: true } }, proxmoxNode: true },
  })
  const serviceByNodeVmid = new Map(activeVps.filter((vps) => vps.proxmoxNodeId && vps.vmid > 0).map((vps) => [`${vps.proxmoxNodeId}:${vps.vmid}`, vps]))
  const seen = new Set<string>()
  let validMappings = 0
  let brokenMappings = 0
  let orphanedVms = 0

  const perNodeRows: Array<Array<Record<string, any>>> = await mapLimit(nodes, 2, async (node: (typeof nodes)[number]): Promise<Record<string, any>[]> => {
    const client = proxmoxClientForNode(node)
    const list = await client.getVMList(node.nodeName).catch((error: any) => {
      return [{ type: "node_error", nodeId: node.id, nodeName: node.nodeName, status: "error", error: error?.message || "VM list failed" }]
    })
    if (!Array.isArray(list)) return list
    const incidents =
      list.length > 0
        ? await (prisma as any).duplicateVmIncident
          .findMany({
            where: { vmid: { in: list.map((vm: any) => Number(vm.vmid)).filter((v: number) => Number.isInteger(v) && v > 0) } },
            select: { vmid: true, status: true },
          })
          .catch(() => [])
        : []
    const incidentByVmid = new Map(incidents.map((row: any) => [Number(row.vmid), row.status]))
    const vmRows: Array<Record<string, any>> = await mapLimit(list, 8, async (vm: any): Promise<Record<string, any> | null> => {
      const vmid = Number(vm.vmid || 0)
      if (!Number.isInteger(vmid) || vmid <= 0) return null
      const key = `${node.id}:${vmid}`
      seen.add(key)
      const mapped = serviceByNodeVmid.get(key)
      const config = await client.getVMConfig(node.nodeName, vmid).catch(() => ({} as Record<string, any>))
      const notes = extractMetadataFromNotes((config as any).description)
      const quarantined = incidentByVmid.get(vmid)
      if (quarantined && ["QUARANTINED", "QUARANTINE_FAILED"].includes(String(quarantined))) {
        return { type: "duplicate_vm", status: "quarantined", nodeId: node.id, nodeName: node.nodeName, vmid, notes }
      }
      if (mapped) {
        validMappings += 1
        return { type: "mapped_vm", status: "valid", nodeId: node.id, nodeName: node.nodeName, vmid, vpsId: mapped.id, orderId: mapped.orderId, customerId: mapped.customerId, notes }
      }
      const repairCandidate = activeVps.find((vps) =>
        (notes.orderId && vps.orderId === notes.orderId) ||
        ((notes as any).serviceId && vps.id === (notes as any).serviceId) ||
        (notes.vmUuid && vps.id === notes.vmUuid) ||
        (notes.customerId && vps.customerId === notes.customerId)
      ) || null
      orphanedVms += 1
      const row: Record<string, any> = { type: "orphaned_vm", status: repairCandidate ? "repairable" : "orphaned", nodeId: node.id, nodeName: node.nodeName, vmid, name: vm.name || (config as any).name || `vm-${vmid}`, notes, repairCandidate: repairCandidate ? { vpsId: repairCandidate.id, orderId: repairCandidate.orderId, customerId: repairCandidate.customerId } : null }
      if (input.repair && repairCandidate) {
        await reassignVmMapping({ vpsId: repairCandidate.id, nodeId: node.id, vmid, actorEmail: input.actorEmail, reason: "scanner_repair" }).catch((error: any) => {
          row.status = "error"
          row.error = error?.message || "Repair failed"
        })
      }
      return row
    }).then((rows) => rows.filter((row): row is Record<string, any> => row !== null))
    return vmRows
  })

  const rows: Array<Record<string, any>> = perNodeRows.flat()

  for (const vps of activeVps) {
    if (!vps.proxmoxNodeId || !vps.proxmoxNode) {
      brokenMappings += 1
      rows.push({ type: "orphaned_service", status: "missing_node", vpsId: vps.id, orderId: vps.orderId, customerId: vps.customerId, vmid: vps.vmid })
      continue
    }
    const key = `${vps.proxmoxNodeId}:${vps.vmid}`
    if (!seen.has(key)) {
      brokenMappings += 1
      rows.push({ type: "orphaned_service", status: "vm_missing", nodeId: vps.proxmoxNodeId, nodeName: vps.proxmoxNode.nodeName, vpsId: vps.id, orderId: vps.orderId, customerId: vps.customerId, vmid: vps.vmid })
    }
    if (!vps.order) {
      brokenMappings += 1
      rows.push({ type: "orphaned_service", status: "order_missing", vpsId: vps.id, orderId: vps.orderId, customerId: vps.customerId, vmid: vps.vmid })
    }
  }

  const summary = { nodes: nodes.length, validMappings, brokenMappings, orphanedVms, orphanedServices: rows.filter((row) => row.type === "orphaned_service").length, repairable: rows.filter((row) => row.status === "repairable").length }
  await createPanelLog({
    category: "Provisioning",
    message: "admin_vm_scanner_run",
    actorType: "admin",
    actorEmail: input.actorEmail,
    metadata: { ...summary, nodeId: input.nodeId || null, repair: Boolean(input.repair) },
  }).catch(() => null)
  return { summary, rows: rows.slice(0, 1000) }
}

export async function listImportableProxmoxVms(input: { nodeId?: string | null }) {
  const nodes = await prisma.proxmoxNode.findMany({
    where: input.nodeId ? { id: input.nodeId, isActive: true } : { isActive: true },
    orderBy: { createdAt: "asc" },
  })
  const assigned = await prisma.vpsInstance.findMany({
    where: { deletedAt: null, proxmoxNodeId: { not: null }, vmid: { gt: 0 } },
    include: { customer: { select: { id: true, email: true, name: true } }, order: { select: { id: true, orderNumber: true } } },
  })
  const assignedMap = new Map(assigned.map((vps) => [`${vps.proxmoxNodeId}:${vps.vmid}`, vps]))
  const flattened = (await mapLimit(nodes, 2, async (node) => {
    const client = proxmoxClientForNode(node)
    const list = await client.getVMList(node.nodeName).catch(() => [])
    if (!Array.isArray(list) || list.length === 0) return []
    return mapLimit(list, 8, async (vm: any) => {
      const vmid = Number(vm.vmid || 0)
      if (!Number.isInteger(vmid) || vmid <= 0) return null
      const config = await client.getVMConfig(node.nodeName, vmid).catch(() => ({} as Record<string, any>))
      const assignedVps = assignedMap.get(`${node.id}:${vmid}`)
      return {
        vmid,
        nodeId: node.id,
        nodeName: node.nodeName,
        name: String((config as any).name || vm.name || `vm-${vmid}`),
        cpu: cpuCoresFromConfig(config, vm),
        ramGb: memoryMbToGb((config as any).memory) || bytesToGb((vm as any).maxmem),
        diskGb: diskGbFromConfig(config, vm),
        ip: parsePrimaryIp(config, {}),
        status: String(vm.status || "unknown"),
        assigned: assignedVps ? {
          vpsId: assignedVps.id,
          customer: assignedVps.customer?.name || assignedVps.customer?.email || assignedVps.customerId,
          order: assignedVps.order?.orderNumber || assignedVps.orderId,
        } : null,
        notes: extractMetadataFromNotes((config as any).description),
      }
    }).then((rows) => rows.filter((row) => row !== null))
  })).flat()
  const vms = flattened
  return { vms }
}

export async function adminQueueReinstall(input: {
  vpsId: string
  templateId: string
  hostname: string
  loginMethod: "password" | "ssh" | "password_ssh"
  password?: string | null
  sshPublicKey?: string | null
  sshKeyId?: string | null
  preserveIp?: boolean
  reason?: string | null
  actorEmail: string
}) {
  const vps = await getVpsForAdmin(input.vpsId)

  return withRedisLock(`provisioning-lock:${vps.id}`, 30000, async () => {
    const existingActive = await prisma.provisioningJob.findFirst({
      where: {
        vpsInstanceId: vps.id,
        type: "reinstall",
        status: { in: ["queued", "running"] },
      },
      orderBy: { createdAt: "desc" },
    })
    if (existingActive) {
      return {
        queued: false,
        reason: "reinstall_in_progress",
        message: "Reinstall already in progress",
        jobId: existingActive.id,
      }
    }

    const dedupeKey = `reinstall:${vps.id}:${Date.now()}:${randomSuffix(4)}`
    const password = input.password && input.password.trim().length ? String(input.password) : undefined
    const sshPublicKey = input.sshPublicKey && input.sshPublicKey.trim().length ? String(input.sshPublicKey) : undefined

    const job = await enqueueReinstallJob({
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      customerId: vps.customerId,
      osTemplateId: input.templateId,
      hostname: input.hostname || vps.name,
      username: String(vps.adminUsername || vps.username || "root"),
      password,
      sshPublicKey,
      preserveIp: input.preserveIp !== false,
      actor: `admin:${input.actorEmail}`,
      loginMethod: input.loginMethod,
      sshKeyId: input.sshKeyId || undefined,
      dedupeKey,
    } as any)

    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: "REINSTALLING",
        name: input.hostname || vps.name,
        operatingSystemId: input.templateId,
      },
    })
    await persistVpsConsoleMetadata({ vpsId: vps.id, osTemplateId: input.templateId })
    await prisma.order.update({
      where: { id: vps.orderId },
      data: {
        provisioningStatus: "REINSTALLING",
        provisioningError: null,
        operatingSystemId: input.templateId,
      },
    }).catch(() => undefined)

    await createAuditLog({
      action: "VM_REINSTALL_REQUESTED",
      actorEmail: input.actorEmail,
      customerId: vps.customerId,
      targetType: "vps_instance",
      targetId: vps.id,
      oldValue: { status: vps.status, templateId: vps.operatingSystemId },
      newValue: { status: "REINSTALLING", templateId: input.templateId },
      metadata: { reason: input.reason || null, jobId: job.id },
    }).catch(() => null)

    return { queued: true, jobId: job.id, dedupeKey }
  })
}

export async function retryFailedProvisionStep(input: {
  vpsId: string
  actorEmail: string
  reason?: string | null
}) {
  const vps = await getVpsForAdmin(input.vpsId)
  const failedJob = await prisma.provisioningJob.findFirst({
    where: {
      vpsInstanceId: vps.id,
      type: { in: ["provision", "upgrade", "reinstall", "start_retry"] },
      status: { in: ["failed", "waiting_for_admin", "completed"] },
      OR: [{ error: { not: null } }, { currentStep: { in: ["FAILED", "START_FAILED", "WAITING_FOR_ADMIN"] } }],
    },
    orderBy: { createdAt: "desc" },
  })

  if (!failedJob) {
    return { queued: false, reason: "no_failed_job_found" }
  }

  if (failedJob.type === "start_retry") {
    const retried = await retryStartVps(vps.id, input.actorEmail)
    return { queued: true, retried }
  }

  const nextType = failedJob.type === "upgrade" ? "upgrade" : failedJob.type === "reinstall" ? "reinstall" : "provision"
  if (nextType !== "reinstall") {
    await assertPaymentVerifiedForProvisioning(vps.orderId)
  }

  if (nextType === "reinstall") {
    const meta = asObj(failedJob.metadata)
    const reinstall = asObj(meta.reinstall)
    const queued = await adminQueueReinstall({
      vpsId: vps.id,
      templateId: String(reinstall.osTemplateId || vps.operatingSystemId || ""),
      hostname: String(reinstall.requestedHostname || vps.name),
      loginMethod: String(reinstall.loginMethod || "password") as "password" | "ssh" | "password_ssh",
      password: null,
      sshPublicKey: reinstall.sshPublicKey ? String(reinstall.sshPublicKey) : null,
      sshKeyId: reinstall.sshKeyId ? String(reinstall.sshKeyId) : null,
      preserveIp: reinstall.preserveIp !== false,
      reason: input.reason || "retry_failed_step",
      actorEmail: input.actorEmail,
    })
    return { queued: true, reinstall: queued }
  }

  await prisma.provisioningJob.update({
    where: { id: failedJob.id },
    data: {
      status: "queued",
      currentStep: nextType === "upgrade" ? "UPGRADE_QUEUED" : "QUEUED",
      displayStatus: "Queued",
      error: null,
      errorCode: null,
      ...(!isSafePanelVmid(failedJob.vmid) ? { vmid: null } : {}),
      completedAt: null,
      nextRetryAt: null,
      dedupeKey: `${nextType}:${vps.orderId}`,
      metadata: {
        ...asObj(failedJob.metadata),
        adminRetry: {
          at: nowIso(),
          actor: input.actorEmail,
          reason: input.reason || null,
          fromStep: failedJob.currentStep || null,
        },
      },
    },
  })

  await prisma.order.update({
    where: { id: vps.orderId },
    data: {
      provisioningStatus: nextType === "upgrade" ? "UPGRADE_QUEUED" : "QUEUED",
      provisioningError: null,
      ...(!isSafePanelVmid(vps.vmid) ? { vmId: null } : {}),
    },
  }).catch(() => undefined)
  if (!isSafePanelVmid(vps.vmid)) {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { vmid: 0, status: "CREATING" } }).catch(() => undefined)
  }

  await createAuditLog({
    action: "PROVISIONING_STEP_RETRY_REQUESTED",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    targetType: "provisioning_job",
    targetId: failedJob.id,
    oldValue: { status: failedJob.status, step: failedJob.currentStep, error: failedJob.error },
    newValue: { status: "queued", step: nextType === "upgrade" ? "UPGRADE_QUEUED" : "QUEUED" },
    metadata: { reason: input.reason || null },
  }).catch(() => null)

  await createPanelLog({
    category: "Provisioning",
    message: "admin_retry_failed_provision_step",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    orderId: vps.orderId,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    metadata: {
      previousJobId: failedJob.id,
      previousStep: failedJob.currentStep || null,
      reason: input.reason || null,
      nextType,
    },
  }).catch(() => null)

  return {
    queued: true,
    jobId: failedJob.id,
    nextStep: nextType === "upgrade" ? "UPGRADE_QUEUED" : "QUEUED",
  }
}
