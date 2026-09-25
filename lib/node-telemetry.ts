import { prisma } from "@/lib/db"
import { createProxmoxClient, PROXMOX_METRICS_TIMEOUT_MS, normalizeProxmoxHost } from "@/lib/proxmox/client"
import { classifyHealth, cpuPercent, latestRrdNetworkRate, percent, safeMonitoringError } from "@/lib/compute-node-monitoring"
import { recordCapacityAlert, resolveCapacityAlert } from "@/lib/provisioning-alerts"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"

const ALERT_CPU = 85
const ALERT_RAM = 80
const ALERT_DISK = 90
const RAW_RETENTION_DAYS = 30
const ANALYTICS_RETENTION_DAYS = 90
const LOG_RETENTION_DAYS = 180
const METRIC_PERSIST_MS = Math.max(30_000, Number(process.env.NODE_METRIC_PERSIST_MS || 60_000))

type DbNode = {
  id: string
  name: string
  host: string
  tokenId: string
  tokenSecret: string
  nodeName: string
  allowInsecureTls: boolean
}

type CounterState = {
  at: number
  networkIn: number
  networkOut: number
  diskRead: number
  diskWrite: number
}

const counters = new Map<string, CounterState>()
const persistedMetrics = new Map<string, { at: number; health: string; cpuUsage: number; ramUsage: number; diskUsage: number; runningVms: number; stoppedVms: number }>()
const seenTaskEvents = new Map<string, number>()

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function loadParts(value: unknown) {
  if (Array.isArray(value)) return [numberValue(value[0]), numberValue(value[1]), numberValue(value[2])]
  const parts = String(value || "").trim().split(/\s+/)
  return [numberValue(parts[0]), numberValue(parts[1]), numberValue(parts[2])]
}

function sumBy(rows: any[], key: string) {
  return rows.reduce((sum, row) => sum + numberValue(row?.[key]), 0)
}

function taskCounts(tasks: any[]) {
  const active = tasks.filter((task) => ["running", "queued"].includes(String(task?.status || "").toLowerCase())).length
  const queued = tasks.filter((task) => String(task?.status || "").toLowerCase() === "queued").length
  return { active, queued }
}

function taskLevel(task: any) {
  const status = String(task?.status || "").toLowerCase()
  const exit = String(task?.exitstatus || "").toLowerCase()
  if (status === "error" || exit.includes("error") || exit.includes("failed")) return "error"
  if (status === "warning") return "warn"
  return "info"
}

function taskMessage(task: any) {
  const type = String(task?.type || task?.worker_type || task?.event || "task").toLowerCase()
  const id = task?.id || task?.vmid || task?.upid || ""
  const status = String(task?.status || "").toLowerCase()
  const done = status === "stopped" || status === "ok" || task?.endtime
  const target = id ? `VM ${id}` : "Node task"
  if (/qmstart|start/.test(type)) return `${target} started successfully`
  if (/qmstop|stop|shutdown/.test(type)) return `${target} stopped successfully`
  if (/qmreboot|reboot|reset/.test(type)) return `${target} reboot requested`
  if (/vzdump|backup/.test(type)) return `${target} backup ${done ? "completed" : "queued"}`
  if (/restore/.test(type)) return `${target} restore ${done ? "completed" : "queued"}`
  if (/resize|disk/.test(type)) return `${target} disk resize ${done ? "completed" : "queued"}`
  if (/clone|template|create/.test(type)) return `${target} provisioning task ${done ? "completed" : "queued"}`
  if (/network|bridge|ip/.test(type)) return `${target} network change ${done ? "completed" : "queued"}`
  return `${target} ${String(task?.type || "task")} ${done ? "completed" : "queued"}`
}

