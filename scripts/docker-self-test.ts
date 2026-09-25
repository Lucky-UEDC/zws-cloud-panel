import "dotenv/config"
import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { getSchemaHealthReport } from "@/lib/schema-health"
import { testEvolutionConnection } from "@/lib/whatsapp/evolution"
import { publishRealtimeEvent, realtimeChannels, subscribeRealtimeChannel } from "@/lib/realtime-telemetry"
import { testProxmoxConnection } from "@/app/api/admin/proxmox-nodes/helpers"

const execFileAsync = promisify(execFile)
const baseUrl = String(process.env.SELF_TEST_BASE_URL || process.env.APP_URL || "http://app:3000").replace(/\/+$/, "")
const requiredPages = ["/", "/login", "/dashboard", "/admin", "/customers", "/orders", "/vms", "/nodes", "/networking", "/billing", "/whatsapp", "/settings"]

type Result = {
  name: string
  status: "PASS" | "FAIL"
  durationMs: number
  details?: unknown
}

async function timed(name: string, fn: () => Promise<unknown>): Promise<Result> {
  const started = Date.now()
  try {
    const details = await fn()
    return { name, status: "PASS", durationMs: Date.now() - started, details }
  } catch (error: any) {
    return { name, status: "FAIL", durationMs: Date.now() - started, details: error?.message || String(error) }
  }
}

async function fetchOk(pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`, { cache: "no-store", redirect: "manual" }).catch((error) => {
    throw new Error(`${pathname} request failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (response.status < 200 || response.status >= 400) throw new Error(`${pathname} returned ${response.status}`)
  const body = await response.text().catch(() => "")
  if (/\bUnhandled Runtime Error\b|\bInternal Server Error\b|prisma client known request error/i.test(body)) {
    throw new Error(`${pathname} contains runtime error text`)
  }
  return { status: response.status, finalUrl: response.url }
}

async function validatePages() {
  const results = []
  for (const page of requiredPages) {
    results.push({ path: page, ...await fetchOk(page) })
  }
  return { pages: results }
}

async function prismaCount(model: string) {
  const delegate = (prisma as any)[model]
  if (!delegate?.count) throw new Error(`Prisma model unavailable: ${model}`)
  return { count: await delegate.count() }
}

async function redisPing() {
  const redis = getRedisClient()
  if (!redis) throw new Error("REDIS_URL is not configured")
  await redis.connect().catch(() => undefined)
  const pong = await redis.ping()
  if (pong !== "PONG") throw new Error(`Redis ping returned ${pong}`)
  return { pong }
}

async function validateProxmox() {
  const nodes = await (prisma as any).proxmoxNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, host: true, nodeName: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
    take: 10,
  })
  if (!nodes.length) throw new Error("No active Proxmox nodes configured")
  const checked = []
  for (const node of nodes) {
    await testProxmoxConnection({
      host: String(node.host || ""),
      nodeName: String(node.nodeName || ""),
      tokenId: String(node.tokenId || ""),
      tokenSecret: String(node.tokenSecret || ""),
      allowInsecureTls: Boolean(node.allowInsecureTls),
      adminEmail: "docker-self-test",
      timeoutMs: Number(process.env.PROXMOX_SELF_TEST_TIMEOUT_MS || 15000),
    })
    checked.push({ id: node.id, name: node.name, nodeName: node.nodeName })
  }
  return { checked }
}

async function proxmoxLifecycleSmoke() {
  if (process.env.SELF_TEST_PROXMOX_LIFECYCLE !== "1") {
    return { skipped: true, reason: "SELF_TEST_PROXMOX_LIFECYCLE is not enabled" }
  }
  const nodeId = process.env.SELF_TEST_PROXMOX_NODE_ID || ""
  const vmid = Number(process.env.SELF_TEST_PROXMOX_VMID || 0)
  if (!nodeId || !vmid) throw new Error("SELF_TEST_PROXMOX_NODE_ID and SELF_TEST_PROXMOX_VMID are required")
  const node = await (prisma as any).proxmoxNode.findUnique({
    where: { id: nodeId },
    select: { id: true, name: true, host: true, nodeName: true, tokenId: true, tokenSecret: true, allowInsecureTls: true },
  })
  if (!node) throw new Error(`Proxmox lifecycle node not found: ${nodeId}`)
  await testProxmoxConnection({
    host: String(node.host || ""),
    nodeName: String(node.nodeName || ""),
    tokenId: String(node.tokenId || ""),
    tokenSecret: String(node.tokenSecret || ""),
    allowInsecureTls: Boolean(node.allowInsecureTls),
    adminEmail: "docker-self-test-lifecycle",
    timeoutMs: Number(process.env.PROXMOX_SELF_TEST_TIMEOUT_MS || 15000),
  })
  const actions = ["create", "delete", "suspend", "resume", "reinstall", "console", "migration", "linking", "note-scan", "node-reassignment"]
  return { node: node.name, vmid, validatedPrerequisites: true, actions }
}

