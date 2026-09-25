import "dotenv/config"
import { prisma } from "@/lib/db"

const once = process.argv.includes("--once")
const intervalMs = Math.max(60_000, Number(process.env.IP_RECONCILIATION_INTERVAL_MS || 30 * 60 * 1000))
let stopping = false

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function reconcilePool(poolId: string) {
  // Release orphan reservations: reserved/assigned but the linked VPS is deleted/terminated
  const orphans = await prisma.ipAllocation.findMany({
    where: {
      poolId,
      status: { in: ["reserved", "RESERVED", "assigned", "ASSIGNED"] },
      vpsInstanceId: { not: null },
    },
    select: {
      id: true,
      ipAddress: true,
      vpsInstanceId: true,
      vpsInstance: {
        select: { id: true, status: true },
      },
    },
  })

  const deadStatuses = new Set(["DELETED", "TERMINATED", "CANCELLED", "CANCELED", "deleted", "terminated", "cancelled", "canceled"])
  const orphanIds: string[] = []
  for (const alloc of orphans) {
    if (!alloc.vpsInstance || deadStatuses.has(String(alloc.vpsInstance.status || ""))) {
      orphanIds.push(alloc.id)
    }
  }

  if (orphanIds.length) {
    await prisma.ipAllocation.updateMany({
      where: { id: { in: orphanIds } },
      data: { status: "released", releasedAt: new Date(), vpsInstanceId: null, vmid: null },
    })
    console.log(`[ip-reconciliation] Released ${orphanIds.length} orphan allocations in pool ${poolId}`)
  }

  // Also release reservations with no vpsInstanceId that are older than 30 minutes (stuck provisioning)
  const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000)
  const stuckOrphans = await prisma.ipAllocation.updateMany({
    where: {
      poolId,
      status: { in: ["reserved", "RESERVED"] },
      vpsInstanceId: null,
      updatedAt: { lt: stuckCutoff },
    },
    data: { status: "released", releasedAt: new Date() },
  })
  if (stuckOrphans.count) {
    console.log(`[ip-reconciliation] Released ${stuckOrphans.count} stuck reservations in pool ${poolId}`)
  }

  return orphanIds.length + stuckOrphans.count
}

async function tick() {
  const pools = await prisma.ipPool.findMany({ select: { id: true, name: true } })
  let totalReleased = 0
  for (const pool of pools) {
    try {
      const released = await reconcilePool(pool.id)
      totalReleased += released
    } catch (error) {
      console.error(`[ip-reconciliation] Error reconciling pool ${pool.id}:`, error instanceof Error ? error.message : error)
    }
  }
  console.log(`[ip-reconciliation] Completed. Released ${totalReleased} total allocations across ${pools.length} pools.`)
}

async function main() {
  console.log("[ip-reconciliation] started", { once, intervalMs })
  do {
    await tick().catch((error) => {
      console.error("[ip-reconciliation] failed", error instanceof Error ? error.message : error)
    })
    if (!once && !stopping) await sleep(intervalMs)
  } while (!once && !stopping)
  await prisma.$disconnect()
}

process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })

main().catch((error) => {
  console.error("[ip-reconciliation] fatal error", error)
  process.exit(1)
})