async function publishTaskEvents(node: DbNode, taskRows: any[]) {
  const now = Date.now()
  for (const [key, at] of seenTaskEvents) {
    if (now - at > 10 * 60_000) seenTaskEvents.delete(key)
  }
  for (const task of Array.isArray(taskRows) ? taskRows.slice(0, 20) : []) {
    const upid = String(task?.upid || `${task?.type || "task"}:${task?.id || ""}:${task?.starttime || ""}:${task?.status || ""}`)
    const key = `${node.id}:${upid}:${task?.status || ""}:${task?.exitstatus || ""}`
    if (seenTaskEvents.has(key)) continue
    seenTaskEvents.set(key, now)
    await publishRealtimeEvent(realtimeChannels.nodeLogs(node.id), {
      id: `proxmox:${Buffer.from(key).toString("base64url").slice(0, 48)}`,
      source: "proxmox",
      level: taskLevel(task),
      event: String(task?.type || "task"),
      message: taskMessage(task),
      createdAt: task?.endtime ? new Date(Number(task.endtime) * 1000).toISOString() : task?.starttime ? new Date(Number(task.starttime) * 1000).toISOString() : new Date().toISOString(),
      metadata: { nodeId: node.id, nodeName: node.nodeName, vmid: task?.id || null, upid: task?.upid || null, status: task?.status || null, exitstatus: task?.exitstatus || null },
    }).catch(() => null)
  }
}

function throughput(nodeId: string, next: CounterState) {
  const previous = counters.get(nodeId)
  counters.set(nodeId, next)
  if (!previous) return { networkIn: 0, networkOut: 0, diskRead: 0, diskWrite: 0 }
  const seconds = Math.max(1, (next.at - previous.at) / 1000)
  return {
    networkIn: Math.max(0, Math.round((next.networkIn - previous.networkIn) / seconds)),
    networkOut: Math.max(0, Math.round((next.networkOut - previous.networkOut) / seconds)),
    diskRead: Math.max(0, Math.round((next.diskRead - previous.diskRead) / seconds)),
    diskWrite: Math.max(0, Math.round((next.diskWrite - previous.diskWrite) / seconds)),
  }
}

async function upsertAlert(input: {
  dedupeKey: string
  alertType: string
  severity: string
  title: string
  message: string
  nodeId?: string
  queueName?: string
  metadata?: Record<string, unknown>
}) {
  await (prisma as any).systemAlert.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {
      severity: input.severity,
      status: "open",
      title: input.title,
      message: input.message,
      nodeId: input.nodeId || null,
      queueName: input.queueName || null,
      metadata: input.metadata || {},
      lastSeenAt: new Date(),
      resolvedAt: null,
    },
    create: {
      dedupeKey: input.dedupeKey,
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      nodeId: input.nodeId || null,
      queueName: input.queueName || null,
      metadata: input.metadata || {},
    },
  }).catch(() => null)
}

async function resolveAlert(dedupeKey: string) {
  await (prisma as any).systemAlert.updateMany({
    where: { dedupeKey, status: "open" },
    data: { status: "resolved", resolvedAt: new Date(), lastSeenAt: new Date() },
  }).catch(() => null)
}

async function evaluateAlerts(metric: any, node: DbNode) {
  const checks = [
    { key: "high_cpu", value: metric.cpuUsage, threshold: ALERT_CPU, label: "CPU" },
    { key: "high_ram", value: metric.ramUsage, threshold: ALERT_RAM, label: "RAM" },
    { key: "disk_full", value: metric.diskUsage, threshold: ALERT_DISK, label: "Disk" },
  ]
  for (const check of checks) {
    const dedupeKey = `node:${node.id}:${check.key}`
    if (check.value >= check.threshold) {
      await upsertAlert({
        dedupeKey,
        alertType: check.key,
        severity: check.value >= 95 ? "critical" : "warning",
        title: `${node.name} ${check.label} threshold`,
        message: `${check.label} usage is ${check.value.toFixed(1)}%.`,
        nodeId: node.id,
        metadata: { value: check.value, threshold: check.threshold },
      })
      await recordCapacityAlert({
        event: check.value >= 95 ? "node_full" : "node_capacity_warning",
        dedupeKey: `node:${node.id}:${check.key}:whatsapp`,
        title: check.value >= 95 ? `${node.name} capacity alert` : `${node.name} ${check.label} warning`,
        message: check.value >= 95
          ? `🚨 Capacity Alert\n\nNode:\n${node.name}\n\nStatus:\nFULL\n\nAction Required:\nAdd new node`
          : `⚠️ Node Alert\n\nNode:\n${node.name}\n\n${check.label}:\n${check.value.toFixed(1)}%\n\nAction:\nProvisioning will avoid this node when possible.`,
        nodeId: node.id,
        severity: check.value >= 95 ? "critical" : "warning",
        metadata: { value: check.value, threshold: check.threshold, metric: check.key },
      }).catch(() => null)
    } else {
      await resolveAlert(dedupeKey)
      await resolveCapacityAlert(`node:${node.id}:${check.key}:whatsapp`).catch(() => null)
    }
  }
  if (metric.health === "connected") await resolveAlert(`node:${node.id}:offline`)
}

