import "dotenv/config"
import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { recoverStaleProvisioningJobs } from "@/lib/provision"
import { formatSchemaHealthProblems, getSchemaHealthReport } from "@/lib/schema-health"
import { hostnameFromIp } from "@/lib/vm-hostname"

type RepairResult = {
  schemaOk: boolean
  appSettings: string[]
  redisKeysCleared: number
  staleProvisioning: unknown
  orphanProvisioningJobs: number
  missingHostnamesRepaired: number
  stuckReinstallLocksCleared: number
}

const runtimeDefaults: Array<{ key: string; group: string; value: unknown }> = [
  { key: "production.telemetry.node_poll_ms", group: "production", value: Number(process.env.NODE_TELEMETRY_POLL_MS || 30000) },
  { key: "production.telemetry.vm_poll_ms", group: "production", value: Number(process.env.VM_TELEMETRY_POLL_MS || 30000) },
  { key: "production.telemetry.vm_batch_size", group: "production", value: Number(process.env.VM_TELEMETRY_BATCH_SIZE || 500) },
  { key: "production.bandwidth.live_poll_ms", group: "production", value: Number(process.env.LIVE_BANDWIDTH_POLL_MS || 1000) },
  { key: "production.bandwidth.config_refresh_ms", group: "production", value: Number(process.env.LIVE_BANDWIDTH_CONFIG_REFRESH_MS || 30000) },
  { key: "production.bandwidth.vm_batch_size", group: "production", value: Number(process.env.LIVE_BANDWIDTH_VM_BATCH_SIZE || 500) },
  { key: "production.provisioning.auto_finalize", group: "production", value: true },
  { key: "production.templates.actions_enabled", group: "production", value: true },
  { key: "production.node.live_stats_enabled", group: "production", value: true },
]

async function assertSchemaHealthy() {
  const report = await getSchemaHealthReport({ fullPrismaShape: true })
  if (report.ok) return report
  const problems = formatSchemaHealthProblems(report)
  console.error("[repair-production-state] schema mismatch detected")
  for (const problem of problems) console.error(`- ${problem}`)
  throw new Error("Production schema is not safe to repair automatically. Run migrations or restore from backup before continuing.")
}

async function ensureRuntimeDefaults() {
  const written: string[] = []
  for (const item of runtimeDefaults) {
    await prisma.appSetting.upsert({
      where: { key: item.key },
      create: {
        key: item.key,
        group: item.group,
        value: item.value as any,
        isSecret: false,
        updatedBy: "repair-production-state",
      },
      update: {
        value: item.value as any,
        group: item.group,
        isSecret: false,
        updatedBy: "repair-production-state",
      },
    })
    written.push(item.key)
  }
  return written
}

async function clearStaleRuntimeRedisKeys() {
  const redis = getRedisClient()
  if (!redis) return 0
  const patterns = [
    "zws:*runtime*",
    "zws:*socket*",
    "zws:*websocket*",
    "zws:*telemetry*",
    "zws:*live-bandwidth*",
  ]
  let cleared = 0
  try {
    for (const pattern of patterns) {
      let cursor = "0"
      do {
        const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 250)
        cursor = nextCursor
        if (keys.length) {
          cleared += await redis.del(...keys)
        }
      } while (cursor !== "0")
    }
  } finally {
    await redis.quit().catch(() => undefined)
  }
  return cleared
}

async function repairOrphanProvisioningJobs() {
  const result = await prisma.provisioningJob.updateMany({
    where: {
      status: { in: ["queued", "retrying", "running"] },
      orderId: null,
      vpsInstanceId: null,
      createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
    },
    data: {
      status: "failed",
      currentStep: "FAILED",
      displayStatus: "Repair needed",
      errorCode: "ORPHAN_PROVISIONING_JOB",
      error: "Installer/update repair marked this provisioning job failed because it is not linked to an order or VM.",
      dedupeKey: null,
      completedAt: new Date(),
    },
  }).catch(() => ({ count: 0 }))
  return result.count
}

async function repairMissingHostnames() {
  const instances = await prisma.vpsInstance.findMany({
    where: { hostname: null, ipAddress: { not: null } },
    select: { id: true, ipAddress: true },
  })
  let repaired = 0
  for (const vps of instances) {
    if (!vps.ipAddress) continue
    const hostname = hostnameFromIp(vps.ipAddress)
    if (!hostname) continue
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { hostname } }).catch(() => null)
    repaired++
  }
  return repaired
}

async function repairStuckReinstallLocks() {
  const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000)
  const stuck = await prisma.vpsInstance.findMany({
    where: { reinstallLock: true, reinstallLockedAt: { lt: staleThreshold } },
    select: { id: true, reinstallLockedAt: true },
  })
  let cleared = 0
  for (const vps of stuck) {
    const activeJob = await prisma.provisioningJob.findFirst({
      where: { vpsInstanceId: vps.id, status: { in: ["queued", "retrying", "running"] }, type: "REINSTALL" },
      select: { id: true },
    })
    if (activeJob) continue
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { reinstallLock: false, reinstallLockedAt: null } }).catch(() => null)
    cleared++
  }
  return cleared
}

async function main() {
  console.info("[repair-production-state] starting")
  const schema = await assertSchemaHealthy()
  const appSettings = await ensureRuntimeDefaults()
  const staleProvisioning = await recoverStaleProvisioningJobs()
  const orphanProvisioningJobs = await repairOrphanProvisioningJobs()
  const redisKeysCleared = await clearStaleRuntimeRedisKeys()
  const missingHostnamesRepaired = await repairMissingHostnames()
  const stuckReinstallLocksCleared = await repairStuckReinstallLocks()

  const result: RepairResult = {
    schemaOk: schema.ok,
    appSettings,
    redisKeysCleared,
    staleProvisioning,
    orphanProvisioningJobs,
    missingHostnamesRepaired,
    stuckReinstallLocksCleared,
  }
  console.info("[repair-production-state] complete")
  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error("[repair-production-state] failed")
    console.error(error?.stack || error?.message || String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
