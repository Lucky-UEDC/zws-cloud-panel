import "dotenv/config"
import { prisma } from "@/lib/db"
import { aggregateNodeMetricsHourly, collectNodeTelemetry, evaluateSystemHealthAlerts, runTelemetryRetention } from "@/lib/node-telemetry"

const POLL_MS = Math.max(30_000, Number(process.env.NODE_TELEMETRY_POLL_MS || 30_000))
const CONCURRENCY = Math.max(1, Number(process.env.NODE_TELEMETRY_CONCURRENCY || 2))

let stopping = false
let lastHourlyAt = 0
let lastRetentionAt = 0
let lastHealthAlertAt = 0

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!stopping) {
      const item = items[index++]
      if (!item) return
      await worker(item)
    }
  })
  await Promise.all(runners)
}

async function tick() {
  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      host: true,
      tokenId: true,
      tokenSecret: true,
      nodeName: true,
      allowInsecureTls: true,
    },
  })

  await mapLimit(nodes, CONCURRENCY, async (node) => {
    await collectNodeTelemetry(node).catch((error) => {
      console.error("[node-telemetry-worker] collection failed", {
        nodeId: node.id,
        nodeName: node.nodeName,
        message: error?.message || String(error),
      })
    })
  })

  const now = Date.now()
  if (now - lastHourlyAt > 3600_000) {
    lastHourlyAt = now
    await aggregateNodeMetricsHourly().catch((error) => {
      console.error("[node-telemetry-worker] hourly aggregation failed", { message: error?.message || String(error) })
    })
  }
  if (now - lastHealthAlertAt > 60_000) {
    lastHealthAlertAt = now
    await evaluateSystemHealthAlerts().catch((error) => {
      console.error("[node-telemetry-worker] system alert evaluation failed", { message: error?.message || String(error) })
    })
  }
  if (now - lastRetentionAt > 6 * 3600_000) {
    lastRetentionAt = now
    await runTelemetryRetention().catch((error) => {
      console.error("[node-telemetry-worker] retention failed", { message: error?.message || String(error) })
    })
  }
}

async function main() {
  console.log("[node-telemetry-worker] started", { pollMs: POLL_MS, concurrency: CONCURRENCY })
  while (!stopping) {
    const started = Date.now()
    await tick().catch((error) => {
      console.error("[node-telemetry-worker] tick failed", { message: error?.message || String(error) })
    })
    await sleep(Math.max(100, POLL_MS - (Date.now() - started)))
  }
}

process.on("SIGINT", () => { stopping = true })
process.on("SIGTERM", () => { stopping = true })

main()
  .catch((error) => {
    console.error("[node-telemetry-worker] fatal", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
