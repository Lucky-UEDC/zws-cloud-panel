import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("Backup plan renewal kind is billable and settled via the subscription extension path", () => {
  const kinds = read("lib/billing/kinds.ts")
  const settlement = read("lib/billing/settlement.ts")
  assert.match(kinds, /backup_plan_renewal/)
  assert.match(kinds, /BILLABLE_ORDER_KINDS = new Set\(\["backup_plan", "backup_plan_renewal"/)
  assert.match(settlement, /settleBackupPlanRenewal/)
  assert.match(settlement, /message: "backup_plan_renewed"/)
  assert.match(settlement, /renewalCount: Number\(meta\.renewalCount \|\| 0\) \+ 1/)
})

test("Backup billing recurrence job is registered in the scheduler and runs once", () => {
  const scheduler = read("workers/zws-scheduler.ts")
  const worker = read("scripts/backup-billing-recurrence.ts")
  assert.match(scheduler, /scripts\/backup-billing-recurrence\.ts/)
  assert.match(worker, /processBackupBillingRecurrence/)
  assert.match(worker, /--once/)
})

test("Recurrence handles expiry, grace, auto-renew, wallet pay, and storage upgrade expiry statically", () => {
  const lib = read("lib/billing/recurrence.ts")
  assert.match(lib, /status: "grace"/)
  assert.match(lib, /graceEndsAt <= now/)
  assert.match(lib, /status: "expired"/)
  assert.match(lib, /upgradeStorageGb: Math\.max\(0, current - gb\)/)
  assert.match(lib, /payBillableOrderFromWallet/)
  assert.match(lib, /createBackupPlanRenewalOrder/)
})

test("Wallet billable helper docs reusable billable_order finalization", () => {
  const lib = read("lib/billing/wallet-billable.ts")
  assert.match(lib, /payBillableOrderFromWallet/)
  assert.match(lib, /handlePaidInvoice/)
  assert.match(lib, /purpose: "billable_order"/)
  assert.match(lib, /withRedisLock/)
})

test("Admin billing overview reports billable revenue and wallet top-up fees", () => {
  const route = read("app/api/admin/billing/overview/route.ts")
  assert.match(route, /canManageSettings/)
  assert.match(route, /revenueByKind/)
  assert.match(route, /backup_plan_renewal/)
  assert.match(route, /topupGatewayFee/)
  assert.match(route, /byStatus/)
})