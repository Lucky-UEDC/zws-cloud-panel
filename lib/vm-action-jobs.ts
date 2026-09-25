import os from "node:os"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { extractUpid } from "@/lib/provisioning-status"
import { robustlyRebootVm, robustlyStopVm } from "@/lib/vm-power-control"
import { requestId, writeStructuredLog } from "@/lib/structured-logger"
import { createPanelLog } from "@/lib/panel-log"
import { createAuditLog } from "@/lib/audit-log"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"

export type VmAction = "start" | "stop" | "restart" | "shutdown"
export type VmActionActor = {
  customerId?: string
  requestedBy: string
  requestedRole: "customer" | "admin" | "api_key" | "system"
}

const ACTIVE = ["queued", "running"]
const LEASE_MS = 3 * 60_000

function actionError(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, code })
}

function canonicalAction(value: string): VmAction {
  if (value === "reboot") return "restart"
  if (value === "forceStop") return "stop"
  if (["start", "stop", "restart", "shutdown"].includes(value)) return value as VmAction
  throw actionError("Unsupported VM action", 400, "INVALID_ACTION")
}

function managedVpsWhere(customerId?: string) {
  return {
    deletedAt: null,
    status: { not: "DELETED" },
    vmid: { gt: 0 },
    ownershipStatus: { notIn: ["external", "manual", "rejected"] },
    ...(customerId ? { customerId } : {}),
  }
}

export async function resolveVmActionTargetByNode(input: { node: string; vmid: number; customerId?: string }) {
  if (!input.node.trim()) throw actionError("Node is required", 400, "NODE_REQUIRED")
  if (!Number.isInteger(input.vmid) || input.vmid <= 0) throw actionError("Valid VMID is required", 400, "VMID_INVALID")

  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true, OR: [{ id: input.node }, { nodeName: input.node }] },
    select: { id: true },
  })
  if (!nodes.length) throw actionError("Managed VM not found", 404, "VM_NOT_FOUND")

  const rows = await prisma.vpsInstance.findMany({
    where: { ...managedVpsWhere(input.customerId), vmid: input.vmid, proxmoxNodeId: { in: nodes.map((node) => node.id) } },
    include: { proxmoxNode: true },
    take: 2,
  })
  if (!rows.length) throw actionError("Managed VM not found", 404, "VM_NOT_FOUND")
  if (rows.length > 1) throw actionError("Node name matches more than one managed VM; use the Proxmox node ID", 409, "NODE_AMBIGUOUS")
  if (!rows[0].proxmoxNode?.isActive) throw actionError("Managed VM not found", 404, "VM_NOT_FOUND")
  return rows[0]
}

export async function resolveVmActionTargetByVps(input: { vpsId: string; customerId?: string }) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { ...managedVpsWhere(input.customerId), OR: [{ id: input.vpsId }, { orderId: input.vpsId }] },
    include: { proxmoxNode: true },
  })
  if (!vps?.proxmoxNode || !vps.proxmoxNode.isActive || !vps.vmid) {
    throw actionError("Managed VM not found", 404, "VM_NOT_FOUND")
  }
  return vps
}

export async function enqueueVmAction(input: { vps: any; action: string; actor: VmActionActor; requestId?: string }) {
  const action = canonicalAction(input.action)
  const vps = input.vps
  const dedupeKey = `vm-action:${vps.proxmoxNodeId}:${vps.vmid}`
  const existing = await (prisma as any).vmActionJob.findFirst({ where: { dedupeKey, status: { in: ACTIVE } } })
  if (existing) {
    if (existing.action !== action) throw actionError("Another VM action is already running", 409, "ACTION_IN_PROGRESS")
    return { job: existing, duplicate: true }
  }

  const reqId = input.requestId || requestId("vm_action")
  let job: any
  try {
    job = await (prisma as any).vmActionJob.create({
      data: {
        vpsInstanceId: vps.id,
        customerId: vps.customerId,
        proxmoxNodeId: vps.proxmoxNodeId,
        nodeName: vps.proxmoxNode.nodeName,
        vmid: vps.vmid,
        action,
        dedupeKey,
        requestId: reqId,
        requestedBy: input.actor.requestedBy,
        requestedRole: input.actor.requestedRole,
      },
    })
  } catch (error: any) {
    if (error?.code !== "P2002") throw error
    job = await (prisma as any).vmActionJob.findFirst({ where: { dedupeKey, status: { in: ACTIVE } } })
    if (!job || job.action !== action) throw actionError("Another VM action is already running", 409, "ACTION_IN_PROGRESS")
    return { job, duplicate: true }
  }

  await Promise.all([
    writeStructuredLog("vm-actions", "queued", {
      requestId: reqId, jobId: job.id, api: "vm-action", result: "queued", action,
      orderId: vps.orderId, customerId: vps.customerId, vpsInstanceId: vps.id,
      proxmoxNodeId: vps.proxmoxNodeId, node: vps.proxmoxNode.nodeName, vmid: vps.vmid,
    }),
    createPanelLog({
      category: "SYSTEM", message: `vps_${action}_queued`, actorType: input.actor.requestedRole,
      actorId: input.actor.requestedBy, customerId: vps.customerId, orderId: vps.orderId,
      vpsInstanceId: vps.id, vmid: vps.vmid, metadata: { jobId: job.id, requestId: reqId, action },
    }).catch(() => null),
  ])
  return { job, duplicate: false }
}

export function serializeVmActionJob(job: any) {
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    action: job.action,
    node: job.proxmoxNodeId,
    nodeName: job.nodeName,
    vmid: job.vmid,
    requestId: job.requestId,
    taskId: job.latestUpid || null,
    result: job.result || {},
    errorCode: job.errorCode || null,
    error: job.error || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  }
}

