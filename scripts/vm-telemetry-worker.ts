import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_METRICS_TIMEOUT_MS } from "@/lib/proxmox"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"
import { recordBandwidthSample } from "@/lib/bandwidth-accounting"
import { applyBandwidthThrottle } from "@/lib/bandwidth-enforcement"
import { vmIdentityNotesMatch, vmIdentityTagsMatch } from "@/lib/proxmox-tags"
import { configuredMemoryBytes } from "@/lib/vm-guest-disk"
import { backoffState, collectTemplateDiskUsage, runBounded, TELEMETRY_CONCURRENCY, type TelemetryDiskResult } from "@/lib/guest-automation/telemetry"
import { runRetentionPass } from "@/lib/guest-automation/retention"
import { resolveVmGuestOs, type VmGuestOsKind } from "@/lib/vm-os-detection"
import { dbStatusFromPowerState } from "@/lib/vm-runtime-status"

const POLL_MS = Math.max(30_000, Number(process.env.VM_TELEMETRY_POLL_MS || 30_000))
// Running VMs get a ~30s disk collection cadence (locked per VM so overlapping
// ticks never double-exec a guest command). Failures back off before retrying.
const DISK_CHECK_MS = Math.max(30_000, Number(process.env.VM_DISK_USAGE_CHECK_MS || 30_000))
// The per-VM failure backoff moved into the collector, which is where the
// guarantee belongs: the worker, an admin refresh and a customer page refresh
// all call the same code and must all get "one collection per VM at a time".
const CONCURRENCY = TELEMETRY_CONCURRENCY
const OWNERSHIP_VERIFY_MS = Math.max(60_000, Number(process.env.VM_OWNERSHIP_VERIFY_MS || 10 * 60_000))
const ONCE = process.argv.includes("--once")
const FORCE_DISK = process.argv.includes("--force-disk")
/** Retention runs on its own cadence, not on every thirty-second collection. */
const RETENTION_ONLY = process.argv.includes("--retention")
const RETENTION_DRY_RUN = process.argv.includes("--retention-dry-run")
const RETENTION_MS = Math.max(60 * 60_000, Number(process.env.VM_METRIC_RETENTION_MS || 6 * 60 * 60_000))

let stopping = false

// The per-VM in-flight guard and the failure backoff both live in
// lib/guest-automation/telemetry.ts, not here.

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}

function gbToBytes(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1_000_000_000) : 0
}

function diskSnapshotFromMetric(metric: any) {
  const usedBytes = Math.max(0, Math.floor(numberValue(metric?.diskUsedBytes)))
  const totalBytes = Math.max(0, Math.floor(numberValue(metric?.diskTotalBytes)))
  const freeBytes = Math.max(0, Math.floor(numberValue(metric?.diskFreeBytes) || Math.max(0, totalBytes - usedBytes)))
  if (usedBytes <= 0 || totalBytes <= 0) return null
  return { usedBytes, totalBytes, freeBytes }
}

function diskSnapshotFromVps(vps: any) {
  const usedBytes = gbToBytes(vps.diskUsedGb)
  const totalBytes = gbToBytes(vps.diskTotalGb)
  if (usedBytes <= 0 || totalBytes <= 0) return null
  return { usedBytes, totalBytes, freeBytes: Math.max(0, totalBytes - usedBytes) }
}

function vmOsKindFromVps(vps: any): VmGuestOsKind {
  return resolveVmGuestOs({
    osType: vps?.operatingSystem?.osType,
    osFamily: vps?.operatingSystem?.osFamily,
    category: vps?.operatingSystem?.category,
    osName: vps?.operatingSystem?.name,
    vmOsFamily: vps?.vmOsFamily,
    orderOsName: vps?.order?.osName,
  })
}

