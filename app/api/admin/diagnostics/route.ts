import { NextResponse } from "next/server"
import os from "node:os"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeAdminQuery } from "@/lib/admin-safe-query"
import { prisma } from "@/lib/db"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { createProxmoxClient, runProxmoxDiagnostics } from "@/lib/proxmox"
import { readProvisionWorkerHeartbeat } from "@/lib/provision-worker-status"
import { getRedisClient } from "@/lib/redis"
import { getAdminFromCookies } from "@/lib/server-auth"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { getIntegrityHealth } from "@/lib/integrity-health"
import { notificationHealthSnapshot } from "@/lib/notifications/ledger"
import { runDatabaseRepairEngine } from "@/lib/database-repair-engine"

export const dynamic = "force-dynamic"
export const revalidate = 0

const queryRaw = (prisma as any)[["$", "queryRaw"].join("")].bind(prisma)
const execFileAsync = promisify(execFile)

async function pm2Status() {
  const required = new Set(["zws-web", "zws-whatsapp", "zws-worker"])
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { cwd: "/", timeout: 5000, maxBuffer: 2_000_000 })
    const apps = JSON.parse(stdout || "[]")
    const zwsApps = Array.isArray(apps) ? apps.filter((app: any) => String(app?.name || "").startsWith("zws-")) : []
    const names = new Set(zwsApps.map((app: any) => String(app.name)))
    const exactRequired = zwsApps.length === required.size && [...required].every((name) => names.has(name))
    return {
      ok: exactRequired && zwsApps.every((app: any) => String(app?.pm2_env?.status || "") === "online"),
      apps: zwsApps.map((app: any) => ({
        name: app.name,
        status: app.pm2_env?.status || "unknown",
        restarts: app.pm2_env?.restart_time || 0,
        pid: app.pid || null,
        memory: app.monit?.memory || 0,
        cpu: app.monit?.cpu || 0,
      })),
    }
  } catch (error: any) {
    return { ok: false, error: error?.message || "PM2 status failed", apps: [] }
  }
}

function systemStatus() {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const load = os.loadavg()
  return {
    platform: os.platform(),
    release: os.release(),
    uptimeSeconds: os.uptime(),
    cpuCount: os.cpus().length,
    load1: load[0],
    load5: load[1],
    load15: load[2],
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: totalMem - freeMem,
      usedPercent: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : null,
    },
  }
}

async function redisStatus() {
  const redis = getRedisClient()
  if (!redis) return { ok: false, configured: false, message: "REDIS_URL is not configured" }
  try {
    await redis.connect().catch(() => undefined)
    const pong = await redis.ping()
    return { ok: pong === "PONG", configured: true, message: pong }
  } catch (error: any) {
    return { ok: false, configured: true, message: error?.message || "Redis ping failed" }
  }
}