export async function collectNodeTelemetry(node: DbNode) {
  const started = Date.now()
  const client = createProxmoxClient(normalizeProxmoxHost(node.host), node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_METRICS_TIMEOUT_MS,
    logRequests: false,
  })

  try {
    const [status, storageRows, qemuRows, lxcRows, taskRows, sensorRows, rrdRows] = await Promise.all([
      client.getNodeStats(node.nodeName),
      client.getNodeStorage(node.nodeName).catch(() => []),
      client.getVMList(node.nodeName).catch(() => []),
      client.getLxcList(node.nodeName).catch(() => []),
      client.safeGet<any[]>(`/nodes/${encodeURIComponent(node.nodeName)}/tasks?limit=50`).catch(() => []),
      client.safeGet<any>(`/nodes/${encodeURIComponent(node.nodeName)}/sensors`).catch(() => null),
      client.getNodeRrdData(node.nodeName, "hour").catch(() => []),
    ])

    const guests: any[] = [...(Array.isArray(qemuRows) ? qemuRows : []), ...(Array.isArray(lxcRows) ? lxcRows : [])]
    const runningVms = guests.filter((guest) => String(guest?.status || "") === "running" && !Number(guest?.template || 0)).length
    const stoppedVms = guests.filter((guest) => String(guest?.status || "") === "stopped" && !Number(guest?.template || 0)).length
    const load = loadParts(status?.loadavg)
    const storage: any[] = Array.isArray(storageRows) ? storageRows : []
    const storageUsed = sumBy(storage, "used")
    const storageFree = storage.reduce((sum, row) => sum + numberValue(row?.avail ?? row?.free), 0)
    const rootDiskUsage = percent(status?.rootfs?.used, status?.rootfs?.total)
    const ramUsage = percent(status?.memory?.used, status?.memory?.total)
    const cpuUsage = cpuPercent(status?.cpu)
    const tasks = taskCounts(Array.isArray(taskRows) ? taskRows : [])
    const counterInput = {
      at: Date.now(),
      networkIn: numberValue(status?.netin),
      networkOut: numberValue(status?.netout),
      diskRead: numberValue(status?.diskread),
      diskWrite: numberValue(status?.diskwrite),
    }
    const rates = throughput(node.id, counterInput)
    const rrdNetwork = latestRrdNetworkRate(rrdRows)
    const statusHasNetworkCounters = status?.netin != null || status?.netout != null
    const networkRates = statusHasNetworkCounters ? rates : {
      ...rates,
      networkIn: rrdNetwork?.networkIn || 0,
      networkOut: rrdNetwork?.networkOut || 0,
    }
    const health = classifyHealth({
      reachable: true,
      cpuUsage,
      memoryUsage: ramUsage,
      diskUsage: rootDiskUsage,
      storageUsages: storage.map((row) => percent(row?.used, row?.total)),
      storageIssue: storage.some((row) => row?.active === 0 || row?.enabled === 0),
    })

    const metric = {
      nodeId: node.id,
      cpuUsage,
      ramUsage,
      diskUsage: rootDiskUsage,
      diskRead: BigInt(rates.diskRead),
      diskWrite: BigInt(rates.diskWrite),
      networkIn: BigInt(networkRates.networkIn),
      networkOut: BigInt(networkRates.networkOut),
      load1: load[0],
      load5: load[1],
      load15: load[2],
      uptime: BigInt(Math.max(0, Math.floor(numberValue(status?.uptime)))),
      runningVms,
      stoppedVms,
      storageUsed: BigInt(Math.max(0, Math.floor(storageUsed))),
      storageFree: BigInt(Math.max(0, Math.floor(storageFree))),
      temperature: extractTemperature(sensorRows),
      latencyMs: Date.now() - started,
      activeTasks: tasks.active,
      taskQueue: tasks.queued,
      health: health.status,
      metadata: {
        nodeName: node.nodeName,
        host: node.host,
        cpuCores: numberValue(status?.cpuinfo?.cpus),
        memoryTotalBytes: numberValue(status?.memory?.total),
        memoryUsedBytes: numberValue(status?.memory?.used),
        memoryFreeBytes: Math.max(0, numberValue(status?.memory?.total) - numberValue(status?.memory?.used)),
        storageTotal: storageUsed + storageFree,
        networkSource: statusHasNetworkCounters ? "node_status_counter" : rrdNetwork ? "proxmox_rrd" : "unavailable",
        networkSampleAt: rrdNetwork?.recordedAt || null,
      },
      recordedAt: new Date(),
    }

    const serializedMetric = serializeMetric(metric)
    const previous = persistedMetrics.get(node.id)
    const meaningfulChange = !previous || previous.health !== metric.health || previous.runningVms !== runningVms || previous.stoppedVms !== stoppedVms || Math.abs(previous.cpuUsage - cpuUsage) >= 5 || Math.abs(previous.ramUsage - ramUsage) >= 2 || Math.abs(previous.diskUsage - rootDiskUsage) >= 2
    if (!previous || meaningfulChange || Date.now() - previous.at >= METRIC_PERSIST_MS) {
      await (prisma as any).nodeMetric.create({ data: metric })
      persistedMetrics.set(node.id, { at: Date.now(), health: metric.health, cpuUsage, ramUsage, diskUsage: rootDiskUsage, runningVms, stoppedVms })
    }
    await publishRealtimeEvent(realtimeChannels.nodeMetric(node.id), serializedMetric).catch(() => null)
    await publishTaskEvents(node, Array.isArray(taskRows) ? taskRows : []).catch(() => null)
    await prisma.proxmoxNode.update({
      where: { id: node.id },
      data: { status: health.status, lastCheckedAt: new Date() },
    }).catch(() => null)
    await evaluateAlerts(metric, node)
    return metric
  } catch (error) {
    const message = safeMonitoringError(error)
    await prisma.proxmoxNode.update({
      where: { id: node.id },
      data: { status: "failed", lastCheckedAt: new Date() },
    }).catch(() => null)
    await upsertAlert({
      dedupeKey: `node:${node.id}:offline`,
      alertType: "node_offline",
      severity: "critical",
      title: `${node.name} offline`,
      message,
      nodeId: node.id,
      metadata: { nodeName: node.nodeName },
    })
    await (prisma as any).auditEvent.create({
      data: {
        eventType: "telemetry.node_failed",
        severity: "ERROR",
        nodeId: node.id,
        reason: message,
        status: "FAILED",
        metadataJson: { nodeName: node.nodeName },
      },
    }).catch(() => null)
    throw error
  }
}

