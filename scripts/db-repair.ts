import "dotenv/config"
import { prisma } from "@/lib/db"

const DRY_RUN = process.argv.includes("--dry-run")
const VERBOSE = process.argv.includes("--verbose")

function log(message: string, data?: unknown) {
  if (VERBOSE || !message.startsWith("[skip]")) console.log(message, data !== undefined ? data : "")
}

function dryLog(action: string, data?: unknown) {
  console.log(`[dry-run] ${action}`, data !== undefined ? data : "")
}

async function fixDuplicateIpAllocations() {
  console.log("\n=== 1. Duplicate IP Allocations ===")
  const duplicates = await prisma.$queryRaw<{ ipAddress: string; count: bigint }[]>`
    SELECT "ip_address" AS "ipAddress", COUNT(*) AS count
    FROM "ip_allocations"
    WHERE status IN ('used', 'reserved')
    GROUP BY "ip_address"
    HAVING COUNT(*) > 1
  `
  console.log(`Found ${duplicates.length} duplicate IPs`)
  let fixed = 0
  for (const { ipAddress } of duplicates) {
    const allocs = await prisma.ipAllocation.findMany({
      where: { ipAddress, status: { in: ["used", "reserved"] } },
      orderBy: { updatedAt: "desc" },
    })
    const [keep, ...dupes] = allocs
    log(`[dup] ${ipAddress}: keeping ${keep.id}, releasing ${dupes.length} duplicates`)
    for (const dupe of dupes) {
      if (DRY_RUN) { dryLog("release duplicate", { id: dupe.id, ipAddress }) ; continue }
      await prisma.ipAllocation.update({
        where: { id: dupe.id },
        data: { status: "free", vpsInstanceId: null, vmid: null, releasedAt: new Date() },
      })
      fixed++
    }
  }
  console.log(`Fixed: ${fixed} duplicate allocations released`)
}

async function fixOrphanIpAllocations() {
  console.log("\n=== 2. Orphan IP Allocations ===")
  const orphans = await prisma.ipAllocation.findMany({
    where: {
      status: { in: ["used", "reserved"] },
      vpsInstanceId: { not: null },
    },
    include: { vpsInstance: { select: { id: true, deletedAt: true } } },
  })
  const orphanedAllocations = orphans.filter(
    (a) => !a.vpsInstance || a.vpsInstance.deletedAt !== null
  )
  console.log(`Found ${orphanedAllocations.length} orphan allocations`)
  let fixed = 0
  for (const alloc of orphanedAllocations) {
    log(`[orphan] ${alloc.ipAddress} (vpsId=${alloc.vpsInstanceId}, deleted=${alloc.vpsInstance?.deletedAt})`)
    if (DRY_RUN) { dryLog("release orphan", { id: alloc.id, ipAddress: alloc.ipAddress }) ; continue }
    await prisma.ipAllocation.update({
      where: { id: alloc.id },
      data: { status: "free", vpsInstanceId: null, vmid: null, releasedAt: new Date() },
    })
    fixed++
  }
  console.log(`Fixed: ${fixed} orphan allocations released`)
}

async function fixBrokenVmRecords() {
  console.log("\n=== 3. Broken VM Records ===")
  const activeStatuses = ["ACTIVE", "PROVISIONING", "REINSTALLING", "UPGRADING", "PENDING", "REPAIR_NEEDED", "START_FAILED", "STOPPED"]
  const broken = await prisma.vpsInstance.findMany({
    where: {
      status: { in: activeStatuses },
      deletedAt: { not: null },
    },
    select: { id: true, status: true, deletedAt: true, vmid: true },
  })
  console.log(`Found ${broken.length} broken VM records (active status + deletedAt set)`)
  let fixed = 0
  for (const vm of broken) {
    log(`[broken-vm] ${vm.id}: status=${vm.status}, deletedAt=${vm.deletedAt}`)
    if (DRY_RUN) { dryLog("mark DELETED", { id: vm.id, status: vm.status }) ; continue }
    await prisma.vpsInstance.update({
      where: { id: vm.id },
      data: { status: "DELETED" },
    })
    fixed++
  }
  console.log(`Fixed: ${fixed} broken VM records marked DELETED`)
}