export async function claimNextVmActionJob(workerId = `${os.hostname()}:${process.pid}`) {
  const now = new Date()
  const candidate = await (prisma as any).vmActionJob.findFirst({
    where: { OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }] },
    orderBy: { createdAt: "asc" },
  })
  if (!candidate) return null
  const claimed = await (prisma as any).vmActionJob.updateMany({
    where: {
      id: candidate.id,
      OR: [{ status: "queued" }, { status: "running", leaseExpiresAt: { lt: now } }],
    },
    data: {
      status: "running", progress: 10, leaseOwner: workerId, claimedAt: now, heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS), startedAt: candidate.startedAt || now,
      attempts: { increment: 1 }, error: null, errorCode: null,
    },
  })
  if (!claimed.count) return null
  return (prisma as any).vmActionJob.findUnique({ where: { id: candidate.id }, include: { proxmoxNode: true, vpsInstance: true } })
}

function alreadyComplete(error: any, action: VmAction) {
  const text = String(error?.proxmoxMessage || error?.message || error || "").toLowerCase()
  return action === "start" ? /already running|vm is running/.test(text) : /already stopped|not running|vm is stopped/.test(text)
}

export async function executeVmActionJob(job: any) {
  const startedAt = Date.now()
  try {
    if (!job?.vpsInstance) throw actionError("VM action job is missing its VPS record", 404, "VM_ACTION_VPS_MISSING")
    if (!job?.proxmoxNode) throw actionError("VM action job is missing its Proxmox node", 503, "VM_ACTION_NODE_MISSING")
    const client = createProxmoxClient(job.proxmoxNode.host, job.proxmoxNode.tokenId, job.proxmoxNode.tokenSecret, {
      allowInsecureTls: job.proxmoxNode.allowInsecureTls,
      timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
    })
    await (prisma as any).vmActionJob.update({ where: { id: job.id }, data: { progress: 30, heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
    let response: any
    try {
      if (job.action === "start") {
        const runtime = await client.getVMStatus(job.nodeName, job.vmid).catch(() => null)
        response = String(runtime?.status || "").toLowerCase() === "running"
          ? { alreadyComplete: true, runtimeStatus: "running" }
          : await client.startVM(job.nodeName, job.vmid)
      }
      if (job.action === "stop") response = await robustlyStopVm({ client, node: job.nodeName, vmid: job.vmid, graceful: false, sshUsername: job.proxmoxNode.sshUsername })
      if (job.action === "shutdown") response = await robustlyStopVm({ client, node: job.nodeName, vmid: job.vmid, graceful: true, sshUsername: job.proxmoxNode.sshUsername })
      if (job.action === "restart") response = await robustlyRebootVm({ client, node: job.nodeName, vmid: job.vmid })
    } catch (error) {
      if (!alreadyComplete(error, job.action)) throw error
      response = { alreadyComplete: true }
    }
    const upid = extractUpid(response)
    if (upid) {
      await (prisma as any).vmActionJob.update({ where: { id: job.id }, data: { latestUpid: upid, progress: 65, heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      await client.waitForTask(job.nodeName, upid, 120_000)
    }
    const runtime = await client.getVMStatus(job.nodeName, job.vmid).catch(() => null)
    const runtimeStatus = String(runtime?.status || (job.action === "start" || job.action === "restart" ? "running" : "stopped")).toLowerCase()
    const dbStatus = runtimeStatus === "running" ? "ACTIVE" : runtimeStatus === "stopped" ? "STOPPED" : String(job.vpsInstance.status || "UNKNOWN")
    await prisma.vpsInstance.update({ where: { id: job.vpsInstanceId }, data: { status: dbStatus } }).catch(() => null)
    const result = { ok: true, runtimeStatus, status: dbStatus, upid: upid || null, response }
    const completed = await (prisma as any).vmActionJob.update({
      where: { id: job.id },
      data: { status: "completed", progress: 100, result, completedAt: new Date(), dedupeKey: null, leaseOwner: null, leaseExpiresAt: null },
    })
    await Promise.all([
      publishLiveVmSnapshot(job.vpsInstanceId, `vm-action:${job.action}:completed`).catch(() => null),
      writeStructuredLog("vm-actions", "completed", {
        requestId: job.requestId, jobId: job.id, api: "vm-action-worker", durationMs: Date.now() - startedAt,
        result: "completed", action: job.action, orderId: job.vpsInstance.orderId, customerId: job.customerId,
        vpsInstanceId: job.vpsInstanceId, proxmoxNodeId: job.proxmoxNodeId, node: job.nodeName, vmid: job.vmid,
      }),
      createAuditLog({
        action: `VM_${String(job.action).toUpperCase()}_COMPLETED`, actorEmail: job.requestedBy,
        customerId: job.customerId, targetType: "vps_instance", targetId: job.vpsInstanceId,
        newValue: result, metadata: { jobId: job.id, requestId: job.requestId, node: job.nodeName, vmid: job.vmid },
      }).catch(() => null),
    ])
    return completed
  } catch (error: any) {
    const failed = await (prisma as any).vmActionJob.update({
      where: { id: job.id },
      data: {
        status: "failed", errorCode: error?.code || "ACTION_FAILED", error: error?.message || String(error),
        completedAt: new Date(), dedupeKey: null, leaseOwner: null, leaseExpiresAt: null,
      },
    })
    await writeStructuredLog("vm-actions", "failed", {
      requestId: job.requestId, jobId: job.id, api: "vm-action-worker", durationMs: Date.now() - startedAt,
      result: "failed", action: job.action, customerId: job.customerId, vpsInstanceId: job.vpsInstanceId,
      proxmoxNodeId: job.proxmoxNodeId, node: job.nodeName, vmid: job.vmid, error,
    })
    return failed
  }
}