function extractTemperature(sensorRows: any): number | null {
  const values: number[] = []
  const visit = (value: any) => {
    if (value == null) return
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 150) values.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (/temp|temperature/i.test(key)) visit(entry)
        else if (typeof entry === "object") visit(entry)
      }
    }
  }
  visit(sensorRows)
  return values.length ? Math.max(...values) : null
}

export function serializeMetric(metric: any) {
  if (!metric) return null
  return {
    ...metric,
    diskRead: Number(metric.diskRead || 0),
    diskWrite: Number(metric.diskWrite || 0),
    networkIn: Number(metric.networkIn || 0),
    networkOut: Number(metric.networkOut || 0),
    uptime: Number(metric.uptime || 0),
    storageUsed: Number(metric.storageUsed || 0),
    storageFree: Number(metric.storageFree || 0),
    recordedAt: metric.recordedAt?.toISOString ? metric.recordedAt.toISOString() : metric.recordedAt,
  }
}

export async function latestNodeMetric(nodeId: string) {
  const metric = await (prisma as any).nodeMetric.findFirst({
    where: { nodeId },
    orderBy: { recordedAt: "desc" },
  })
  return serializeMetric(metric)
}

export async function runTelemetryRetention(now = new Date()) {
  const rawCutoff = new Date(now.getTime() - RAW_RETENTION_DAYS * 86400_000)
  const analyticsCutoff = new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86400_000)
  const logsCutoff = new Date(now.getTime() - LOG_RETENTION_DAYS * 86400_000)
  await Promise.all([
    (prisma as any).nodeMetric.deleteMany({ where: { recordedAt: { lt: rawCutoff } } }).catch(() => null),
    (prisma as any).analyticsEvent.deleteMany({ where: { createdAt: { lt: analyticsCutoff } } }).catch(() => null),
    (prisma as any).analyticsPageView.deleteMany({ where: { createdAt: { lt: analyticsCutoff } } }).catch(() => null),
    prisma.panelLog.deleteMany({ where: { timestamp: { lt: logsCutoff } } }).catch(() => null),
  ])
}

