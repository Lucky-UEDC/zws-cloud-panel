import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

// Problem B: the 0/0 backup usage that had been displayed for a customer with
// 11 real completed backups was a display-path bug. The canonical fix is that
// usage MUST be reconciled against real inventory and materialized in the
// `backup_usage` table (which had never been written).

test("PART28 usage is reconciled from live completed backups, never browser state", () => {
  const lib = read("lib/billing/entitlements.ts")
  assert.match(lib, /export async function getCustomerBackupEntitlement\(customerId: string\)/)
  assert.match(lib, /computeBackupUsageSummary\(customerId/)
  assert.match(lib, /deletedAt: null/)
  // Completed backups are identified case-insensitively (live DB uses the
  // lowercase statuses "completed"/"success"; the old uppercase-only compare
  // counted 0 for every completed backup — the root cause of the 0/0 bug).
  assert.match(lib, /\["success", "completed"\]\.includes\(String\(backup\.status \|\| ""\)\.toLowerCase\(\)\)/)
})

test("PART28 rebuildBackupUsage upserts usage-{subscriptionId}-{YYYY-MM} keyed rows atomically", () => {
  const lib = read("lib/billing/entitlements.ts")
  assert.match(lib, /export async function rebuildBackupUsage\(options: RebuildBackupUsageOptions = \{\}\)/)
  assert.match(lib, /prisma\.backupUsage\.upsert\(/)
  assert.match(lib, /`usage-\$\{ent\.subscriptionId\}-\$\{backupUsagePeriodKey\(\)\}`/)
  assert.match(lib, /create: \{/)
  assert.match(lib, /update: \{/)
  assert.match(lib, /usedBytes: after\.usedBytes/)
  assert.match(lib, /backupCount: after\.backupCount/)
})

test("PART28 overage is materialized only when the plan opts in, via generateBackupOverage", () => {
  const lib = read("lib/billing/entitlements.ts")
  assert.match(lib, /if \(ent\.overageEnabled && summary\.overStorage/)
  assert.match(lib, /generateBackupOverage\(/)
  assert.match(lib, /overagePricePerGb/)
  // generateBackupOverage rejects non-positive amounts — no silent ₹0 rows.
  const overageFn = lib.slice(lib.indexOf("export async function generateBackupOverage"), lib.indexOf("export async function generateBackupOverage") + 1200)
  assert.match(overageFn, /if \(input\.overageGb <= 0 \|\| input\.ratePerGb <= 0\) return null/)
})

test("PART28 rebuild is wired into the scheduler on a tick cadence", () => {
  const scheduler = read("scripts/vm-backup-scheduler.ts")
  assert.match(scheduler, /rebuildBackupUsage/)
  assert.match(scheduler, /USAGE_REBUILD_EVERY_TICKS/)
  assert.match(scheduler, /rebuildBackupUsage\(\{ persist: true \}\)/)
})

test("PART28 run route hard-blocks when quota reached and overage disabled", () => {
  const route = read("app/api/client/backups/run/route.ts")
  assert.match(route, /!usage\.overageEnabled/)
  assert.match(route, /usage\.usedBytes >= usage\.storageQuotaBytes/)
  assert.match(route, /status: 409/)
  assert.match(route, /does not allow overage/)
})

test("PART28 summary exposes remaining bytes/GB so the UI can never show 0/0", () => {
  const lib = read("lib/billing/entitlements.ts")
  assert.match(lib, /remainingBytes/)
  assert.match(lib, /remainingGb: gbFromBytes\(remainingBytes\)/)
  assert.match(lib, /capReached/)
})

test("PART28 finalize path re-runs the reconcile after every completed backup", () => {
  const finalize = read("lib/proxmox-backup.ts")
  assert.match(finalize, /rebuildBackupUsage/)
  assert.match(finalize, /persist: true/)
})

test("PART28 BackupUsage model exists with the atomic usage key shape", () => {
  const schema = read("prisma/schema.prisma")
  assert.match(schema, /model BackupUsage \{/)
  assert.match(schema, /@@map\("backup_usage"\)/)
})

test("PART28 migration for backup usage is additive and never destructive", () => {
  // Backups table must not be recreated or renamed by the usage work.
  const migrations = read("prisma/migrations/20260918000000_backup_plans_and_snapshot_billing/migration.sql")
  assert.match(migrations, /CREATE TABLE/)
  assert.ok(!/DROP TABLE/.test(migrations))
})