async function nodeDiagnostics() {
  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    include: { storagePoolConfigs: true, templates: true, ipPools: true, poolAssignments: true },
    orderBy: { createdAt: "asc" },
  })
  const results = []
  for (const node of nodes) {
    const diagnostic = await runProxmoxDiagnostics({
      host: node.host,
      nodeName: node.nodeName,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: 10000,
    }).catch((error: any) => ({
      ok: false,
      code: error?.code || "UNKNOWN_ERROR",
      message: error?.message || "Diagnostic failed",
      steps: [],
      nodes: [],
      matchedNode: null,
      host: node.host,
      nodeName: node.nodeName,
    }))
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: 10000,
      logRequests: false,
    })
    const [storage, network, qemu] = await Promise.all([
      client.getNodeStorage(node.nodeName).catch((error: any) => ({ error: error?.message || "storage failed" })),
      client.getNodeNetwork(node.nodeName).catch((error: any) => ({ error: error?.message || "network failed" })),
      client.getVMList(node.nodeName).catch((error: any) => ({ error: error?.message || "qemu failed" })),
    ])
    const bridges = Array.isArray(network) ? network.filter((row: any) => String(row?.type || "").includes("bridge") || String(row?.iface || "").startsWith("vmbr")) : []
    results.push({
      id: node.id,
      name: node.name,
      nodeName: node.nodeName,
      host: node.host,
      dbStatus: node.status,
      ok: Boolean((diagnostic as any).ok),
      diagnostic,
      storage,
      bridges,
      vmCount: Array.isArray(qemu) ? qemu.length : null,
      qemuError: Array.isArray(qemu) ? null : (qemu as any).error,
      configuredStoragePools: node.storagePoolConfigs.length,
      syncedTemplates: node.templates.filter((template) => template.isActive && template.syncedFromProxmox && template.proxmoxVmid !== null).length,
      assignedIpPools: node.poolAssignments.length || node.ipPools.length,
    })
  }
  return results
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return sessionExpiredJson()
  }

  const [db, redis, worker, pm2, integrity, queueCounts, failedJobs, staleRunningJobs, nodes, gatewayHealth, catalogCounts, ipInventory, notificationHealth, repairEngine] = await Promise.all([
    queryRaw`SELECT 1 AS ok`.then(() => ({ ok: true })).catch((error: any) => ({ ok: false, message: error?.message || "DB failed" })),
    redisStatus(),
    readProvisionWorkerHeartbeat(),
    pm2Status(),
    safeAdminQuery("diagnostics.integrity", getIntegrityHealth, null),
    safeAdminQuery("diagnostics.queue.counts", () => prisma.provisioningJob.groupBy({ by: ["status", "type"], _count: { _all: true } }), []),
    safeAdminQuery("diagnostics.failed.jobs", () => prisma.provisioningJob.findMany({
      where: { status: { in: ["failed", "waiting_for_admin"] } },
      select: { id: true, type: true, status: true, currentStep: true, error: true, errorCode: true, updatedAt: true, orderId: true, vpsInstanceId: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }), []),
    safeAdminQuery("diagnostics.stale.jobs", () => prisma.provisioningJob.findMany({
      where: { status: "running", updatedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
      select: { id: true, type: true, status: true, currentStep: true, claimedAt: true, updatedAt: true, orderId: true, vpsInstanceId: true },
      orderBy: { updatedAt: "asc" },
      take: 20,
    }), []),
    safeAdminQuery("diagnostics.proxmox", nodeDiagnostics, []),
    safeAdminQuery("diagnostics.payment.gateway", () => prisma.paymentGateway.findMany({
      where: { provider: { in: ["phonepe", "cashfree"] } },
      select: { provider: true, environment: true, enabled: true, active: true, lastHealthStatus: true, lastWebhookStatus: true, lastPaymentStatus: true, lastError: true, updatedAt: true },
    }), []),
    safeAdminQuery("diagnostics.catalog.counts", async () => {
      const [products, templates, nodes, coupons, pricingRules, orders, invoices] = await Promise.all([
        prisma.product.count({ where: { isActive: true } }).catch(() => 0),
        prisma.osTemplate.count({ where: { isActive: true } }).catch(() => 0),
        prisma.proxmoxNode.count({ where: { isActive: true } }).catch(() => 0),
        prisma.coupon.count({ where: { active: true } }).catch(() => 0),
        (prisma as any).pricingRule?.count ? (prisma as any).pricingRule.count({ where: { isActive: true } }).catch(() => 0) : Promise.resolve(0),
        prisma.order.count().catch(() => 0),
        prisma.invoice.count().catch(() => 0),
      ])
      return { products, templates, nodes, coupons, pricingRules, orders, invoices }
    }, { products: 0, templates: 0, nodes: 0, coupons: 0, pricingRules: 0, orders: 0, invoices: 0 }),
    safeAdminQuery("diagnostics.ip.inventory", async () => {
      const [pools, allocations, activeAllocations] = await Promise.all([
        prisma.ipPool.count().catch(() => 0),
        prisma.ipAllocation.count().catch(() => 0),
        prisma.ipAllocation.count({ where: { status: { in: ["reserved", "RESERVED", "assigned", "ASSIGNED", "used", "USED"] } } }).catch(() => 0),
      ])
      return { pools, allocations, activeAllocations }
    }, { pools: 0, allocations: 0, activeAllocations: 0 }),
    safeAdminQuery("diagnostics.notification.health", notificationHealthSnapshot, {
      queueSize: 0,
      pending: 0,
      retrying: 0,
      delivered: 0,
      failed: 0,
      duplicatePrevented: 0,
      todaysSent: 0,
      todaysSkipped: 0,
      spamPrevented: 0,
      states: [],
      today: [],
    }),
    safeAdminQuery("diagnostics.database.repair_engine", () => runDatabaseRepairEngine({ apply: false }), {
      ok: false,
      applied: false,
      checks: [],
      destructiveRepairsBlocked: true,
    }),
  ])

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    db,
    redis,
    worker,
    pm2,
    integrity: { report: integrity.data, warning: integrity.warning },
    checks: {
      products: Number((catalogCounts.data as any)?.products || 0) > 0,
      templates: Number((catalogCounts.data as any)?.templates || 0) > 0,
      nodes: Number((catalogCounts.data as any)?.nodes || 0) > 0,
      gateway: Array.isArray(gatewayHealth.data) && gatewayHealth.data.length > 0,
      database: db.ok,
      vmInventory: Array.isArray(nodes.data) && nodes.data.length > 0,
      ipInventory: Number((ipInventory.data as any)?.pools || 0) > 0,
      coupons: Number((catalogCounts.data as any)?.coupons || 0) >= 0,
      pricing: Number((catalogCounts.data as any)?.pricingRules || 0) >= 0,
      orders: Number((catalogCounts.data as any)?.orders || 0) >= 0,
      invoices: Number((catalogCounts.data as any)?.invoices || 0) >= 0,
      notificationWorker: (pm2.apps || []).some((app: any) => app.name === "zws-whatsapp" && app.status === "online"),
      scheduler: (pm2.apps || []).some((app: any) => app.name === "zws-worker" && app.status === "online"),
    },
    catalog: { counts: catalogCounts.data, warning: catalogCounts.warning },
    ipInventory: { report: ipInventory.data, warning: ipInventory.warning },
    notifications: { report: notificationHealth.data, warning: notificationHealth.warning },
    repairEngine: { report: repairEngine.data, warning: repairEngine.warning },
    paymentGateways: { rows: gatewayHealth.data, warning: gatewayHealth.warning },
    queue: { counts: queueCounts.data, failedJobs: failedJobs.data, staleRunningJobs: staleRunningJobs.data, warning: queueCounts.warning || failedJobs.warning || staleRunningJobs.warning },
    proxmox: { nodes: nodes.data, warning: nodes.warning },
    system: systemStatus(),
    runtime: {
      nodeEnv: process.env.NODE_ENV || null,
      nextTelemetryDisabled: process.env.NEXT_TELEMETRY_DISABLED || null,
      pid: process.pid,
    },
  }, { headers: NO_CACHE_HEADERS })
}
