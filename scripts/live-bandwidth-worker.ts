import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_METRICS_TIMEOUT_MS } from "@/lib/proxmox"
import { readNicRateLimit } from "@/lib/bandwidth-enforcement"
import { aggregateLiveBandwidthNodes, calculateLiveBandwidth, liveBandwidthState, type CounterSnapshot, type LiveBandwidthVmRow } from "@/lib/live-bandwidth"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"

const POLL_MS = Math.max(500, Math.min(2000, Number(process.env.LIVE_BANDWIDTH_POLL_MS || 1000)))
const CONFIG_REFRESH_MS = Math.max(5000, Number(process.env.LIVE_BANDWIDTH_CONFIG_REFRESH_MS || 30_000))
const BATCH_SIZE = Math.max(1, Number(process.env.LIVE_BANDWIDTH_VM_BATCH_SIZE || 500))
const ONCE = process.argv.includes("--once")

let stopping = false
const previousByVps = new Map<string, CounterSnapshot>()
const peakByVps = new Map<string, number>()
const configByVps = new Map<string, { checkedAt: number; net0: string | null; rate: number | null }>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasNetworkCounters(row: any) {
  return row && (row.netin != null || row.netout != null)
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

function includedBytesFromTb(value: unknown) {
  const tb = Number(value || 0)
  if (!Number.isFinite(tb) || tb <= 0) return 0
  return Math.floor(tb * 1000 * 1000 * 1000 * 1000)
}

function groupByNode(rows: any[]) {
  const groups = new Map<string, any[]>()
  for (const row of rows) {
    const key = String(row.proxmoxNodeId || "")
    if (!key || !row.proxmoxNode) continue
    const current = groups.get(key) || []
    current.push(row)
    groups.set(key, current)
  }
  return groups
}

async function loadNicConfig(vps: any, client: any, force = false) {
  const cached = configByVps.get(vps.id)
  if (!force && cached && Date.now() - cached.checkedAt < CONFIG_REFRESH_MS) return cached
  const config = await client.getVMConfig(vps.proxmoxNode.nodeName, vps.vmid).catch(() => null)
  const net0 = config?.net0 == null ? null : String(config.net0)
  const next = { checkedAt: Date.now(), net0, rate: net0 ? readNicRateLimit(net0) : null }
  configByVps.set(vps.id, next)
  return next
}

async function collectNode(nodeRows: any[]) {
  const node = nodeRows[0]?.proxmoxNode
  if (!node) return []
  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_METRICS_TIMEOUT_MS,
    logRequests: false,
  })
  const [qemuRows, networkRows] = await Promise.all([
    client.getVMList(node.nodeName).catch(() => []),
    client.getNodeNetwork(node.nodeName).catch(() => []),
  ])
  const qemuByVmid = new Map((Array.isArray(qemuRows) ? qemuRows : []).map((row: any) => [Number(row?.vmid || 0), row]))
  const nowMs = Date.now()
  const sampledAt = new Date(nowMs).toISOString()
  const liveRows: LiveBandwidthVmRow[] = []

  for (const vps of nodeRows) {
    let runtime: any = qemuByVmid.get(Number(vps.vmid))
    let source = Array.isArray(qemuRows) && qemuByVmid.has(Number(vps.vmid)) ? "proxmox-qemu-list" : "proxmox-status-current"
    if (!hasNetworkCounters(runtime)) {
      const statusRuntime = await client.getVMStatus(node.nodeName, vps.vmid).catch(() => null)
      if (statusRuntime) {
        runtime = statusRuntime
        source = "proxmox-status-current"
      }
    }
    const current: CounterSnapshot = {
      rxBytes: Math.max(0, Math.floor(numberValue(runtime?.netin))),
      txBytes: Math.max(0, Math.floor(numberValue(runtime?.netout))),
      sampledAt: nowMs,
    }
    const previous = previousByVps.get(vps.id)
    const live = calculateLiveBandwidth(previous, current)
    previousByVps.set(vps.id, current)

    const config = await loadNicConfig(vps, client)
    const throttle = vps.bandwidthThrottleState || null
    const throttled = String(throttle?.status || "").toLowerCase() === "throttled" || Boolean(config.rate)
    const currentRateLimit = throttle?.proxmoxRateValue == null ? config.rate : Number(throttle.proxmoxRateValue)
    const throttleRateMbps = throttle?.throttleRateMbps == null ? (currentRateLimit ? Number((currentRateLimit * 8).toFixed(4)) : null) : Number(throttle.throttleRateMbps)
    const combinedBps = live.rxRateBps + live.txRateBps
    const peak = Math.max(peakByVps.get(vps.id) || 0, combinedBps)
    peakByVps.set(vps.id, peak)
    const state = liveBandwidthState({ rxRateBps: live.rxRateBps, txRateBps: live.txRateBps, throttled, sampledAt })

    liveRows.push({
      vpsInstanceId: vps.id,
      customerId: vps.customerId || null,
      customerName: vps.customer?.name || "Customer",
      customerEmail: vps.customer?.email || null,
      vmName: vps.name || runtime?.name || `VM ${vps.vmid}`,
      vmid: Number(vps.vmid || 0) || null,
      ipAddress: vps.ipAddress || null,
      nodeId: vps.proxmoxNodeId || null,
      nodeName: node.name || node.nodeName || "-",
      rxBytes: current.rxBytes,
      txBytes: current.txBytes,
      totalBytes: current.rxBytes + current.txBytes,
      rxRateBps: live.rxRateBps,
      txRateBps: live.txRateBps,
      currentMbps: live.currentMbps,
      currentKbps: live.currentKbps,
      peakRateBps: peak,
      throttled,
      throttleRateMbps,
      currentRateLimit,
      proxmoxRateValue: config.rate,
      net0: config.net0,
      liveState: state,
      sampledAt,
      source,
    })
  }

  return { liveRows, networkRows }
}

