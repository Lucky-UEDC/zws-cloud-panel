import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_VM_TIMEOUT_MS } from "@/lib/proxmox"
import { discoverVmIpAddress } from "@/lib/vm-ip-discovery"
import { safeJson } from "@/lib/safe-json"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"
import { writeStructuredLog } from "@/lib/structured-logger"
import { collectGuestDiskUsage, configuredMemoryBytes, type GuestDiskUsage } from "@/lib/vm-guest-disk"
import { resolveVmGuestOs, type VmGuestOsKind } from "@/lib/vm-os-detection"
import { dbStatusFromPowerState } from "@/lib/vm-runtime-status"
import { instanceDisplayName, internalVmHostname } from "@/lib/vm-hostname"

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (used / total) * 100))
}

function ipsFromGuestAgent(value: any) {
  const rows = Array.isArray(value?.result) ? value.result : Array.isArray(value) ? value : []
  const ips: string[] = []
  for (const row of rows) {
    for (const addr of row?.["ip-addresses"] || []) {
      const ip = String(addr?.["ip-address"] || "").trim()
      if (!ip || ip.startsWith("127.") || ip === "::1" || ip.startsWith("fe80:")) continue
      ips.push(ip)
    }
  }
  return ips
}

function dbStatusFromRuntime(runtimeStatus: string, fallback: string) {
  return dbStatusFromPowerState(runtimeStatus, fallback || "UNKNOWN")
}

export function serializeLiveRuntime(input: {
  vps: any
  runtime?: any
  config?: Record<string, any> | null
  interfaces?: any
  agentPingOk?: boolean
  guestInfo?: any
  diskUsage?: GuestDiskUsage | null
  ipAddress?: string | null
  ipSource?: string | null
  error?: unknown
}) {
  const runtimeStatus = String(input.runtime?.status || "").toLowerCase()
  const ramUsedBytes = numberValue(input.runtime?.mem)
  const ramTotalBytes = configuredMemoryBytes(input.config, input.runtime?.maxmem)
  const diskReported = Boolean(input.diskUsage?.ok)
  const diskUsedBytes = diskReported ? input.diskUsage!.usedBytes : 0
  const diskTotalBytes = diskReported ? input.diskUsage!.totalBytes : 0
  const networkIps = ipsFromGuestAgent(input.interfaces)
  const nodeName = input.vps.proxmoxNode?.nodeName || input.vps.order?.proxmoxNode || null
  const status = input.runtime ? dbStatusFromRuntime(runtimeStatus, input.vps.status) : String(input.vps.status || "UNKNOWN")

  return safeJson({
    source: "proxmox-live",
    generatedAt: new Date().toISOString(),
    vpsInstanceId: input.vps.id,
    orderId: input.vps.orderId,
    customerId: input.vps.customerId,
    vmid: Number(input.vps.vmid || 0),
    node: nodeName,
    proxmoxNodeId: input.vps.proxmoxNodeId || null,
    status,
    runtimeStatus: runtimeStatus || null,
    powerState: runtimeStatus || "unknown",
    cpuPercent: Math.max(0, Math.min(100, numberValue(input.runtime?.cpu) * 100)),
    ramUsedBytes,
    ramTotalBytes,
    ramPercent: percent(ramUsedBytes, ramTotalBytes),
    diskUsedBytes,
    diskTotalBytes,
    diskFreeBytes: diskReported ? input.diskUsage!.freeBytes : 0,
    diskPercent: percent(diskUsedBytes, diskTotalBytes),
    diskReadBytes: numberValue(input.runtime?.diskread),
    diskWriteBytes: numberValue(input.runtime?.diskwrite),
    networkInBytes: numberValue(input.runtime?.netin),
    networkOutBytes: numberValue(input.runtime?.netout),
    ipAddress: input.ipAddress || networkIps[0] || input.vps.ipAddress || null,
    instanceName: instanceDisplayName(input.vps),
    hostname: internalVmHostname(input.vps, input.ipAddress || networkIps[0] || input.vps.ipAddress || null),
    ipSource: input.ipSource || (networkIps[0] ? "guest_agent" : input.vps.ipAddress ? "panel_allocation" : "none"),
    agentStatus: input.agentPingOk ? "online" : runtimeStatus === "running" ? "unavailable" : "offline",
    networkStatus: networkIps.length ? "reported" : runtimeStatus === "running" ? "unknown" : "offline",
    networkIps,
    uptimeSeconds: numberValue(input.runtime?.uptime),
    configAvailable: Boolean(input.config),
    guestOs: input.guestInfo?.result || input.guestInfo || null,
    diskUsage: input.diskUsage ? {
      ok: input.diskUsage.ok,
      source: input.diskUsage.source,
      totalBytes: input.diskUsage.totalBytes,
      usedBytes: input.diskUsage.usedBytes,
      freeBytes: input.diskUsage.freeBytes,
      volumes: input.diskUsage.volumes,
      error: input.diskUsage.error || null,
    } : null,
    raw: {
      runtime: input.runtime || null,
      config: input.config || null,
    },
    error: input.error instanceof Error ? input.error.message : input.error ? String(input.error) : null,
  })
}

