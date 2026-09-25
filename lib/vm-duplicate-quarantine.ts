import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { extractMetadataFromNotes } from "@/lib/proxmox-tags"
import { robustlyStopVm } from "@/lib/vm-power-control"
import { createPanelLog } from "@/lib/panel-log"
import { createAuditLog } from "@/lib/audit-log"
import { extractUpid } from "@/lib/provisioning-status"

export type DiscoveredVm = {
  node: any
  client: ReturnType<typeof createProxmoxClient>
  vmid: number
  name: string
  status: string
  config: Record<string, any>
  notes: ReturnType<typeof extractMetadataFromNotes>
  createdAt: Date
  ip: string | null
  mac: string | null
}

export const ACTIVE_DUPLICATE_INCIDENT_STATUSES = ["QUARANTINED", "QUARANTINE_FAILED"] as const

export function isActiveDuplicateIncidentStatus(status: unknown) {
  return ACTIVE_DUPLICATE_INCIDENT_STATUSES.includes(String(status) as (typeof ACTIVE_DUPLICATE_INCIDENT_STATUSES)[number])
}

export function selectPrimaryDuplicateVm(rows: DiscoveredVm[], linked?: { proxmoxNodeId?: string | null; vmid?: number | null } | null) {
  const databaseLinked = linked
    ? rows.find((row) => row.vmid === Number(linked.vmid) && row.node.id === linked.proxmoxNodeId)
    : null
  if (databaseLinked) return { primary: databaseLinked, reason: "database_linked_vm" as const }
  const ranked = [...rows].sort((a, b) => {
    const healthyA = ["running", "stopped"].includes(a.status) ? 1 : 0
    const healthyB = ["running", "stopped"].includes(b.status) ? 1 : 0
    return healthyB - healthyA || b.createdAt.getTime() - a.createdAt.getTime() || b.vmid - a.vmid
  })
  return { primary: ranked[0], reason: "newest_healthy_vm" as const }
}

function parseIp(config: Record<string, any>) {
  const match = String(config.ipconfig0 || "").match(/(?:^|,)ip=([^/,]+)/i)
  const value = String(match?.[1] || "").trim()
  return value && value.toLowerCase() !== "dhcp" ? value : null
}

function parseMac(config: Record<string, any>) {
  const value = String(config.net0 || "")
  const match = value.match(/(?:^|=)([0-9a-f]{2}(?::[0-9a-f]{2}){5})(?:,|$)/i)
  return match?.[1]?.toUpperCase() || null
}

function parsedCreatedAt(vm: any, notes: ReturnType<typeof extractMetadataFromNotes>) {
  const noteDate = notes.createdAt ? new Date(String(notes.createdAt).replace(" UTC", "Z")) : null
  if (noteDate && !Number.isNaN(noteDate.getTime())) return noteDate
  const ctime = Number(vm.ctime || 0)
  return ctime > 0 ? new Date(ctime * 1000) : new Date(0)
}

function duplicateNote(input: { original: string; primaryVmid: number; orderId: string; detectedAt: Date }) {
  const marker = "--- ZWS DUPLICATE QUARANTINE ---"
  const clean = String(input.original || "").split(marker)[0].trimEnd()
  return [
    clean,
    "",
    marker,
    "DUPLICATE VM",
    `Original VMID: ${input.primaryVmid}`,
    `Original Order ID: ${input.orderId}`,
    `Detection Time: ${input.detectedAt.toISOString()}`,
    "Auto Detected: true",
    "ZWS_DUPLICATE=true",
    `ZWS_PRIMARY_VMID=${input.primaryVmid}`,
    "",
  ].join("\n")
}

export async function discoverManagedVms(input: { nodeId?: string | null; createdFrom?: Date | null } = {}) {
  const nodes = await prisma.proxmoxNode.findMany({
    where: input.nodeId ? { id: input.nodeId, isActive: true } : { isActive: true },
    orderBy: { createdAt: "asc" },
  })
  const found: DiscoveredVm[] = []
  const errors: Array<{ nodeId: string; nodeName: string; error: string }> = []
  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
    const list = await client.getVMList(node.nodeName).catch((error: any) => {
      errors.push({ nodeId: node.id, nodeName: node.nodeName, error: error?.message || "VM list failed" })
      return []
    })
    for (const vm of list) {
      const vmid = Number(vm.vmid || 0)
      if (!Number.isInteger(vmid) || vmid <= 0 || Number((vm as any).template || 0) === 1) continue
      const config = await client.getVMConfig(node.nodeName, vmid).catch(() => null)
      if (!config || Number((config as any).template || 0) === 1) continue
      const notes = extractMetadataFromNotes((config as any).description)
      const orderId = String(notes.orderId || "").trim()
      if (!orderId) continue
      const createdAt = parsedCreatedAt(vm, notes)
      if (input.createdFrom && createdAt < input.createdFrom) continue
      found.push({
        node,
        client,
        vmid,
        name: String((config as any).name || vm.name || `vm-${vmid}`),
        status: String(vm.status || "unknown").toLowerCase(),
        config: config as Record<string, any>,
        notes,
        createdAt,
        ip: parseIp(config as Record<string, any>),
        mac: parseMac(config as Record<string, any>),
      })
    }
  }
  return { found, errors }
}