async function tick() {
  const rows = await prisma.vpsInstance.findMany({
    where: { deletedAt: null, proxmoxNodeId: { not: null }, vmid: { gt: 0 } },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      proxmoxNode: true,
      bandwidthThrottleState: true,
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  })
  const vpsRows = rows.filter(shouldCollect)
  const grouped = groupByNode(vpsRows)
  const collected = await Promise.all(Array.from(grouped.values()).map((group) => collectNode(group).catch((error) => {
    console.error("[live-bandwidth-worker] node collection failed", {
      nodeId: group[0]?.proxmoxNodeId,
      message: error?.message || String(error),
    })
    return { liveRows: [], networkRows: [] }
  })))
  const vms = collected.flatMap((row: any) => row.liveRows || [])
  const nodes = aggregateLiveBandwidthNodes(vms)
  const payload = {
    success: true,
    sampledAt: new Date().toISOString(),
    pollMs: POLL_MS,
    vms,
    nodes,
  }
  await persistBandwidthSamples(vms, rows).catch((error) => {
    console.error("[live-bandwidth-worker] persist failed", { message: error?.message || String(error) })
  })
  await publishRealtimeEvent(realtimeChannels.adminBandwidthLive(), payload).catch(() => null)
  for (const node of nodes) {
    if (node.nodeId) await publishRealtimeEvent(realtimeChannels.nodeBandwidthLive(node.nodeId), { ...payload, nodes: [node], vms: vms.filter((vm) => vm.nodeId === node.nodeId) }).catch(() => null)
  }
  console.log("[live-bandwidth-worker] tick", { sampled: vms.length, nodes: nodes.length })
}

