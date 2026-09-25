import "dotenv/config"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"
import { publishRealtimeEvent, realtimeChannels } from "@/lib/realtime-telemetry"
import { writeStructuredLog } from "@/lib/structured-logger"

const INTERVAL_MS = Math.max(100, Math.min(1000, Number(process.env.PROXMOX_EVENT_WATCH_MS || 250)))
const TASK_LIMIT = Math.max(25, Number(process.env.PROXMOX_EVENT_TASK_LIMIT || 80))
const LOG_LIMIT = Math.max(25, Number(process.env.PROXMOX_EVENT_LOG_LIMIT || 80))
const seen = new Set<string>()
let firstTick = true
let stopping = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function eventType(task: any) {
  const text = `${task?.type || ""} ${task?.upid || ""} ${task?.id || ""}`.toLowerCase()
  if (/qmstart|start/.test(text)) return "qm start"
  if (/qmstop|qmshutdown|stop|shutdown/.test(text)) return "qm stop"
  if (/qmreboot|qmreset|reboot|reset/.test(text)) return "qm reboot"
  if (/qmmigrate|migrate/.test(text)) return "qm migrate"
  if (/qmdestroy|destroy|delete/.test(text)) return "qm destroy"
  if (/network|bridge|firewall|sdn|ipconfig|net\d/.test(text)) return "network change"
  return null
}

function taskKey(nodeId: string, task: any) {
  return `${nodeId}:${task?.upid || task?.starttime || ""}:${task?.type || ""}:${task?.id || ""}:${task?.status || ""}:${task?.exitstatus || ""}`
}

function taskTime(task: any) {
  const value = Number(task?.endtime || task?.starttime || 0)
  return value ? new Date(value * 1000).toISOString() : new Date().toISOString()
}

async function publishTask(node: any, task: any) {
  const type = eventType(task)
  if (!type) return
  const vmid = Number(task?.id || 0)
  const event = {
    source: "proxmox",
    event: type,
    nodeId: node.id,
    nodeName: node.nodeName,
    vmid: Number.isFinite(vmid) && vmid > 0 ? vmid : null,
    upid: task?.upid || null,
    status: task?.status || null,
    exitstatus: task?.exitstatus || null,
    createdAt: taskTime(task),
    publishedAt: new Date().toISOString(),
  }
  await publishRealtimeEvent(realtimeChannels.proxmoxEvents(), event).catch(() => null)
  await writeStructuredLog("proxmox-sync", "event", { nodeId: node.id, node: node.nodeName, vmid: event.vmid, eventType: type, response: event })

  if (!event.vmid) return
  const vps = await prisma.vpsInstance.findFirst({
    where: { proxmoxNodeId: node.id, vmid: event.vmid, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  }).catch(() => null)
  if (vps?.id) await publishLiveVmSnapshot(vps.id, `proxmox:${type}`).catch((error) => {
    void writeStructuredLog("proxmox-sync", "event_snapshot_failed", { nodeId: node.id, node: node.nodeName, vpsInstanceId: vps.id, vmid: event.vmid, eventType: type, error })
  })
}

async function tick() {
  const nodes = await prisma.proxmoxNode.findMany({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: 5000,
      logRequests: false,
      retries: 0,
    })
    const [tasks, logs] = await Promise.all([
      client.getNodeTasks(node.nodeName, TASK_LIMIT).catch((error) => {
        void writeStructuredLog("proxmox-sync", "tasks_failed", { nodeId: node.id, node: node.nodeName, error })
        return []
      }),
      client.getClusterLog(LOG_LIMIT).catch(() => []),
    ])
    for (const task of tasks) {
      const key = taskKey(node.id, task)
      if (seen.has(key)) continue
      seen.add(key)
      if (!firstTick) await publishTask(node, task)
    }
    for (const row of logs || []) {
      const text = `${row?.msg || row?.message || ""}`.toLowerCase()
      if (!/qm|qemu|network|bridge|firewall|migrate|destroy/.test(text)) continue
      const key = `${node.id}:log:${row?.time || ""}:${row?.n || ""}:${row?.msg || row?.message || ""}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!firstTick) {
        await publishRealtimeEvent(realtimeChannels.proxmoxEvents(), {
          source: "proxmox",
          event: /network|bridge|firewall/.test(text) ? "network change" : "cluster log",
          nodeId: node.id,
          nodeName: node.nodeName,
          message: row?.msg || row?.message || "",
          createdAt: row?.time ? new Date(Number(row.time) * 1000).toISOString() : new Date().toISOString(),
          publishedAt: new Date().toISOString(),
        }).catch(() => null)
      }
    }
    const nodeEvent = {
      id: `proxmox:node:${node.id}:${Date.now()}`,
      source: "proxmox",
      level: "info",
      event: "node metrics",
      message: `Node ${node.nodeName} watcher summary`,
      nodeId: node.id,
      nodeName: node.nodeName,
      taskCount: Array.isArray(tasks) ? tasks.length : 0,
      logCount: Array.isArray(logs) ? logs.length : 0,
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      metadata: {
        nodeId: node.id,
        nodeName: node.nodeName,
        taskCount: Array.isArray(tasks) ? tasks.length : 0,
        logCount: Array.isArray(logs) ? logs.length : 0,
      },
    }
    await Promise.all([
      publishRealtimeEvent(realtimeChannels.proxmoxEvents(), nodeEvent),
      publishRealtimeEvent(realtimeChannels.nodeLogs(node.id), nodeEvent),
    ]).catch(() => null)
    if (seen.size > 5000) {
      const keep = Array.from(seen).slice(-2500)
      seen.clear()
      for (const key of keep) seen.add(key)
    }
  }
  firstTick = false
}

async function main() {
  console.log("[proxmox-event-watcher] started", { intervalMs: INTERVAL_MS, taskLimit: TASK_LIMIT })
  while (!stopping) {
    const startedAt = Date.now()
    await tick().catch((error) => {
      console.error("[proxmox-event-watcher] tick failed", error)
      void writeStructuredLog("proxmox-sync", "watcher_tick_failed", { error })
    })
    await sleep(Math.max(100, INTERVAL_MS - (Date.now() - startedAt)))
  }
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main()
  .catch((error) => {
    console.error("[proxmox-event-watcher] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