export async function findProxmoxVmsByOrder(orderId: string) {
  const discovered = await discoverManagedVms()
  return { matches: discovered.found.filter((vm) => String(vm.notes.orderId || "") === String(orderId)), errors: discovered.errors }
}

export async function scanDuplicateManagedVms(input: {
  actorEmail: string
  nodeId?: string | null
  createdFrom?: Date | null
  apply?: boolean
}) {
  const discovered = await discoverManagedVms(input)
  const groups = new Map<string, DiscoveredVm[]>()
  for (const vm of discovered.found) {
    const orderId = String(vm.notes.orderId)
    const list = groups.get(orderId) || []
    list.push(vm)
    groups.set(orderId, list)
  }
  const duplicateGroups = Array.from(groups.entries()).filter(([, rows]) => rows.length > 1)
  const results: Array<Record<string, unknown>> = []
  let quarantined = 0
  for (const [orderId, rows] of duplicateGroups) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vpsInstance: true } })
    const selected = selectPrimaryDuplicateVm(rows, order?.vpsInstance)
    const primary = selected.primary
    const primaryReason = selected.reason
    const duplicates = rows.filter((row) => row !== primary)
    const groupResult: Record<string, unknown> = {
      orderId,
      primary: { nodeId: primary.node.id, nodeName: primary.node.nodeName, vmid: primary.vmid, status: primary.status, reason: primaryReason },
      duplicates: [],
    }
    for (const duplicate of duplicates) {
      const detectedAt = new Date()
      let stopResult: { stopped: boolean; via: string } | null = null
      let error: string | null = null
      if (input.apply) {
        try {
          stopResult = await robustlyStopVm({ client: duplicate.client, node: duplicate.node.nodeName, vmid: duplicate.vmid, graceful: true })
          await duplicate.client.updateVMConfig(duplicate.node.nodeName, duplicate.vmid, {
            description: duplicateNote({ original: String(duplicate.config.description || ""), primaryVmid: primary.vmid, orderId, detectedAt }),
            onboot: 0,
          })
          const incident = await (prisma as any).duplicateVmIncident.upsert({
            where: { vmid: duplicate.vmid },
            create: {
              orderId,
              vpsInstanceId: order?.vpsInstance?.id || null,
              proxmoxNodeId: duplicate.node.id,
              vmid: duplicate.vmid,
              primaryVmid: primary.vmid,
              status: stopResult?.stopped ? "QUARANTINED" : "QUARANTINE_FAILED",
              detectedIp: duplicate.ip,
              detectedMac: duplicate.mac,
              detectionReason: "multiple_proxmox_vms_for_order",
              primaryReason,
              notesBefore: String(duplicate.config.description || ""),
              evidence: { name: duplicate.name, status: duplicate.status, createdAt: duplicate.createdAt.toISOString(), stopResult },
              stoppedAt: stopResult?.stopped ? new Date() : null,
            },
            update: {
              orderId,
              vpsInstanceId: order?.vpsInstance?.id || null,
              proxmoxNodeId: duplicate.node.id,
              primaryVmid: primary.vmid,
              status: stopResult?.stopped ? "QUARANTINED" : "QUARANTINE_FAILED",
              detectedIp: duplicate.ip,
              detectedMac: duplicate.mac,
              detectionReason: "multiple_proxmox_vms_for_order",
              primaryReason,
              evidence: { name: duplicate.name, status: duplicate.status, createdAt: duplicate.createdAt.toISOString(), stopResult },
              stoppedAt: stopResult?.stopped ? new Date() : undefined,
              deletionError: null,
            },
          })
          if (order?.vpsInstance?.id) {
            await prisma.ipAllocation.updateMany({
              where: { vmid: duplicate.vmid, vpsInstanceId: order.vpsInstance.id },
              data: { vmid: primary.vmid },
            })
          }
          await prisma.ipAllocation.updateMany({
            where: { vmid: duplicate.vmid, OR: [{ vpsInstanceId: null }, { vpsInstanceId: { not: order?.vpsInstance?.id || "" } }] },
            data: { status: "free", vpsInstanceId: null, vmid: null, hostname: null, allocationLockKey: null, releasedAt: new Date() },
          })
          await prisma.vmIpAssignment.updateMany({
            where: { vmid: duplicate.vmid, status: { in: ["active", "assigned", "used", "reserved"] } },
            data: { status: "quarantined", isPrimary: false, detachedAt: new Date() },
          })
          await createPanelLog({ category: "Provisioning", level: "warn", message: "duplicate_vm_quarantined", actorType: "system", actorEmail: input.actorEmail, orderId, vpsInstanceId: order?.vpsInstance?.id || null, vmid: duplicate.vmid, metadata: { incidentId: incident.id, primaryVmid: primary.vmid, stopResult } }).catch(() => null)
          quarantined += 1
        } catch (cause: any) {
          error = cause?.message || String(cause)
        }
      }
      ;(groupResult.duplicates as any[]).push({ nodeId: duplicate.node.id, nodeName: duplicate.node.nodeName, vmid: duplicate.vmid, status: duplicate.status, ip: duplicate.ip, createdAt: duplicate.createdAt, stopResult, error })
    }
    results.push(groupResult)
  }
  const incidentReconciliation = input.apply ? await reconcileDuplicateVmIncidents() : null
  await createAuditLog({ action: input.apply ? "DUPLICATE_VM_SCAN_AND_QUARANTINE" : "DUPLICATE_VM_SCAN", actorEmail: input.actorEmail, targetType: "system", targetId: "duplicate_vm_scanner", newValue: { scanned: discovered.found.length, groups: duplicateGroups.length, quarantined }, metadata: { nodeId: input.nodeId || null, createdFrom: input.createdFrom?.toISOString() || null, errors: discovered.errors } }).catch(() => null)
  return { scanned: discovered.found.length, duplicateOrderCount: duplicateGroups.length, quarantined, errors: discovered.errors, groups: results, incidentReconciliation }
}