function shouldCollect(vps: any) {
  const status = String(vps.status || "").toLowerCase()
  const ownershipStatus = String(vps.ownershipStatus || "panel_owned").toLowerCase()
  const source = String(vps.provisioningSource || "panel").toLowerCase()
  return !vps.deletedAt &&
    !["deleted", "deleting", "terminated"].includes(status) &&
    ["panel", "zws", "linked", "imported", "manual_delivery"].includes(source) &&
    !["external", "manual", "rejected"].includes(ownershipStatus)
}

function serializeMetric(row: any, runtime: any, os?: VmGuestOsKind | null) {
  const ramUsedBytes = Number(row.ramUsedBytes || 0)
  const ramTotalBytes = Number(row.ramTotalBytes || 0)
  const diskUsedBytes = Number(row.diskUsedBytes || 0)
  const diskTotalBytes = Number(row.diskTotalBytes || 0)
  const diskFreeBytes = Number(row.diskFreeBytes || 0)
  return {
    id: row.id,
    recordedAt: row.recordedAt?.toISOString ? row.recordedAt.toISOString() : row.recordedAt,
    runtimeStatus: row.runtimeStatus || null,
    cpuPercent: Number(row.cpuPercent || 0),
    ramUsedBytes,
    ramTotalBytes,
    ramPercent: percent(ramUsedBytes, ramTotalBytes),
    diskUsedBytes,
    diskTotalBytes,
    diskFreeBytes,
    diskPercent: percent(diskUsedBytes, diskTotalBytes),
    diskReadBytes: Number(row.diskReadBytes || 0),
    diskWriteBytes: Number(row.diskWriteBytes || 0),
    networkInBytes: Number(row.networkInBytes || 0),
    networkOutBytes: Number(row.networkOutBytes || 0),
    uptimeSeconds: Number(runtime?.uptime || 0),
    source: "vm-telemetry-worker",
    os: os || null,
  }
}

