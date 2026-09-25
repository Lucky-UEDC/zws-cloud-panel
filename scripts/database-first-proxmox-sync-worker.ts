import "dotenv/config"
import { prisma } from "@/lib/db"
import { runProductionVpsReconciliation } from "@/lib/production-vps-reconciliation"
import { getRedisClient } from "@/lib/redis"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.DATABASE_FIRST_PROXMOX_SYNC_INTERVAL_MS || 5 * 60 * 1000))
let stopping = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tick() {
  const startedAt = Date.now()
  const report = await runProductionVpsReconciliation({
    mode: "apply",
    scheduled: true,
    actor: "worker:database-first-proxmox-sync",
    reportPath: process.env.DATABASE_FIRST_PROXMOX_SYNC_REPORT || null,
  })
  console.log(JSON.stringify({
    worker: "database-first-proxmox-sync",
    scanned: report.scanned,
    repaired: report.repaired,
    ipsRepaired: report.ipsRepaired,
    monitoringRepaired: report.monitoringRepaired,
    diskRepaired: report.diskRepaired,
    networkRepaired: report.networkRepaired,
    activityErrorsCleared: report.activityErrorsCleared,
    missingVmsMarked: report.missingVmsMarked,
    vmsReconstructed: report.vmsReconstructed,
    ordersRepaired: report.ordersRepaired,
    customersRepaired: report.customersRepaired,
    billingRepaired: report.billingRepaired,
    dnsRepaired: report.dnsRepaired,
    provisioningIdentitiesRepaired: report.provisioningIdentitiesRepaired,
    duplicateVmsFound: report.duplicateVmsFound,
    duplicateIpsFound: report.duplicateIpsFound,
    inventoryScanned: report.inventoryScanned,
    orphanVmsQuarantined: report.orphanVmsQuarantined,
    identityMappingsRepaired: report.identityMappingsRepaired,
    remainingFailures: report.remainingFailures.length,
    durationMs: Date.now() - startedAt,
  }))
}

async function loop() {
  do {
    await tick().catch((error) => console.error("[database-first-proxmox-sync] tick failed", error))
    if (once) break
    await sleep(intervalMs)
  } while (!stopping)
}

process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })

loop()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
    await getRedisClient()?.quit().catch(() => undefined)
    if (once) process.exit(process.exitCode || 0)
  })