export async function evaluateSystemHealthAlerts() {
  const stuckSince = new Date(Date.now() - 30 * 60 * 1000)
  const [failedProvisioning, paymentFailures, stuckQueue] = await Promise.all([
    prisma.provisioningJob.count({ where: { status: "failed", updatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } } }).catch(() => 0),
    prisma.paymentAttempt.count({ where: { status: { in: ["failed", "error"] }, updatedAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } } }).catch(() => 0),
    prisma.provisioningJob.count({ where: { status: "queued", createdAt: { lt: stuckSince } } }).catch(() => 0),
  ])

  if (failedProvisioning > 0) {
    await upsertAlert({
      dedupeKey: "provisioning:failed_recent",
      alertType: "failed_provisioning",
      severity: "critical",
      title: "Provisioning failures detected",
      message: `${failedProvisioning} provisioning job(s) failed recently.`,
      metadata: { failedProvisioning },
    })
  } else {
    await resolveAlert("provisioning:failed_recent")
  }

  if (paymentFailures > 0) {
    await upsertAlert({
      dedupeKey: "payments:failed_recent",
      alertType: "payment_failures",
      severity: "warning",
      title: "Payment failures detected",
      message: `${paymentFailures} payment attempt(s) failed recently.`,
      metadata: { paymentFailures },
    })
  } else {
    await resolveAlert("payments:failed_recent")
  }

  if (stuckQueue > 0) {
    await upsertAlert({
      dedupeKey: "provisioning:queue_stuck",
      alertType: "queue_stuck",
      severity: "warning",
      title: "Provisioning queue stuck",
      message: `${stuckQueue} provisioning job(s) have been queued for more than 30 minutes.`,
      queueName: "provisioning",
      metadata: { stuckQueue },
    })
  } else {
    await resolveAlert("provisioning:queue_stuck")
  }
}

export async function aggregateNodeMetricsHourly(now = new Date()) {
  const end = new Date(now)
  end.setMinutes(0, 0, 0)
  const start = new Date(end.getTime() - 3600_000)
  const nodes = await prisma.proxmoxNode.findMany({ where: { isActive: true }, select: { id: true } })
  for (const node of nodes) {
    const rows = await (prisma as any).nodeMetric.findMany({
      where: { nodeId: node.id, recordedAt: { gte: start, lt: end } },
    })
    if (!rows.length) continue
    const avg = (key: string) => rows.reduce((sum: number, row: any) => sum + numberValue(row[key]), 0) / rows.length
    const max = (key: string) => Math.max(...rows.map((row: any) => numberValue(row[key])))
    const sumBig = (key: string) => rows.reduce((sum: bigint, row: any) => sum + BigInt(row[key] || 0), BigInt(0))
    await (prisma as any).nodeMetricHourly.upsert({
      where: { nodeId_bucketAt: { nodeId: node.id, bucketAt: start } },
      update: {
        samples: rows.length,
        cpuAvg: avg("cpuUsage"),
        cpuMax: max("cpuUsage"),
        ramAvg: avg("ramUsage"),
        ramMax: max("ramUsage"),
        diskAvg: avg("diskUsage"),
        diskMax: max("diskUsage"),
        networkInSum: sumBig("networkIn"),
        networkOutSum: sumBig("networkOut"),
        diskReadSum: sumBig("diskRead"),
        diskWriteSum: sumBig("diskWrite"),
        runningVmsAvg: avg("runningVms"),
        stoppedVmsAvg: avg("stoppedVms"),
      },
      create: {
        nodeId: node.id,
        bucketAt: start,
        samples: rows.length,
        cpuAvg: avg("cpuUsage"),
        cpuMax: max("cpuUsage"),
        ramAvg: avg("ramUsage"),
        ramMax: max("ramUsage"),
        diskAvg: avg("diskUsage"),
        diskMax: max("diskUsage"),
        networkInSum: sumBig("networkIn"),
        networkOutSum: sumBig("networkOut"),
        diskReadSum: sumBig("diskRead"),
        diskWriteSum: sumBig("diskWrite"),
        runningVmsAvg: avg("runningVms"),
        stoppedVmsAvg: avg("stoppedVms"),
      },
    })
  }
}