async function upsertDatabaseFirstCaches(input: {
  vps: any
  runtime: any
  metric: any
  runtimeStatus: string
  rxDelta: number
  txDelta: number
  rxRateBps: number
  txRateBps: number
  now: Date
}) {
  const staleAfter = new Date(input.now.getTime() + Math.max(POLL_MS * 3, 60_000))
  const runtimeStatus = input.runtimeStatus || String(input.runtime?.status || "unknown")
  const powerState = runtimeStatus.toLowerCase() === "running" ? "running" : runtimeStatus.toLowerCase() === "stopped" ? "stopped" : runtimeStatus.toLowerCase()
  const status = dbStatusFromPowerState(powerState, input.vps.status || "UNKNOWN")
  const bandwidthTotal = BigInt(Math.max(0, Math.floor(input.rxDelta + input.txDelta)))

  await Promise.all([
    (prisma as any).vmRuntime.upsert({
      where: { vpsInstanceId: input.vps.id },
      create: {
        vpsInstanceId: input.vps.id,
        customerId: input.vps.customerId,
        orderId: input.vps.orderId,
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid,
        hostname: input.vps.name,
        status,
        runtimeStatus,
        powerState,
        cpuCores: input.vps.cpuCores || input.vps.product?.cpuCores || null,
        ramGb: input.vps.ramGb || null,
        diskGb: input.vps.diskGb || null,
        bandwidthTb: input.vps.bandwidthTb || input.vps.product?.bandwidthTb || null,
        region: input.vps.proxmoxNode?.location || input.vps.serviceLocation || null,
        nodeName: input.vps.proxmoxNode?.nodeName || null,
        billingStatus: input.vps.order?.status || null,
        syncSource: "vm-telemetry-worker",
        lastSyncedAt: input.now,
        staleAfter,
        metadata: { sourceMetricId: input.metric.id },
      },
      update: {
        customerId: input.vps.customerId,
        orderId: input.vps.orderId,
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid,
        hostname: input.vps.name,
        status,
        runtimeStatus,
        powerState,
        cpuCores: input.vps.cpuCores || input.vps.product?.cpuCores || null,
        ramGb: input.vps.ramGb || null,
        diskGb: input.vps.diskGb || null,
        bandwidthTb: input.vps.bandwidthTb || input.vps.product?.bandwidthTb || null,
        region: input.vps.proxmoxNode?.location || input.vps.serviceLocation || null,
        nodeName: input.vps.proxmoxNode?.nodeName || null,
        billingStatus: input.vps.order?.status || null,
        syncSource: "vm-telemetry-worker",
        lastSyncedAt: input.now,
        staleAfter,
        metadata: { sourceMetricId: input.metric.id },
      },
    }),
    (prisma as any).vmMetricsCache.upsert({
      where: { vpsInstanceId: input.vps.id },
      create: {
        vpsInstanceId: input.vps.id,
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid,
        runtimeStatus,
        cpuPercent: Number(input.metric.cpuPercent || 0),
        ramUsedBytes: input.metric.ramUsedBytes,
        ramTotalBytes: input.metric.ramTotalBytes,
        diskUsedBytes: input.metric.diskUsedBytes,
        diskTotalBytes: input.metric.diskTotalBytes,
        diskFreeBytes: input.metric.diskFreeBytes || BigInt(0),
        diskReadBytes: input.metric.diskReadBytes,
        diskWriteBytes: input.metric.diskWriteBytes,
        networkInBytes: input.metric.networkInBytes,
        networkOutBytes: input.metric.networkOutBytes,
        rxRateBps: BigInt(input.rxRateBps),
        txRateBps: BigInt(input.txRateBps),
        uptimeSeconds: BigInt(Math.max(0, Math.floor(numberValue(input.runtime?.uptime)))),
        source: "vm-telemetry-worker",
        recordedAt: input.now,
        staleAfter,
        metadata: { sourceMetricId: input.metric.id, diskUsage: input.metric.metadata?.diskUsage || null },
      },
      update: {
        proxmoxNodeId: input.vps.proxmoxNodeId || null,
        vmid: input.vps.vmid,
        runtimeStatus,
        cpuPercent: Number(input.metric.cpuPercent || 0),
        ramUsedBytes: input.metric.ramUsedBytes,
        ramTotalBytes: input.metric.ramTotalBytes,
        diskUsedBytes: input.metric.diskUsedBytes,
        diskTotalBytes: input.metric.diskTotalBytes,
        diskFreeBytes: input.metric.diskFreeBytes || BigInt(0),
        diskReadBytes: input.metric.diskReadBytes,
        diskWriteBytes: input.metric.diskWriteBytes,
        networkInBytes: input.metric.networkInBytes,
        networkOutBytes: input.metric.networkOutBytes,
        rxRateBps: BigInt(input.rxRateBps),
        txRateBps: BigInt(input.txRateBps),
        uptimeSeconds: BigInt(Math.max(0, Math.floor(numberValue(input.runtime?.uptime)))),
        source: "vm-telemetry-worker",
        recordedAt: input.now,
        staleAfter,
        metadata: { sourceMetricId: input.metric.id, diskUsage: input.metric.metadata?.diskUsage || null },
      },
    }),
    (prisma as any).vmStateCache.upsert({
      where: { vpsInstanceId: input.vps.id },
      create: {
        vpsInstanceId: input.vps.id,
        status,
        runtimeStatus,
        powerState,
        syncStatus: "synced",
        syncSource: "vm-telemetry-worker",
        lastSyncedAt: input.now,
        staleAfter,
        databaseState: { status: input.vps.status, ipAddress: input.vps.ipAddress || null, vmid: input.vps.vmid },
        proxmoxState: { status: runtimeStatus, uptime: numberValue(input.runtime?.uptime) },
        metadata: { sourceMetricId: input.metric.id },
      },
      update: {
        status,
        runtimeStatus,
        powerState,
        syncStatus: "synced",
        syncSource: "vm-telemetry-worker",
        lastSyncedAt: input.now,
        staleAfter,
        lastError: null,
        databaseState: { status: input.vps.status, ipAddress: input.vps.ipAddress || null, vmid: input.vps.vmid },
        proxmoxState: { status: runtimeStatus, uptime: numberValue(input.runtime?.uptime) },
        metadata: { sourceMetricId: input.metric.id },
      },
    }),
    (input.rxDelta > 0 || input.txDelta > 0 || input.rxRateBps > 0 || input.txRateBps > 0)
      ? (prisma as any).vmBandwidthUsage.create({
          data: {
            vpsInstanceId: input.vps.id,
            customerId: input.vps.customerId,
            productId: input.vps.productId || null,
            proxmoxNodeId: input.vps.proxmoxNodeId || null,
            ipAddress: input.vps.ipAddress || null,
            vmid: input.vps.vmid,
            period: "sample",
            bucketAt: input.now,
            rxBytes: BigInt(input.rxDelta),
            txBytes: BigInt(input.txDelta),
            totalBytes: bandwidthTotal,
            rxRateBps: BigInt(input.rxRateBps),
            txRateBps: BigInt(input.txRateBps),
            peakRateBps: BigInt(Math.max(input.rxRateBps, input.txRateBps)),
            source: "vm-telemetry-worker",
            metadata: { sourceMetricId: input.metric.id },
          },
        })
      : Promise.resolve(null),
  ])
}