export async function reconcileDuplicateVmIncidents() {
  const incidents = await (prisma as any).duplicateVmIncident.findMany({
    where: { status: { not: "DELETED" } },
    include: { proxmoxNode: true },
  })
  const clients = new Map<string, ReturnType<typeof createProxmoxClient>>()
  const existingVmids = new Map<string, Set<number>>()
  const errors: Array<{ nodeId: string; nodeName: string; vmid?: number; error: string }> = []
  for (const incident of incidents) {
    const node = incident.proxmoxNode
    if (clients.has(node.id)) continue
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
    clients.set(node.id, client)
    const vms = await client.getVMList(node.nodeName).catch((error: any) => {
      errors.push({ nodeId: node.id, nodeName: node.nodeName, error: error?.message || String(error) })
      return null
    })
    if (vms) existingVmids.set(node.id, new Set(vms.map((vm: any) => Number(vm.vmid)).filter((vmid: number) => Number.isInteger(vmid))))
  }

  const summary = { quarantined: 0, failed: 0, missingUnreviewed: 0, superseded: 0, errors }
  for (const incident of incidents) {
    const node = incident.proxmoxNode
    const client = clients.get(node.id)!
    const nodeVmids = existingVmids.get(node.id)
    if (!nodeVmids) continue
    if (!nodeVmids.has(Number(incident.vmid))) {
      await (prisma as any).duplicateVmIncident.update({ where: { id: incident.id }, data: { status: "MISSING_UNREVIEWED" } })
      summary.missingUnreviewed += 1
      continue
    }
    const observed = await Promise.all([
      client.getVMConfig(node.nodeName, incident.vmid),
      client.getVMStatus(node.nodeName, incident.vmid),
    ]).catch((error: any) => {
      errors.push({ nodeId: node.id, nodeName: node.nodeName, vmid: incident.vmid, error: error?.message || String(error) })
      return null
    })
    if (!observed) continue
    const [config, runtime] = observed
    const identity = extractMetadataFromNotes((config as any).description)
    if (String(identity.orderId || "") !== String(incident.orderId)) {
      await (prisma as any).duplicateVmIncident.update({ where: { id: incident.id }, data: { status: "SUPERSEDED" } })
      summary.superseded += 1
      continue
    }
    const stopped = String((runtime as any).status || "").toLowerCase() === "stopped"
    const onbootDisabled = Number((config as any).onboot || 0) === 0
    const annotated = String((config as any).description || "").includes("--- ZWS DUPLICATE QUARANTINE ---")
    const status = stopped && onbootDisabled && annotated ? "QUARANTINED" : "QUARANTINE_FAILED"
    await (prisma as any).duplicateVmIncident.update({ where: { id: incident.id }, data: { status } })
    if (status === "QUARANTINED") summary.quarantined += 1
    else summary.failed += 1
  }
  return summary
}