async function fixStaleProvisioningJobs() {
  console.log("\n=== 4. Stuck Provisioning Jobs ===")
  const staleThreshold = new Date(Date.now() - 4 * 60 * 60 * 1000) // 4 hours
  const staleJobs = await prisma.provisioningJob.findMany({
    where: {
      status: "running",
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, currentStep: true, attempts: true, maxAttempts: true, updatedAt: true },
  })
  console.log(`Found ${staleJobs.length} stuck running provisioning jobs (>4h stale)`)
  let failed = 0
  let reset = 0
  for (const job of staleJobs) {
    const attempts = Number(job.attempts || 0)
    const maxAttempts = Number(job.maxAttempts || 3)
    log(`[stuck-job] ${job.id}: step=${job.currentStep}, attempts=${attempts}/${maxAttempts}, updatedAt=${job.updatedAt}`)
    if (DRY_RUN) { dryLog("reset/fail job", { id: job.id, attempts }) ; continue }
    if (attempts >= maxAttempts) {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          currentStep: "FAILED",
          errorCode: "DB_REPAIR_STALE_MAX_RETRIES",
          error: "Job was stuck in running state and exceeded max retries during DB repair.",
          completedAt: new Date(),
        },
      })
      failed++
    } else {
      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: {
          status: "retrying",
          errorCode: "DB_REPAIR_STALE_RECOVERED",
          error: "Job was stuck in running state; reset to retry queue by DB repair script.",
          claimedAt: null,
          nextRetryAt: new Date(Date.now() + 60_000),
        },
      })
      reset++
    }
  }
  console.log(`Fixed: ${failed} jobs marked failed, ${reset} jobs reset to retry queue`)
}

async function fixStaleVmDeletionJobs() {
  console.log("\n=== 5. Stuck VM Deletion Jobs ===")
  const staleThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours
  const deletionModel = (prisma as any).vmDeletionJob
  const staleJobs = await deletionModel.findMany({
    where: {
      status: { notIn: ["deleted", "delete_failed"] },
      nextRetryAt: null,
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, status: true, attempts: true, maxAttempts: true, updatedAt: true },
  })
  console.log(`Found ${staleJobs.length} stuck VM deletion jobs (>2h stale)`)
  let reset = 0
  for (const job of staleJobs) {
    log(`[stuck-deletion] ${job.id}: status=${job.status}, attempts=${job.attempts}, updatedAt=${job.updatedAt}`)
    if (DRY_RUN) { dryLog("reset deletion job", { id: job.id }) ; continue }
    await deletionModel.update({
      where: { id: job.id },
      data: {
        status: "delete_requested",
        nextRetryAt: new Date(Date.now() + 60_000),
        lastError: "Reset by DB repair: was stuck without retry timestamp",
      },
    })
    reset++
  }
  console.log(`Fixed: ${reset} VM deletion jobs reset`)
}

async function reportMissingMetrics() {
  console.log("\n=== 6. VMs with Missing Recent Metrics ===")
  const threshold = new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours
  const activeVms = await prisma.vpsInstance.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, vmid: true },
  })
  let stale = 0
  for (const vm of activeVms) {
    const latest = await prisma.vpsMetric.findFirst({
      where: { vpsInstanceId: vm.id },
      orderBy: { recordedAt: "desc" },
      select: { recordedAt: true },
    })
    if (!latest || latest.recordedAt < threshold) {
      log(`[stale-metrics] VM ${vm.vmid} (${vm.name}): last metric at ${latest?.recordedAt || "never"}`)
      stale++
    }
  }
  console.log(`Report: ${stale}/${activeVms.length} active VMs have stale or missing metrics (>6h)`)
  console.log("  → Metrics will auto-recover on next telemetry poll. No action taken.")
}

async function main() {
  console.log(`DB Repair Script — ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE MODE"}`)
  console.log(`Verbose: ${VERBOSE}`)
  console.log("Starting repair checks...\n")

  await fixDuplicateIpAllocations()
  await fixOrphanIpAllocations()
  await fixBrokenVmRecords()
  await fixStaleProvisioningJobs()
  await fixStaleVmDeletionJobs()
  await reportMissingMetrics()

  console.log("\n=== DB Repair Complete ===")
  if (DRY_RUN) console.log("No changes were made (dry run). Re-run without --dry-run to apply fixes.")
}

main()
  .catch((error) => {
    console.error("DB repair failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