/**
 * The bounded queue.
 *
 * `runBounded` lives in the telemetry library rather than here so an admin
 * refresh and a customer page refresh share the same guarantee. The only local
 * concern is the shutdown flag: a tick interrupted mid-flight must stop pulling
 * new work, and the shared helper is not aware of a process-level signal.
 */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items]
  await runBounded(queue, limit, async (item) => {
    if (stopping) throw new Error("shutdown")
    await worker(item)
  }, {
    onError: (item, error) => {
      if (String((error as any)?.message || error) === "shutdown") return
      console.error("[vm-telemetry-worker] queue item failed", { message: (error as any)?.message || String(error) })
    },
  })
}

async function verifyOwnershipIfDue(vps: any, client: any) {
  const last = vps.ownershipVerifiedAt ? new Date(vps.ownershipVerifiedAt).getTime() : 0
  if (Date.now() - last < OWNERSHIP_VERIFY_MS) return null
  const config = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
  if (!config) {
    await prisma.vpsInstance.update({
      where: { id: vps.id },
      data: {
        ownershipStatus: "missing_on_node",
        ownershipEvidence: {
          checkedAt: new Date().toISOString(),
          nodeId: vps.proxmoxNodeId,
          vmid: vps.vmid,
          reason: "config_unavailable",
        },
      },
    }).catch(() => null)
    return null
  }

  const notes = vmIdentityNotesMatch((config as any).description, {
    orderId: vps.orderId,
    customerId: vps.customerId,
    vmUuid: vps.id,
  })
  const tags = vmIdentityTagsMatch((config as any).tags, {
    orderId: vps.orderId,
    customerId: vps.customerId,
  })
  const verified = notes.highConfidence || notes.mediumConfidence || tags.highConfidence || tags.mediumConfidence
  await prisma.vpsInstance.update({
    where: { id: vps.id },
    data: {
      ownershipStatus: verified ? "verified" : "unverified",
      ownershipVerifiedAt: verified ? new Date() : vps.ownershipVerifiedAt || null,
      ownershipEvidence: {
        checkedAt: new Date().toISOString(),
        nodeId: vps.proxmoxNodeId,
        nodeName: vps.proxmoxNode.nodeName,
        vmid: vps.vmid,
        notes: {
          orderMatch: notes.orderMatch,
          customerMatch: notes.customerMatch,
          vmUuidMatch: notes.vmUuidMatch,
          serviceMatch: notes.serviceMatch,
          highConfidence: notes.highConfidence,
          mediumConfidence: notes.mediumConfidence,
        },
        tags: {
          orderMatch: tags.orderMatch,
          customerMatch: tags.customerMatch,
          serviceMatch: tags.serviceMatch,
          highConfidence: tags.highConfidence,
          mediumConfidence: tags.mediumConfidence,
        },
      },
    },
  }).catch(() => null)
  return { verified, config }
}