export async function listDuplicateVmIncidents() {
  const incidents = await (prisma as any).duplicateVmIncident.findMany({
    include: { vpsInstance: { select: { id: true, name: true, vmid: true, ipAddress: true } }, proxmoxNode: { select: { id: true, name: true, nodeName: true } } },
    orderBy: [{ status: "asc" }, { detectedAt: "desc" }],
  })
  const orderIds = Array.from(new Set(incidents.map((incident: any) => String(incident.orderId)))) as string[]
  const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })
  const ordersById = new Map(orders.map((order) => [order.id, order]))
  return incidents.map((incident: any) => ({ ...incident, order: ordersById.get(String(incident.orderId)) || null }))
}

export async function permanentlyDeleteDuplicateVm(input: { incidentId: string; actorEmail: string }) {
  const incident = await (prisma as any).duplicateVmIncident.findUnique({ where: { id: input.incidentId }, include: { proxmoxNode: true } })
  if (!incident) throw new Error("Duplicate incident not found")
  if (incident.status === "DELETED") return incident
  const client = createProxmoxClient(incident.proxmoxNode.host, incident.proxmoxNode.tokenId, incident.proxmoxNode.tokenSecret, { allowInsecureTls: incident.proxmoxNode.allowInsecureTls, timeoutMs: PROXMOX_LONG_TIMEOUT_MS })
  const resources = await client.getClusterResources().catch(() => [])
  const primaryResource = resources.find((row: any) => row?.type === "qemu" && Number(row.vmid) === Number(incident.primaryVmid))
  const primaryNodeName = String(primaryResource?.node || incident.proxmoxNode.nodeName)
  const [primary, duplicateConfig] = await Promise.all([
    client.getVMConfig(primaryNodeName, incident.primaryVmid).catch(() => null),
    client.getVMConfig(incident.proxmoxNode.nodeName, incident.vmid).catch(() => null),
  ])
  if (!primary) throw new Error("Primary VM is missing; duplicate cleanup blocked")
  const primaryIdentity = extractMetadataFromNotes((primary as any).description)
  if (String(primaryIdentity.orderId || "") !== String(incident.orderId)) throw new Error("Primary VM identity does not match the incident order; cleanup blocked")
  if (duplicateConfig) {
    const identity = extractMetadataFromNotes((duplicateConfig as any).description)
    if (String(identity.orderId || "") !== String(incident.orderId)) throw new Error("Duplicate VM identity changed; cleanup blocked")
    await robustlyStopVm({ client, node: incident.proxmoxNode.nodeName, vmid: incident.vmid, graceful: true })
    const deletion = await client.deleteVM(incident.proxmoxNode.nodeName, incident.vmid, { purge: true, destroyUnreferencedDisks: true })
    const upid = extractUpid(deletion)
    if (upid) await client.waitForTask(incident.proxmoxNode.nodeName, upid, 600_000)
    const stillExists = await client.getVMConfig(incident.proxmoxNode.nodeName, incident.vmid).then(() => true).catch(() => false)
    if (stillExists) throw new Error("Duplicate VM still exists after Proxmox deletion task")
  }
  const updated = await (prisma as any).duplicateVmIncident.update({ where: { id: incident.id }, data: { status: "DELETED", approvedAt: new Date(), approvedBy: input.actorEmail, deletedAt: new Date(), deletionError: null } })
  await createAuditLog({ action: "DUPLICATE_VM_PERMANENTLY_DELETED", actorEmail: input.actorEmail, targetType: "duplicate_vm_incident", targetId: incident.id, oldValue: { vmid: incident.vmid, primaryVmid: incident.primaryVmid }, newValue: { status: "DELETED" }, metadata: { orderId: incident.orderId, nodeId: incident.proxmoxNodeId } }).catch(() => null)
  return updated
}
