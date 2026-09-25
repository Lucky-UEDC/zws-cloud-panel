import { prisma } from "@/lib/db"
import { createAuditLog } from "@/lib/audit-log"
import { createPanelLog } from "@/lib/panel-log"
import { createProxmoxClient, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { robustlyStopVm } from "@/lib/vm-power-control"

type VmDeletionStatus = "delete_requested" | "delete_pending" | "deleted" | "delete_failed"
export type VmDeleteMode = "delete_vm"

function deletionModel() {
  return (prisma as any).vmDeletionJob
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function isMissingVmError(error: any) {
  const message = String(error?.message || error || "").toLowerCase()
  const status = Number(error?.status || error?.httpStatus || error?.details?.httpStatus || 0)
  return status === 404 || message.includes("does not exist") || message.includes("not found") || message.includes("endpoint not found")
}

function isLockedVmError(error: any) {
  const message = String(error?.message || error || "").toLowerCase()
  return message.includes("lock") || message.includes("locked")
}

function sanitizeDiagnostic(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/PVEAPIToken=[^\s"']+/gi, "PVEAPIToken=[redacted]")
      .replace(/([?&](?:ticket|password|token|secret)=)[^&\s"']+/gi, "$1[redacted]")
      .slice(0, 2000)
  }
  if (Array.isArray(value)) return value.map(sanitizeDiagnostic)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/password|secret|token|ticket|cookie/i.test(key)) return [key, "[redacted]"]
      return [key, sanitizeDiagnostic(item)]
    }))
  }
  return value
}

function parseVmDisks(config: Record<string, any> | null | undefined) {
  const diskKey = /^(ide|sata|scsi|virtio)\d+$|^(efidisk|tpmstate)\d*$/i
  return Object.entries(config || {})
    .filter(([key, value]) => diskKey.test(key) && typeof value === "string")
    .map(([key, raw]) => {
      const value = String(raw)
      const volume = value.split(",")[0] || value
      const storage = volume.includes(":") ? volume.split(":")[0] : null
      return {
        key,
        volume,
        storage,
        raw: value,
        cloudInit: value.toLowerCase().includes("cloudinit"),
      }
    })
}

async function collectProxmoxDeletePreflight(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number) {
  const [runtime, config, snapshots, firewallRules] = await Promise.all([
    client.getVMStatus(nodeName, vmid).catch((error: any) => {
      if (isMissingVmError(error)) return null
      throw error
    }),
    client.getVMConfig(nodeName, vmid).catch((error: any) => {
      if (isMissingVmError(error)) return null
      throw error
    }),
    (client as any).getVMSnapshots(nodeName, vmid).catch(() => []),
    (client as any).getVMFirewallRules(nodeName, vmid).catch(() => []),
  ])
  const disks = parseVmDisks(config)
  return {
    exists: Boolean(runtime || config),
    runtime,
    config,
    disks,
    cloudInitDisks: disks.filter((disk) => disk.cloudInit),
    snapshots: Array.isArray(snapshots) ? snapshots.filter((item: any) => String(item?.name || "").toLowerCase() !== "current") : [],
    firewallRules: Array.isArray(firewallRules) ? firewallRules : [],
  }
}

function extractUpid(result: any) {
  if (typeof result === "string") return result.includes("UPID") ? result : null
  if (typeof result?.data === "string") return result.data.includes("UPID") ? result.data : null
  if (typeof result?.upid === "string") return result.upid
  return null
}

function nextRetry(attempts: number) {
  const minutes = Math.min(60, Math.max(2, 2 ** Math.max(0, attempts - 1)))
  return new Date(Date.now() + minutes * 60_000)
}

async function markStep(job: any, name: string, status: "started" | "completed" | "skipped" | "failed", detail: Record<string, unknown> = {}) {
  const step = { name, status, at: new Date().toISOString(), ...detail }
  const steps = [...asArray(job.steps), step]
  return deletionModel().update({ where: { id: job.id }, data: { steps } })
}