async function collectVps(vps: any) {
  if (!vps.proxmoxNode) return
  const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    timeoutMs: PROXMOX_METRICS_TIMEOUT_MS,
  })
  const [runtime, config, previous, previousNonZeroDisk] = await Promise.all([
    client.getVMStatus(vps.proxmoxNode.nodeName, vps.vmid),
    client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null),
    (prisma as any).vpsMetric.findFirst({
      where: { vpsInstanceId: vps.id },
      orderBy: { recordedAt: "desc" },
    }).catch(() => null),
    (prisma as any).vpsMetric.findFirst({
      where: { vpsInstanceId: vps.id, diskUsedBytes: { gt: BigInt(0) }, diskTotalBytes: { gt: BigInt(0) } },
      orderBy: { recordedAt: "desc" },
    }).catch(() => null),
  ])

  const now = new Date()
  const runtimeStatus = String(runtime?.status || "unknown").toLowerCase()
  const configuredRamTotalBytes = configuredMemoryBytes(config, runtime?.maxmem)
  const vmOsKind = vmOsKindFromVps(vps)
  const lastDiskCheckAt = vps.diskUsageCheckedAt ? new Date(vps.diskUsageCheckedAt).getTime() : 0
  // The collector refuses while it is already running for this VM, and refuses
  // again while the VM is backing off. The worker only decides whether a pass
  // is due at all, from the last successful collection recorded on the server.
  const diskCheckDue = FORCE_DISK || !lastDiskCheckAt || now.getTime() - lastDiskCheckAt >= DISK_CHECK_MS
  const shouldCollectDisk = runtimeStatus === "running" && diskCheckDue
  let guestDisk: TelemetryDiskResult | null = null
  if (shouldCollectDisk) {
    // The collector resolves the OS template from the guest's own report and
    // runs whatever command that template declares. Correcting a command on one
    // OS family is now a database edit, not a build.
    guestDisk = await collectTemplateDiskUsage({
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      node: {
        nodeName: vps.proxmoxNode.nodeName,
        host: vps.proxmoxNode.host,
        tokenId: vps.proxmoxNode.tokenId,
        tokenSecret: vps.proxmoxNode.tokenSecret,
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      },
      force: FORCE_DISK,
    })
  }
  if (guestDisk && !guestDisk.ok) {
    console.warn("[vm-telemetry-worker] disk collection failed", {
      vpsId: vps.id,
      vmid: vps.vmid,
      os: guestDisk.os,
      errorCode: guestDisk.errorCode,
      error: guestDisk.error,
      collectionDurationMs: guestDisk.collectionDurationMs,
    })
  }
  const lastKnownDisk = diskSnapshotFromMetric(previousNonZeroDisk) || diskSnapshotFromVps(vps)
  const selectedDisk = guestDisk?.ok
    ? { usedBytes: guestDisk.usedBytes, totalBytes: guestDisk.totalBytes, freeBytes: guestDisk.freeBytes, source: guestDisk.source }
    : lastKnownDisk
      ? { ...lastKnownDisk, source: "last-known" }
      : { usedBytes: 0, totalBytes: 0, freeBytes: 0, source: "unavailable" }
  const diskUsedBytes = selectedDisk.usedBytes
  const diskTotalBytes = selectedDisk.totalBytes
  const diskFreeBytes = selectedDisk.freeBytes
  const stopped = runtimeStatus === "stopped"
  const cpuPercent = stopped && previous ? Number(previous.cpuPercent || 0) : Math.max(0, Math.min(100, numberValue(runtime?.cpu) * 100))
  const ramUsedBytes = stopped && previous ? Number(previous.ramUsedBytes || 0) : Math.max(0, Math.floor(numberValue(runtime?.mem)))
  const diskReadBytes = stopped && previous ? Number(previous.diskReadBytes || 0) : Math.max(0, Math.floor(numberValue(runtime?.diskread)))
  const diskWriteBytes = stopped && previous ? Number(previous.diskWriteBytes || 0) : Math.max(0, Math.floor(numberValue(runtime?.diskwrite)))
  const netIn = stopped && previous ? Math.max(0, Math.floor(numberValue(previous.networkInBytes))) : Math.max(0, Math.floor(numberValue(runtime?.netin)))
  const netOut = stopped && previous ? Math.max(0, Math.floor(numberValue(previous.networkOutBytes))) : Math.max(0, Math.floor(numberValue(runtime?.netout)))
  const previousAt = previous?.recordedAt ? new Date(previous.recordedAt).getTime() : 0
  const seconds = previousAt ? Math.max(1, (now.getTime() - previousAt) / 1000) : 0
  const rxDelta = previous ? Math.max(0, netIn - numberValue(previous.networkInBytes)) : 0
  const txDelta = previous ? Math.max(0, netOut - numberValue(previous.networkOutBytes)) : 0
  const rxRateBps = seconds ? Math.round(rxDelta / seconds) : 0
  const txRateBps = seconds ? Math.round(txDelta / seconds) : 0

  const created = await (prisma as any).vpsMetric.create({
    data: {
      vpsInstanceId: vps.id,
      vmid: vps.vmid,
      runtimeStatus,
      cpuPercent,
      ramUsedBytes: BigInt(ramUsedBytes),
      ramTotalBytes: BigInt(configuredRamTotalBytes),
      diskUsedBytes: BigInt(diskUsedBytes),
      diskTotalBytes: BigInt(diskTotalBytes),
      diskFreeBytes: BigInt(diskFreeBytes),
      diskPercent: percent(diskUsedBytes, diskTotalBytes),
      diskReadBytes: BigInt(diskReadBytes),
      diskWriteBytes: BigInt(diskWriteBytes),
      networkInBytes: BigInt(netIn),
      networkOutBytes: BigInt(netOut),
      metadata: {
        source: "vm-telemetry-worker",
        os: vmOsKind,
        uptime: numberValue(runtime?.uptime),
        nodeId: vps.proxmoxNodeId,
        ipAddress: vps.ipAddress || null,
        rxDelta,
        txDelta,
        rxRateBps,
        txRateBps,
        configuredMemoryMb: numberValue(config?.memory),
        diskUsage: guestDisk ? {
          ok: guestDisk.ok,
          os: guestDisk.os,
          engine: guestDisk.engine,
          source: guestDisk.source,
          // Which profile produced the number, and which version of it. A disk
          // figure with no provenance is a number nobody can argue with later.
          templateId: guestDisk.templateId,
          templateVersion: guestDisk.templateVersion,
          totalBytes: guestDisk.totalBytes,
          usedBytes: guestDisk.usedBytes,
          freeBytes: guestDisk.freeBytes,
          usedPercent: guestDisk.usedPercent,
          filesystem: guestDisk.filesystem,
          volumes: guestDisk.volumes,
          selectedVolume: guestDisk.selectedVolume || null,
          errorCode: guestDisk.errorCode || null,
          error: guestDisk.error || null,
          collectionDurationMs: guestDisk.collectionDurationMs || null,
          checkedAt: guestDisk.checkedAt || null,
        } : {
          ok: selectedDisk.source === "last-known",
          os: vmOsKind,
          source: selectedDisk.source,
          totalBytes: selectedDisk.totalBytes,
          usedBytes: selectedDisk.usedBytes,
          freeBytes: selectedDisk.freeBytes,
          volumes: [],
          selectedVolume: null,
          errorCode: runtimeStatus === "stopped" ? "VM_STOPPED" : null,
          error: runtimeStatus === "stopped" ? "Server stopped" : null,
          collectionDurationMs: null,
          checkedAt: vps.diskUsageCheckedAt ? new Date(vps.diskUsageCheckedAt).toISOString() : null,
          attempted: guestDisk !== null || shouldCollectDisk,
        },
      },
      recordedAt: now,
    },
  })

  await Promise.all([
    (prisma as any).vmUsageHistory.create({
      data: {
        vmId: String(vps.vmid),
        runtimeStatus,
        cpuPercent: Number(created.cpuPercent || 0),
        ramUsed: created.ramUsedBytes,
        ramTotal: created.ramTotalBytes,
        diskUsed: created.diskUsedBytes,
        diskTotal: created.diskTotalBytes,
        networkIn: created.networkInBytes,
        networkOut: created.networkOutBytes,
        metadata: {
          sourceMetricId: created.id,
          vpsInstanceId: vps.id,
          os: vmOsKind,
          diskSource: selectedDisk.source,
        },
        createdAt: now,
      },
    }).catch(() => null),
    guestDisk?.ok
      ? prisma.vpsInstance.update({
          where: { id: vps.id },
          data: {
            status: dbStatusFromPowerState(runtimeStatus, vps.status || "UNKNOWN"),
            diskUsedGb: Number((guestDisk.usedBytes / 1_000_000_000).toFixed(2)),
            diskTotalGb: Number((guestDisk.totalBytes / 1_000_000_000).toFixed(2)),
            diskUsagePercent: Number(percent(guestDisk.usedBytes, guestDisk.totalBytes).toFixed(2)),
            diskUsageCheckedAt: now,
            diskUsageSource: guestDisk.source,
          },
        }).catch(() => null)
      : prisma.vpsInstance.update({
          where: { id: vps.id },
          data: { status: dbStatusFromPowerState(runtimeStatus, vps.status || "UNKNOWN") },
        }).catch(() => null),
  ])

  await upsertDatabaseFirstCaches({
    vps,
    runtime,
    metric: created,
    runtimeStatus,
    rxDelta,
    txDelta,
    rxRateBps,
    txRateBps,
    now,
  }).catch((error) => {
    console.error("[vm-telemetry-worker] database-first cache update failed", {
      vpsId: vps.id,
      vmid: vps.vmid,
      message: error?.message || String(error),
    })
  })

  await publishRealtimeEvent(realtimeChannels.vpsMetric(vps.id), serializeMetric(created, runtime, vmOsKind)).catch(() => null)
  if (previous && (rxDelta > 0 || txDelta > 0 || rxRateBps > 0 || txRateBps > 0)) {
    await recordBandwidthSample({
      vpsInstanceId: vps.id,
      customerId: vps.customerId,
      productId: vps.productId || null,
      proxmoxNodeId: vps.proxmoxNodeId || null,
      ipAddress: vps.ipAddress || null,
      vmid: vps.vmid,
      rxBytes: rxDelta,
      txBytes: txDelta,
      rxRateBps,
      txRateBps,
      includedBandwidthTb: vps.product?.bandwidthTb || 0,
      recordedAt: now,
      metadata: { sourceMetricId: created.id },
    }).catch((error) => {
      console.error("[vm-telemetry-worker] bandwidth sample failed", {
        vpsId: vps.id,
        vmid: vps.vmid,
        message: error?.message || String(error),
      })
    })
    await applyBandwidthThrottle({
      vpsId: vps.id,
      actor: "worker:vm-telemetry",
    }).catch((error) => {
      console.error("[vm-telemetry-worker] bandwidth enforcement failed", {
        vpsId: vps.id,
        vmid: vps.vmid,
        message: error?.message || String(error),
      })
    })
  }

  await verifyOwnershipIfDue(vps, client).catch((error) => {
    console.warn("[vm-telemetry-worker] ownership verification failed", {
      vpsId: vps.id,
      vmid: vps.vmid,
      message: error?.message || String(error),
    })
  })
}

