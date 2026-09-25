import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { safeAdminQuery } from "@/lib/admin-safe-query"
import { prisma } from "@/lib/db"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"
import { createProxmoxClient } from "@/lib/proxmox"
import { getRedisClient } from "@/lib/redis"
import { getSchemaHealthReport } from "@/lib/schema-health"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getWhatsAppRuntimeState } from "@/lib/whatsapp/diagnostics"
import { countRecoverableProvisioningOrders } from "@/lib/provisioning-order-recovery"

export const dynamic = "force-dynamic"
export const revalidate = 0

const queryRaw = (prisma as any)[["$", "queryRaw"].join("")].bind(prisma)

const execFileAsync = promisify(execFile)
const PM2_APPS = ["zws-web", "zws-whatsapp", "zws-worker"]

async function command(name: string, args: string[]) {
  try {
    const { stdout } = await execFileAsync(name, args, { timeout: 5000 })
    return stdout.trim()
  } catch (error: any) {
    return String(error?.stdout || error?.stderr || error?.message || "").trim()
  }
}

async function pm2Status() {
  const raw = await command("pm2", ["jlist"])
  let apps: any[] = []
  try {
    apps = JSON.parse(raw || "[]")
  } catch {
    apps = []
  }
  const byName = new Map(apps.map((app) => [String(app.name), app]))
  return PM2_APPS.map((name) => {
    const app = byName.get(name)
    return {
      service: name,
      active: app?.pm2_env?.status || "missing",
      enabled: "pm2-saved",
      pid: app?.pid || null,
      restarts: app?.pm2_env?.restart_time || 0,
      memory: app?.monit?.memory || 0,
      cpu: app?.monit?.cpu || 0,
    }
  })
}

async function proxmoxStatus() {
  const nodes = await prisma.proxmoxNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, nodeName: true, host: true, tokenId: true, tokenSecret: true, allowInsecureTls: true, status: true },
    orderBy: { createdAt: "asc" },
  })
  const rows = []
  for (const node of nodes) {
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs: 8000,
      logRequests: false,
    })
    const version = await client.getNodeVersion(node.nodeName).then(() => ({ ok: true })).catch((error: any) => ({ ok: false, error: error?.message || "Proxmox failed" }))
    rows.push({ id: node.id, name: node.name, nodeName: node.nodeName, host: node.host, dbStatus: node.status, ...version })
  }
  return rows
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

async function provisioningHealth() {
  const [templates, ipPools, storagePools, recoverableOrders] = await Promise.all([
    prisma.osTemplate.groupBy({ by: ["isActive"], _count: { _all: true } }).catch(() => []),
    (prisma as any).ipPool.groupBy({ by: ["isActive"], _count: { _all: true } }).catch(() => []),
    prisma.nodeStoragePoolConfig.groupBy({ by: ["enabled", "missingFromProxmox"], _count: { _all: true } }).catch(() => []),
    countRecoverableProvisioningOrders(),
  ])
  return { templates, ipPools, storagePools, recoverableOrders }
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401, headers: NO_CACHE_HEADERS })
  }

  const [db, schema, commit, workers, queue, proxmox, whatsapp, redis, provisioning] = await Promise.all([
    safeAdminQuery("prisma.connection", () => queryRaw`SELECT 1 AS ok`, []),
    safeAdminQuery("schema.health", () => getSchemaHealthReport({ fullPrismaShape: false }), null),
    command("git", ["rev-parse", "--short", "HEAD"]),
    pm2Status(),
    safeAdminQuery("queue.status", () => prisma.provisioningJob.groupBy({ by: ["status", "type"], _count: { _all: true } }), []),
    safeAdminQuery("proxmox.status", proxmoxStatus, []),
    safeAdminQuery("whatsapp.status", getWhatsAppRuntimeState, null),
    safeAdminQuery("redis.status", redisStatus, null),
    safeAdminQuery("provisioning.health", provisioningHealth, null),
  ])

  return NextResponse.json({
    success: true,
    checkedAt: new Date().toISOString(),
    prisma: {
      ok: !db.warning,
      warning: db.warning,
    },
    schema: schema.data,
    app: { commit },
    workers,
    redis: redis.data,
    queue: { rows: queue.data, warning: queue.warning },
    proxmox: { nodes: proxmox.data, warning: proxmox.warning },
    whatsapp: { runtime: whatsapp.data, warning: whatsapp.warning },
    provisioning: { ...(provisioning.data || {}), warning: provisioning.warning },
    diagnostics: {
      warnings: [db.warning, schema.warning, queue.warning, proxmox.warning, whatsapp.warning, redis.warning, provisioning.warning].filter(Boolean),
    },
  }, { headers: NO_CACHE_HEADERS })
}