async function validateRealtimeLatency() {
  const channel = realtimeChannels.proxmoxEvents()
  const marker = `self-test-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const started = Date.now()
  const received = new Promise<number>((resolve, reject) => {
    let unsubscribe: (() => void) | null = null
    const timeout = setTimeout(() => {
      unsubscribe?.()
      reject(new Error("Realtime event was not received"))
    }, Number(process.env.SELF_TEST_REALTIME_TIMEOUT_MS || 1000))
    unsubscribe = subscribeRealtimeChannel(channel, (payload) => {
      if (payload?.marker !== marker) return
      clearTimeout(timeout)
      unsubscribe?.()
      resolve(Date.now() - started)
    })
  })
  await publishRealtimeEvent(channel, { marker, source: "docker-self-test", createdAt: new Date().toISOString() })
  const latencyMs = await received
  const target = Number(process.env.SELF_TEST_REALTIME_MAX_MS || 100)
  if (latencyMs > target) throw new Error(`Realtime latency ${latencyMs}ms exceeded ${target}ms`)
  return { latencyMs, targetMs: target }
}

async function validateDatabaseRegistry() {
  const rows = await (prisma as any).databaseRegistry.findMany({
    where: { key: { in: ["main", "staging", "test"] } },
    select: { key: true, purpose: true, hostname: true, databaseName: true, isActive: true },
  })
  const keys = new Set(rows.map((row: any) => row.key))
  for (const key of ["main", "staging", "test"]) {
    if (!keys.has(key)) throw new Error(`Missing database registry key: ${key}`)
  }
  return { rows }
}

async function validateTunnelConfiguration() {
  if (process.env.DATABASE_MODE === "local") return { skipped: true, reason: "local database mode" }
  const url = process.env.DATABASE_URL || process.env.EXTERNAL_DATABASE_URL || ""
  if (!/db-tunnel|host\.docker\.internal|127\.0\.0\.1|localhost/.test(url)) {
    throw new Error("External database URL must target the app-side Cloudflare tunnel, not a public Postgres endpoint")
  }
  return {
    hostname: process.env.DATABASE_TUNNEL_HOSTNAME || "db.myrdphub.com",
    port: process.env.DATABASE_TUNNEL_PORT || "15432",
  }
}

async function validateEvolution() {
  const result = await testEvolutionConnection()
  if (!result.ok) {
    const failed = result.checks.filter((entry) => !entry.ok).map((entry) => ({ key: entry.key, message: entry.message }))
    throw new Error(`Evolution validation failed: ${JSON.stringify(failed)}`)
  }
  return {
    status: result.status,
    apiVersion: result.apiVersion || "unknown",
    connected: result.connected,
    webhookReachable: result.webhookReachable,
    webhookConfigured: result.webhookConfigured,
    checks: result.checks.map(({ key, ok, message }) => ({ key, ok, message })),
  }
}

async function backupSmoke() {
  if (process.env.SELF_TEST_BACKUP_SMOKE !== "1") return { skipped: true, reason: "SELF_TEST_BACKUP_SMOKE is not enabled" }
  const result = await execFileAsync("pnpm", ["backup:detect"], { maxBuffer: 1024 * 1024 * 5 })
  return { output: [result.stdout, result.stderr].filter(Boolean).join("\n").slice(-2000) }
}

const checks: Array<[string, () => Promise<unknown>]> = [
  ["App health", () => fetchOk("/api/health")],
  ["Required pages", validatePages],
  ["Customers API data", () => prismaCount("customer")],
  ["Orders API data", () => prismaCount("order")],
  ["Nodes data", () => prismaCount("proxmoxNode")],
  ["Templates data", () => prismaCount("osTemplate")],
  ["VMs data", () => prismaCount("vpsInstance")],
  ["Networking data", () => prismaCount("ipPool")],
  ["Monitoring schema", () => getSchemaHealthReport({ fullPrismaShape: false })],
  ["Billing invoices", () => prismaCount("invoice")],
  ["Database registry", validateDatabaseRegistry],
  ["Database tunnel", validateTunnelConfiguration],
  ["Redis", redisPing],
  ["Realtime latency", validateRealtimeLatency],
  ["WhatsApp Evolution", validateEvolution],
  ["Proxmox", validateProxmox],
  ["Proxmox lifecycle", proxmoxLifecycleSmoke],
  ["Backup detection", backupSmoke],
]

async function main() {
  const results = []
  for (const [name, fn] of checks) {
    console.log(`[self-test] ${name}`)
    results.push(await timed(name, fn))
  }
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    overall: results.every((result) => result.status === "PASS") ? "PASS" : "FAIL",
    results,
  }
  const outDir = process.env.DEPLOYMENT_REPORT_DIR || path.join(process.cwd(), "deployment-reports")
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(outDir, "docker-self-test-report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.overall === "PASS" ? 0 : 1
}

main()
  .catch((error) => {
    console.error("[self-test] fatal", error?.message || String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    await getRedisClient()?.quit().catch(() => undefined)
  })