async function persistBandwidthSamples(vms: LiveBandwidthVmRow[], sourceRows: any[]) {
  if (!vms.length) return
  const byId = new Map(sourceRows.map((row) => [row.id, row]))
  const now = new Date()
  await (prisma as any).vmBandwidthUsage.createMany({
    data: vms.map((vm) => {
      const vps = byId.get(vm.vpsInstanceId) as any
      const includedBytes = includedBytesFromTb(vps?.bandwidthTb ?? vps?.product?.bandwidthTb)
      return {
        vpsInstanceId: vm.vpsInstanceId,
        customerId: vm.customerId,
        productId: vps?.productId || null,
        proxmoxNodeId: vm.nodeId,
        ipAddress: vm.ipAddress,
        vmid: vm.vmid,
        period: "sample",
        bucketAt: vm.sampledAt ? new Date(vm.sampledAt) : now,
        rxBytes: BigInt(Math.max(0, Math.floor(vm.rxBytes || 0))),
        txBytes: BigInt(Math.max(0, Math.floor(vm.txBytes || 0))),
        totalBytes: BigInt(Math.max(0, Math.floor(vm.totalBytes || 0))),
        rxRateBps: BigInt(Math.max(0, Math.floor(vm.rxRateBps || 0))),
        txRateBps: BigInt(Math.max(0, Math.floor(vm.txRateBps || 0))),
        peakRateBps: BigInt(Math.max(0, Math.floor(vm.peakRateBps || 0))),
        includedBytes: BigInt(includedBytes),
        billableBytes: BigInt(Math.max(0, Math.floor((vm.totalBytes || 0) - includedBytes))),
        source: vm.source || "live-bandwidth-worker",
        metadata: { liveState: vm.liveState, throttled: vm.throttled, throttleRateMbps: vm.throttleRateMbps },
      }
    }),
  })
  await Promise.all(vms.map((vm) => (prisma as any).vmMetricsCache.upsert({
    where: { vpsInstanceId: vm.vpsInstanceId },
    create: {
      vpsInstanceId: vm.vpsInstanceId,
      proxmoxNodeId: vm.nodeId,
      vmid: vm.vmid,
      runtimeStatus: vm.liveState === "stale" ? "stopped" : "running",
      networkInBytes: BigInt(Math.max(0, Math.floor(vm.rxBytes || 0))),
      networkOutBytes: BigInt(Math.max(0, Math.floor(vm.txBytes || 0))),
      rxRateBps: BigInt(Math.max(0, Math.floor(vm.rxRateBps || 0))),
      txRateBps: BigInt(Math.max(0, Math.floor(vm.txRateBps || 0))),
      source: "live-bandwidth-worker",
      recordedAt: vm.sampledAt ? new Date(vm.sampledAt) : now,
      staleAfter: new Date(Date.now() + Math.max(30_000, POLL_MS * 4)),
      metadata: { liveState: vm.liveState },
    },
    update: {
      proxmoxNodeId: vm.nodeId,
      vmid: vm.vmid,
      networkInBytes: BigInt(Math.max(0, Math.floor(vm.rxBytes || 0))),
      networkOutBytes: BigInt(Math.max(0, Math.floor(vm.txBytes || 0))),
      rxRateBps: BigInt(Math.max(0, Math.floor(vm.rxRateBps || 0))),
      txRateBps: BigInt(Math.max(0, Math.floor(vm.txRateBps || 0))),
      source: "live-bandwidth-worker",
      recordedAt: vm.sampledAt ? new Date(vm.sampledAt) : now,
      staleAfter: new Date(Date.now() + Math.max(30_000, POLL_MS * 4)),
      metadata: { liveState: vm.liveState },
    },
  }).catch(() => null)))
}

async function main() {
  console.log("[live-bandwidth-worker] started", { pollMs: POLL_MS, configRefreshMs: CONFIG_REFRESH_MS, batchSize: BATCH_SIZE, once: ONCE })
  while (!stopping) {
    const started = Date.now()
    await tick().catch((error) => console.error("[live-bandwidth-worker] tick failed", { message: error?.message || String(error) }))
    if (ONCE) break
    await sleep(Math.max(100, POLL_MS - (Date.now() - started)))
  }
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main()
  .catch((error) => {
    console.error("[live-bandwidth-worker] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