async function loadVps(vpsId: string) {
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id: vpsId }, { orderId: vpsId }] },
    include: {
      order: true,
      customer: { select: { id: true, email: true } },
      proxmoxNode: true,
      provisioningJobs: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  })
  if (!vps) throw new Error("VM not found")
  return vps
}

async function updateLifecycle(vps: Awaited<ReturnType<typeof loadVps>>, status: VmDeletionStatus, metadata: Record<string, unknown> = {}) {
  const now = new Date()
  const lifecycleMetadata = {
    ...asObject(vps.lifecycleMetadata),
    deletion: {
      ...asObject(asObject(vps.lifecycleMetadata).deletion),
      status,
      updatedAt: now.toISOString(),
      ...metadata,
    },
  }
  await prisma.vpsInstance.update({
    where: { id: vps.id },
    data: {
      status,
      lifecycleMetadata: lifecycleMetadata as any,
      ...(status === "deleted" ? { deletedAt: now, deletionAt: now, ipAddress: null, autoSuspendEnabled: false, autoDeleteEnabled: false } : {}),
    },
  })
  await prisma.order.update({
    where: { id: vps.orderId },
    data: {
      provisioningStatus: status,
      ...(status === "deleted" ? { status: "DELETED", deletedAt: now, isActive: false, provisioningError: null } : {}),
      ...(status === "delete_requested" || status === "delete_pending" || status === "delete_failed" ? {
        status: "DELETION_PENDING",
        deletedAt: vps.order.deletedAt || now,
        isActive: false,
        provisioningError: status === "delete_requested" ? null : String(metadata.error || "VM deletion is pending retry"),
      } : {}),
    },
  }).catch(() => undefined)
}


async function cleanupDatabaseState(vps: Awaited<ReturnType<typeof loadVps>>) {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const allocations = await tx.ipAllocation.findMany({ where: { vpsInstanceId: vps.id } })
    await tx.ipAllocation.updateMany({
      where: { vpsInstanceId: vps.id },
      data: {
        status: "free",
        vpsInstanceId: null,
        vmid: null,
        hostname: null,
        allocationLockKey: null,
        releasedAt: now,
      },
    })
    for (const allocation of allocations) {
      await tx.auditEvent.create({
        data: {
          eventType: "Released From VM",
          severity: "INFO",
          actorType: "SYSTEM",
          targetType: "ip_allocation",
          targetId: allocation.id,
          vpsInstanceId: vps.id,
          vmid: allocation.vmid || vps.vmid,
          nodeId: allocation.nodeId || vps.proxmoxNodeId || null,
          oldValue: { ipAddress: allocation.ipAddress, poolId: allocation.poolId, vmid: allocation.vmid },
          newValue: { status: "Available" },
        },
      }).catch(() => undefined as any)
    }
    await tx.vmIpAssignment.updateMany({
      where: { vpsInstanceId: vps.id },
      data: { status: "released", detachedAt: now },
    })
    await (tx as any).vpsDisk.updateMany({
      where: { vpsId: vps.id, status: { not: "DELETED" } },
      data: { status: "DELETED" },
    }).catch(() => undefined)
    await tx.vmNetworkInterface.updateMany({
      where: { vpsInstanceId: vps.id },
      data: { metadata: { deletedAt: now.toISOString(), source: "vm_delete_cleanup" } as any },
    }).catch(() => undefined)
    await tx.provisioningJob.updateMany({
      where: {
        OR: [{ vpsInstanceId: vps.id }, { orderId: vps.orderId }],
        status: { in: ["queued", "running", "retrying", "waiting_for_admin", "failed"] },
      },
      data: {
        status: "failed",
        displayStatus: "Cancelled by VM deletion",
        currentStep: "VM_DELETE",
        completedAt: now,
        error: "Cancelled by VM deletion workflow",
      },
    })
    await tx.vmNetworkEvent.create({
      data: {
        vpsInstanceId: vps.id,
        proxmoxNodeId: vps.proxmoxNodeId,
        vmid: vps.vmid,
        eventType: "vm_delete_cleanup",
        status: "completed",
        stage: "cleanup",
        actorEmail: null,
        result: { releasedIp: Boolean(vps.ipAddress), cleanedAt: now.toISOString() } as any,
      },
    }).catch(() => undefined)
    await tx.vpsInstance.update({
      where: { id: vps.id },
      data: {
        status: "deleted",
        deletedAt: now,
        deletionAt: now,
        ipAddress: null,
        autoSuspendEnabled: false,
        autoDeleteEnabled: false,
        consoleEnabled: false,
        lifecycleMetadata: {
          ...asObject(vps.lifecycleMetadata),
          deletion: {
            ...asObject(asObject(vps.lifecycleMetadata).deletion),
            status: "deleted",
            dbCleanupAt: now.toISOString(),
            syncCacheUpdatedAt: now.toISOString(),
          },
        } as any,
      },
    })
    await tx.order.update({
      where: { id: vps.orderId },
      data: { status: "DELETED", provisioningStatus: "deleted", provisioningError: null, deletedAt: now, isActive: false },
    }).catch(() => undefined)
  })
}

