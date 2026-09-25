/**
 * Ops tool: reconcile a customer's backup usage against real inventory and
 * materialize the `backup_usage` row (Problem B backfill).
 *
 * Usage:
 *   tsx scripts/backfill-usage.ts [customerId]
 *   (no argument = every customer with a live VPS)
 *
 * This is the same canonical path the scheduler and the finalize hook use, made
 * runnable on demand for migrations/backfills. Never destructive: upserts the
 * atomic usage-{subscriptionId}-{YYYY-MM} row and materializes overage only
 * when the plan opts in.
 */
import { rebuildBackupUsage } from "@/lib/billing/entitlements"

async function main() {
  const customerId = process.argv[2] ? String(process.argv[2]).trim() : undefined
  const results = await rebuildBackupUsage({ customerId, persist: true })
  if (results.length === 0) {
    console.log("[backfill-usage] no customers matched")
    return
  }
  for (const result of results) {
    console.log(
      `[backfill-usage] customer=${result.customerId} backups=${result.after.backupCount} usedBytes=${result.after.usedBytes} corrected=${result.corrected} snapshot=${result.snapshotId ?? "n/a"} overage=${result.overageAmount ?? 0}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[backfill-usage] failed", error)
    process.exit(1)
  })