let enumerateCursor: string | null = null

async function tick() {
  const batchSize = Math.max(50, Number(process.env.VM_TELEMETRY_BATCH_SIZE || 1000))
  const rows = await prisma.vpsInstance.findMany({
    where: {
      deletedAt: null,
      proxmoxNodeId: { not: null },
      vmid: { gt: 0 },
    },
    include: {
      product: { select: { id: true, bandwidthTb: true } },
      proxmoxNode: true,
      operatingSystem: { select: { name: true, osFamily: true, osType: true, category: true } },
      order: { select: { status: true, osName: true } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(enumerateCursor ? { cursor: { id: enumerateCursor }, skip: 1 } : {}),
    take: batchSize,
  })
  const last = rows[rows.length - 1]
  // Rotate: when the table is exhausted the next tick restarts from the top, so
  // every VM is collected even when the fleet exceeds a single batch (the old
  // `take: 500` + fixed order silently starved every VM past row 500 forever).
  enumerateCursor = last && rows.length >= batchSize ? last.id : null
  const vpsRows = rows.filter(shouldCollect)
  await mapLimit(vpsRows, CONCURRENCY, async (vps) => {
    await collectVps(vps).catch((error) => {
      console.error("[vm-telemetry-worker] collection failed", {
        vpsId: vps.id,
        vmid: vps.vmid,
        nodeId: vps.proxmoxNodeId,
        message: error?.message || String(error),
      })
    })
  })
  const backoff = backoffState()
  console.log("[vm-telemetry-worker] tick", {
    scanned: rows.length,
    sampled: vpsRows.length,
    cursor: enumerateCursor,
    concurrency: CONCURRENCY,
    inFlight: backoff.inFlight,
    backingOff: backoff.backingOff,
  })
}

/**
 * Fold and expire metrics.
 *
 * A separate cadence from collection, because the two have opposite shapes: one
 * is small and frequent, the other is large and infrequent. Folding on every
 * tick would be a full scan of the busiest table thirty times an hour to find
 * almost nothing new.
 */
async function retentionPass(dryRun = false) {
  const started = Date.now()
  try {
    const result = await runRetentionPass({ dryRun })
    console.log("[vm-telemetry-worker] retention", {
      dryRun,
      durationMs: result.durationMs,
      wallMs: Date.now() - started,
      fiveMinute: result.fiveMinute,
      hourly: result.hourly,
      deleted: result.retention.results.map((entry) => `${entry.resolution}:${entry.deleted}`).join(","),
    })
    return result
  } catch (error: any) {
    console.error("[vm-telemetry-worker] retention failed", { message: error?.message || String(error) })
    return null
  }
}

async function main() {
  console.log("[vm-telemetry-worker] started", {
    pollMs: POLL_MS,
    concurrency: CONCURRENCY,
    once: ONCE,
    retentionOnly: RETENTION_ONLY,
    retentionMs: RETENTION_MS,
  })

  if (RETENTION_ONLY) {
    await retentionPass(RETENTION_DRY_RUN)
    return
  }

  let lastRetentionAt = 0
  while (!stopping) {
    const started = Date.now()
    await tick().catch((error) => {
      console.error("[vm-telemetry-worker] tick failed", { message: error?.message || String(error) })
    })
    // On the first pass, and then on the retention cadence. Not on every tick.
    if (Date.now() - lastRetentionAt >= RETENTION_MS) {
      lastRetentionAt = Date.now()
      await retentionPass(false)
    }
    if (ONCE) break
    await sleep(Math.max(1000, POLL_MS - (Date.now() - started)))
  }
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main()
  .catch((error) => {
    console.error("[vm-telemetry-worker] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    if (ONCE) process.exit(process.exitCode || 0)
  })