export async function getVmDeletionPreflight(vpsId: string) {
  const vps = await loadVps(vpsId)
  if (!vps.proxmoxNode || !vps.vmid) {
    return {
      vmid: vps.vmid,
      node: null,
      exists: false,
      runtimeStatus: null,
      disks: [],
      cloudInitDisks: [],
      snapshotsCount: 0,
      firewallRulesCount: 0,
      backupWarning: "No Proxmox node or VMID is linked. Only panel cleanup can run.",
    }
  }
  const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
  })
  const preflight = await collectProxmoxDeletePreflight(client, vps.proxmoxNode.nodeName, vps.vmid)
  return {
    vmid: vps.vmid,
    node: vps.proxmoxNode.nodeName,
    exists: preflight.exists,
    runtimeStatus: preflight.runtime?.status || null,
    disks: preflight.disks,
    cloudInitDisks: preflight.cloudInitDisks,
    snapshotsCount: preflight.snapshots.length,
    firewallRulesCount: preflight.firewallRules.length,
    backupWarning: "Destroying a VM does not remove external backup archives. Confirm backup retention separately.",
  }
}

export async function requestVmDeletion(input: { vpsId: string; actorEmail: string; reason?: string | null; mode?: VmDeleteMode }) {
  const vps = await loadVps(input.vpsId)
  const mode = input.mode || "delete_vm"
  if (mode !== "delete_vm") throw new Error("Unsupported VM delete mode")
  const existing = await deletionModel().findFirst({
    where: {
      vpsInstanceId: vps.id,
      status: { in: ["delete_requested", "delete_pending"] },
    },
    orderBy: { createdAt: "desc" },
  })
  const job = existing
    ? await deletionModel().update({
        where: { id: existing.id },
        data: {
          status: "delete_requested",
          requestedBy: input.actorEmail,
          nextRetryAt: null,
          metadata: { ...asObject(existing.metadata), mode, reason: input.reason || null } as any,
        },
      })
    : await deletionModel().create({
        data: {
          vpsInstanceId: vps.id,
          orderId: vps.orderId,
          customerId: vps.customerId,
          proxmoxNodeId: vps.proxmoxNodeId,
          vmid: vps.vmid,
          status: "delete_requested",
          requestedBy: input.actorEmail,
          metadata: { mode, reason: input.reason || null } as any,
        },
      })

  await updateLifecycle(vps, "delete_requested", { jobId: job.id, requestedBy: input.actorEmail, mode, reason: input.reason || null })
  await createPanelLog({
    category: "Provisioning",
    message: "vm_delete_requested",
    actorType: "admin",
    actorEmail: input.actorEmail,
    customerId: vps.customerId,
    orderId: vps.orderId,
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    metadata: { jobId: job.id, mode, reason: input.reason || null },
  }).catch(() => null)

  return processVmDeletionJob(job.id, input.actorEmail)
}