export async function loadLiveVmSnapshot(vpsId: string, options: { syncDatabase?: boolean } = {}) {
  const startedAt = Date.now()
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id: vpsId }, { orderId: vpsId }], deletedAt: null },
    include: {
      proxmoxNode: true,
      customer: { select: { id: true, email: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true, customerId: true, proxmoxNode: true, osName: true } },
      product: { select: { id: true, name: true, cpuCores: true, ramGb: true, storageGb: true, bandwidthTb: true } },
      operatingSystem: { select: { id: true, name: true, osFamily: true, osType: true, category: true } },
    },
  })
  if (!vps) {
    const error = new Error("VM not found")
    ;(error as any).status = 404
    throw error
  }

  if (!vps.proxmoxNode || !vps.vmid || ["external", "manual", "rejected"].includes(String(vps.ownershipStatus || "").toLowerCase())) {
    return serializeLiveRuntime({ vps, error: "Proxmox live data unavailable for this service" })
  }

  const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
    allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    timeoutMs: PROXMOX_VM_TIMEOUT_MS,
  })
  const nodeName = vps.proxmoxNode.nodeName
  const [runtimeResult, configResult] = await Promise.allSettled([
    client.getVMStatus(nodeName, vps.vmid),
    client.getVMConfig(nodeName, vps.vmid),
  ])
  const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value : null
  const config = configResult.status === "fulfilled" ? configResult.value : null
  const [interfacesResult, agentPingResult, guestInfoResult] = await Promise.allSettled([
    runtime ? client.getVMGuestNetworkInterfaces(nodeName, vps.vmid) : Promise.resolve(null),
    runtime ? client.pingVMGuestAgent(nodeName, vps.vmid).then(() => true) : Promise.resolve(false),
    runtime ? client.getVMGuestInfo(nodeName, vps.vmid) : Promise.resolve(null),
  ])
  const runtimeStatus = String(runtime?.status || "").toLowerCase()
  const vmOsKind = resolveVmGuestOs({
    osType: vps.operatingSystem?.osType,
    osFamily: vps.operatingSystem?.osFamily,
    category: vps.operatingSystem?.category,
    osName: vps.operatingSystem?.name,
    vmOsFamily: vps.vmOsFamily,
    orderOsName: vps.order?.osName,
  })
  const diskUsage = runtimeStatus === "running"
    ? await collectGuestDiskUsage({ client, nodeName, vmid: vps.vmid, os: vmOsKind }).catch(() => null)
    : null
  const discovered = await discoverVmIpAddress({
    client,
    nodeName,
    vmid: vps.vmid,
    config,
    allocatedIp: vps.ipAddress,
    hostname: vps.name,
  }).catch(() => null)
  const snapshot = serializeLiveRuntime({
    vps,
    runtime,
    config,
    interfaces: interfacesResult.status === "fulfilled" ? interfacesResult.value : null,
    agentPingOk: agentPingResult.status === "fulfilled" ? Boolean(agentPingResult.value) : false,
    guestInfo: guestInfoResult.status === "fulfilled" ? guestInfoResult.value : null,
    diskUsage,
    ipAddress: discovered?.ipAddress || null,
    ipSource: discovered?.source || null,
    error: runtimeResult.status === "rejected" && configResult.status === "rejected" ? runtimeResult.reason : null,
  })

  const patch: Record<string, unknown> = {}
  if (snapshot.status && snapshot.status !== vps.status) patch.status = snapshot.status
  if (snapshot.ipAddress && snapshot.ipAddress !== vps.ipAddress) patch.ipAddress = snapshot.ipAddress
  if (diskUsage?.ok) {
    patch.diskUsedGb = Number((diskUsage.usedBytes / 1_000_000_000).toFixed(2))
    patch.diskTotalGb = Number((diskUsage.totalBytes / 1_000_000_000).toFixed(2))
    patch.diskUsagePercent = Number(percent(diskUsage.usedBytes, diskUsage.totalBytes).toFixed(2))
    patch.diskUsageCheckedAt = new Date()
    patch.diskUsageSource = diskUsage.source
  }
  if (options.syncDatabase !== false && Object.keys(patch).length) {
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: patch as any }).catch(() => null)
  }
  await writeStructuredLog("proxmox-sync", "live_snapshot", {
    vpsInstanceId: vps.id,
    vmid: vps.vmid,
    node: nodeName,
    status: 200,
    durationMs: Date.now() - startedAt,
    response: { runtimeStatus: snapshot.runtimeStatus, ipAddress: snapshot.ipAddress, source: snapshot.source },
    error: snapshot.error || null,
  })
  return snapshot
}

export async function publishLiveVmSnapshot(vpsId: string, reason = "snapshot") {
  const snapshot = await loadLiveVmSnapshot(vpsId)
  await Promise.all([
    publishRealtimeEvent(realtimeChannels.vpsLive(snapshot.vpsInstanceId), { reason, snapshot }),
    publishRealtimeEvent(realtimeChannels.adminVmLive(), { reason, snapshot }),
  ]).catch(() => null)
  return snapshot
}