export async function processVmDeletionJob(jobId: string, actorEmail = "system") {
  let job = await deletionModel().findUnique({ where: { id: jobId } })
  if (!job) throw new Error("VM deletion job not found")
  const vps = await loadVps(job.vpsInstanceId)
  const metadata = asObject(job.metadata)
  const mode = String(metadata.mode || "delete_vm") as VmDeleteMode
  const destroyDisks = true
  await updateLifecycle(vps, "delete_pending", { jobId: job.id })
  job = await markStep(job, "load_vm", "completed", { vpsId: vps.id, vmid: vps.vmid })

  try {
    if (vps.proxmoxNode && vps.vmid) {
      const nodeName = vps.proxmoxNode.nodeName
      const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
        timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
      })

      job = await markStep(job, "proxmox_preflight", "started", { node: nodeName, vmid: vps.vmid, mode })
      const preflight = await collectProxmoxDeletePreflight(client, nodeName, vps.vmid)
      job = await markStep(job, "proxmox_preflight", preflight.exists ? "completed" : "skipped", sanitizeDiagnostic({
        exists: preflight.exists,
        state: preflight.runtime?.status || null,
        disks: preflight.disks,
        snapshotsCount: preflight.snapshots.length,
        firewallRulesCount: preflight.firewallRules.length,
      }) as Record<string, unknown>)

      if (preflight.exists) {
        const powerState = String(preflight.runtime?.status || "").toLowerCase()
        if (powerState && powerState !== "stopped") {
          job = await markStep(job, "force_stop_vm", "started", { state: powerState, skiplock: true })
          const stopResult = await robustlyStopVm({ client, node: nodeName, vmid: vps.vmid, sshUsername: (vps as any).proxmoxNode?.sshUsername })
          if (!stopResult.stopped) throw new Error(`Unable to force stop VM before deletion (last tier: ${stopResult.via})`)
          job = await markStep(job, "force_stop_vm", "completed", { via: stopResult.via })
        }

        await client.unlockVM(nodeName, vps.vmid).catch(() => undefined)
        if (preflight.snapshots.length) {
          job = await markStep(job, "remove_snapshots", "started", { count: preflight.snapshots.length })
          for (const snapshot of preflight.snapshots) {
            const name = String(snapshot?.name || "")
            if (name) await (client as any).deleteVMSnapshot(nodeName, vps.vmid, name).catch(() => undefined)
          }
          job = await markStep(job, "remove_snapshots", "completed", { count: preflight.snapshots.length })
        } else {
          job = await markStep(job, "remove_snapshots", "skipped", { count: 0 })
        }
        if (preflight.firewallRules.length) {
          job = await markStep(job, "remove_firewall_rules", "started", { count: preflight.firewallRules.length })
          for (const rule of preflight.firewallRules) {
            const pos = rule?.pos ?? rule?.digest ?? null
            if (pos !== null) await (client as any).deleteVMFirewallRule(nodeName, vps.vmid, pos).catch(() => undefined)
          }
          job = await markStep(job, "remove_firewall_rules", "completed", { count: preflight.firewallRules.length })
        } else {
          job = await markStep(job, "remove_firewall_rules", "skipped", { count: 0 })
        }
        job = await markStep(job, "destroy_vm", "started", { purge: true, destroyUnreferencedDisks: destroyDisks })
        const deleted = await client.deleteVM(nodeName, vps.vmid, { purge: true, destroyUnreferencedDisks: destroyDisks })
        const deleteUpid = extractUpid(deleted)
        if (deleteUpid) await client.waitForTask(nodeName, deleteUpid, 300_000)
        job = await markStep(job, "destroy_vm", "completed", { upid: deleteUpid })

        job = await markStep(job, "verify_proxmox_removed", "started")
        const [runtimeAfter, configAfter, listedAfter] = await Promise.all([
          client.getVMStatus(nodeName, vps.vmid).then(() => true).catch((error: any) => isMissingVmError(error) ? false : Promise.reject(error)),
          client.getVMConfig(nodeName, vps.vmid).then(() => true).catch((error: any) => isMissingVmError(error) ? false : Promise.reject(error)),
          client.getVMList(nodeName).then((rows) => rows.some((row: any) => Number(row?.vmid) === Number(vps.vmid))).catch(() => false),
        ])
        if (runtimeAfter || configAfter || listedAfter) throw new Error("Proxmox delete verification failed: VM is still visible after destroy")
        job = await markStep(job, "verify_proxmox_removed", "completed", { runtimeAfter, configAfter, listedAfter })
      }
    } else {
      job = await markStep(job, "verify_proxmox_exists", "skipped", { reason: "missing_node_or_vmid" })
    }

    job = await markStep(job, "release_ip_and_cancel_jobs", "started")
    await cleanupDatabaseState(vps)
    job = await markStep(job, "release_ip_and_cancel_jobs", "completed")
    job = await markStep(job, "remove_backups_monitoring_renewals", "completed", {
      backups: "no_vm_backup_model_configured",
      monitoring: "network_events_closed",
      renewals: "auto_lifecycle_disabled",
    })
    const activeDbVm = await prisma.vpsInstance.findFirst({ where: { id: vps.id, deletedAt: null } }).catch(() => null)
    if (activeDbVm) throw new Error("Database delete verification failed: VM remains active")
    job = await markStep(job, "verify_database_removed", "completed", { active: false })

    const completed = await deletionModel().update({
      where: { id: job.id },
      data: { status: "deleted", completedAt: new Date(), lastError: null, nextRetryAt: null },
    })
    await createPanelLog({
      category: "Provisioning",
      message: "vm_delete_completed",
      actorType: actorEmail === "system" ? "system" : "admin",
      actorEmail,
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: { jobId: job.id, mode },
    }).catch(() => null)
    await createAuditLog({
      action: "VM_DELETE_COMPLETED",
      actorEmail,
      customerId: vps.customerId,
      targetType: "vps_instance",
      targetId: vps.id,
      oldValue: { status: vps.status, vmid: vps.vmid },
      newValue: { status: "deleted" },
      metadata: { jobId: job.id, mode },
    }).catch(() => null)
    return { success: true, status: "deleted", jobId: completed.id, attempts: completed.attempts }
  } catch (error: any) {
    const attempts = Number(job.attempts || 0) + 1
    const pending = attempts < Number(job.maxAttempts || 5)
    const status: VmDeletionStatus = pending ? "delete_pending" : "delete_failed"
    const message = String(error?.message || "VM deletion failed")
    if (isLockedVmError(error) && vps.proxmoxNode && vps.vmid) {
      const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
        timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
      })
      await client.unlockVM(vps.proxmoxNode.nodeName, vps.vmid).catch(() => undefined)
    }
    job = await markStep(job, "delete_workflow", "failed", { error: message })
    const updated = await deletionModel().update({
      where: { id: job.id },
      data: {
        status,
        attempts,
        nextRetryAt: pending ? nextRetry(attempts) : null,
        lastError: message,
      },
    })
    await updateLifecycle(vps, status, { jobId: job.id, error: message, attempts })
    await createPanelLog({
      level: pending ? "warn" : "error",
      category: "Provisioning",
      message: pending ? "vm_delete_pending_retry" : "vm_delete_failed",
      actorType: actorEmail === "system" ? "system" : "admin",
      actorEmail,
      customerId: vps.customerId,
      orderId: vps.orderId,
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      metadata: sanitizeDiagnostic({ jobId: job.id, attempts, nextRetryAt: updated.nextRetryAt, error: message, mode }) as any,
    }).catch(() => null)
    return {
      success: false,
      status,
      jobId: job.id,
      attempts,
      nextRetryAt: updated.nextRetryAt,
      error: message,
    }
  }
}

export async function retryPendingVmDeletion(input: { vpsId: string; actorEmail: string }) {
  const vps = await loadVps(input.vpsId)
  const job = await deletionModel().findFirst({
    where: { vpsInstanceId: vps.id, status: { in: ["delete_pending", "delete_failed", "delete_requested"] } },
    orderBy: { createdAt: "desc" },
  })
  if (!job) throw new Error("No VM deletion retry job exists")
  await deletionModel().update({ where: { id: job.id }, data: { status: "delete_requested", nextRetryAt: null, lastError: null } })
  return processVmDeletionJob(job.id, input.actorEmail)
}
