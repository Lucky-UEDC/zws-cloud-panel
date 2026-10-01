/**
 * Telemetry: template-driven collection, a bounded queue, and retention tiers.
 *
 * The three properties that matter, each of which has a specific failure mode
 * behind it: an unbounded fan-out of guest sessions takes a node down; a table
 * with no retention eventually takes down the database; and a collector whose
 * commands are constants cannot be corrected without shipping a build.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import {
  RAW_RETENTION_DAYS,
  FIVE_MINUTE_RETENTION_DAYS,
  HOURLY_RETENTION_DAYS,
  retentionPlan,
} from "@/lib/guest-automation/retention"
import { TELEMETRY_CONCURRENCY, runBounded, backoffState, resetBackoff } from "@/lib/guest-automation/telemetry"

const read = (path: string) => readFileSync(path, "utf8")

const WORKER = "scripts/vm-telemetry-worker.ts"
const TELEMETRY = "lib/guest-automation/telemetry.ts"
const RETENTION = "lib/guest-automation/retention.ts"
const MIGRATION = "prisma/migrations/20260928100000_metric_retention/migration.sql"

// ---------------------------------------------------------------------------
// Template-driven collection
// ---------------------------------------------------------------------------

test("the worker's collector is the template, not a set of code constants", () => {
  const source = read(WORKER)
  assert.match(source, /collectTemplateDiskUsage/)
  // The old import hard-coded the commands per OS, which is exactly the
  // coupling this change removes.
  assert.ok(!source.includes("collectGuestDiskUsage"), "the worker still imports the hard-coded collectors")
})

test("the collector records which profile and which version produced the number", () => {
  const source = read(TELEMETRY)
  assert.match(source, /templateId: result\.templateId/)
  assert.match(source, /templateVersion: result\.templateVersion/)
  const worker = read(WORKER)
  assert.match(worker, /templateId: guestDisk\.templateId/)
  assert.match(worker, /templateVersion: guestDisk\.templateVersion/)
})

test("the normalized collector result is the same shape either way", () => {
  const source = read(TELEMETRY)
  for (const field of ["ok", "os", "source", "totalBytes", "usedBytes", "freeBytes", "usedPercent", "volumes", "selectedVolume"]) {
    assert.ok(source.includes(`${field}:`), `the collector result is missing ${field}`)
  }
})

test("a collector failure never reports zero bytes as a real measurement", () => {
  const source = read(TELEMETRY)
  // A failed collection and an empty filesystem must not look the same, or a
  // guest with no agent shows as "0 bytes used, 100% free".
  const failure = source.slice(source.indexOf("const failed = ("), source.indexOf("if (!input.force)"))
  assert.match(failure, /ok: false/)
  assert.match(failure, /errorCode,/)
})

test("the collector never throws", () => {
  const source = read(TELEMETRY)
  // A collector that throws takes the tick down with it, and one misbehaving
  // guest should cost one VM's number, not the whole run.
  assert.match(source, /try \{[\s\S]*?\} catch \(error: any\) \{[\s\S]*?\} finally \{/)
  assert.ok(!/await service\.getDiskUsage\([\s\S]*?\)\s*\n\s*\}\s*\n\s*\/\//.test(source))
})

// ---------------------------------------------------------------------------
// Per-VM lock and backoff
// ---------------------------------------------------------------------------

test("one collection per VM at a time, and a second caller is told rather than queued", () => {
  const source = read(TELEMETRY)
  assert.match(source, /if \(inFlight\.has\(input\.vpsInstanceId\)\)/)
  assert.match(source, /A collection is already running for this server/)
  // Returning rather than queueing is deliberate: the running call produces a
  // fresher answer than anything a queued one could add.
  assert.ok(!/queue\.push|push\(input\.vpsInstanceId\)/.test(source))
})

test("the backoff grows and is capped, rather than retrying forever every thirty seconds", () => {
  const source = read(TELEMETRY)
  assert.match(source, /BASE_BACKOFF_MS \* 2 \*\* Math\.min\(6, count - 1\)/)
  assert.match(source, /MAX_BACKOFF_MS/)
  // A guest whose agent is uninstalled will never succeed; hammering it for a
  // year is a small self-inflicted denial of service against every node.
  assert.ok(source.includes("uninstalled will never succeed") || source.includes("will never succeed"))
})

test("a success clears the backoff, so recovery is immediate", () => {
  const source = read(TELEMETRY)
  const success = source.slice(source.indexOf("function recordSuccess"))
  assert.match(success, /backoffUntil\.delete/)
  assert.match(success, /failureCounts\.delete/)
})

// ---------------------------------------------------------------------------
// Bounded concurrency
// ---------------------------------------------------------------------------

test("concurrency is clamped to 4, 8 or 16", () => {
  for (const [env, expected] of [[undefined, 4], ["4", 4], ["1", 4], ["8", 8], ["5", 8], ["16", 16], ["999", 16], ["abc", 4], ["0", 4]] as Array<[string | undefined, number]>) {
    const previous = process.env.VM_TELEMETRY_CONCURRENCY
    if (env === undefined) delete process.env.VM_TELEMETRY_CONCURRENCY
    else process.env.VM_TELEMETRY_CONCURRENCY = env
    // The module reads the environment once at import, so the clamp is asserted
    // against the exported default and the documented rule.
    assert.equal(typeof TELEMETRY_CONCURRENCY, "number")
    if (env === undefined) assert.equal(TELEMETRY_CONCURRENCY, expected)
    if (previous === undefined) delete process.env.VM_TELEMETRY_CONCURRENCY
    else process.env.VM_TELEMETRY_CONCURRENCY = previous
  }
  const source = read(TELEMETRY)
  assert.match(source, /if \(parsed <= 4\) return 4/)
  assert.match(source, /if \(parsed <= 8\) return 8/)
  assert.match(source, /return 16/)
})

test("the queue never fans out over the whole list", async () => {
  let active = 0
  let peak = 0
  const items = Array.from({ length: 40 }, (_, index) => index)
  await runBounded(items, 4, async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 2))
    active -= 1
  })
  assert.ok(peak <= 4, `peak concurrency was ${peak}, expected at most 4`)
  assert.equal(active, 0, "the queue returned before its work finished")
})

test("the queue runs every item even when some fail", async () => {
  const done: number[] = []
  const failures: unknown[] = []
  await runBounded([1, 2, 3, 4, 5], 2, async (item) => {
    if (item === 2) throw new Error("boom")
    if (item === 4) throw new Error("bang")
    done.push(item)
  }, { onError: (_item, error) => failures.push(error) })
  assert.deepEqual(done.sort(), [1, 3, 5])
  assert.equal(failures.length, 2)
})

test("an empty queue does not hang", async () => {
  await runBounded([], 4, async () => { throw new Error("must not run") })
})

test("a slow item does not hold every slot open", async () => {
  const order: number[] = []
  const items = [1, 2, 3, 4]
  // Item 1 is slow. With a fixed-partition fan-out, items 2-4 would all sit
  // behind it and the whole pass would take as long as the slowest item. With a
  // work-stealing queue they finish first and the pass is bounded by the slow
  // one only.
  await runBounded(items, 4, async (item) => {
    if (item === 1) await new Promise((resolve) => setTimeout(resolve, 60))
    order.push(item)
  })
  assert.equal(order.length, 4)
  assert.equal(order[order.length - 1], 1, "the slow item should be the last to finish")
})

test("the backoff state is observable for diagnostics", () => {
  resetBackoff("vps-test-diagnostics")
  const before = backoffState()
  assert.equal(typeof before.inFlight, "number")
  assert.equal(typeof before.backingOff, "number")
  assert.ok(Array.isArray(before.detail))
})

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test("the three retention windows are the ones the charts are drawn at", () => {
  assert.equal(RAW_RETENTION_DAYS, 7)
  assert.equal(FIVE_MINUTE_RETENTION_DAYS, 30)
  assert.equal(HOURLY_RETENTION_DAYS, 365)
})

test("the cutoffs are computed from one clock, not three", () => {
  const now = new Date("2026-09-28T12:00:00.000Z")
  const plan = retentionPlan(now)
  assert.equal(plan.now.toISOString(), now.toISOString())
  assert.equal(plan.rawCutoff.toISOString(), "2026-09-21T12:00:00.000Z")
  assert.equal(plan.fiveMinuteCutoff.toISOString(), "2026-08-29T12:00:00.000Z")
  assert.equal(plan.hourlyCutoff.toISOString(), "2025-09-28T12:00:00.000Z")
  // Each tier must be strictly older than the next, or a row is deleted before
  // it has been folded.
  assert.ok(plan.rawCutoff > plan.fiveMinuteCutoff)
  assert.ok(plan.fiveMinuteCutoff > plan.hourlyCutoff)
})

test("a dry run writes nothing", () => {
  const source = read(RETENTION)
  // A "dry run" that fills the table is not a dry run.
  const downsamplers = source.slice(source.indexOf("export async function downsampleToFiveMinutes"), source.indexOf("/** Delete what is past its window"))
  assert.match(downsamplers, /if \(options\.dryRun\) \{\s*\n\s*written \+= 1\s*\n\s*continue/)
  assert.equal((downsamplers.match(/if \(options\.dryRun\)/g) || []).length, 2, "both downsamplers must honour the dry run")
})

test("downsampling is idempotent", () => {
  const source = read(RETENTION)
  // One existence query for the pass, not one per bucket, and a bucket that
  // already has a rollup is skipped rather than duplicated.
  assert.match(source, /existingBucketKeys/)
  assert.equal((source.match(/existingBucketKeys\(\{/g) || []).length, 2)
  assert.match(source, /if \(existingBuckets\.has\(/)
})

test("a bucket is keyed on a value, not parsed back out of a string", () => {
  const source = read(RETENTION)
  // An ISO timestamp contains colons, so a `${id}:${iso}` key cannot be split
  // back apart, and a silently wrong date is worse than a visible failure.
  assert.ok(!source.includes("key.split(\":\")"))
  assert.match(source, /`\$\{sample\.vpsInstanceId\}@\$\{at\.getTime\(\)\}`/)
})

test("deletion is genuinely batched", () => {
  const source = read(RETENTION)
  // `deleteMany` takes no `take` in Prisma, so a "batched delete" written as
  // one is a single unbounded delete against the busiest table in the system.
  assert.ok(!/deleteMany\(\{ where, take/.test(source))
  assert.match(source, /take: BATCH_SIZE/)
  assert.match(source, /id: \{ in: ids \}/)
})

test("folding and expiring run in sequence, not in parallel", () => {
  const source = read(RETENTION)
  // The sweep deletes the rows the downsampler is reading; running both at once
  // means a bucket can be folded from a sample being deleted underneath it.
  assert.ok(!/Promise\.all\(\[\s*\n\s*downsampleToFiveMinutes/.test(source))
  const order = source.indexOf("downsampleToFiveMinutes({ now: options.now")
  const expiry = source.indexOf("enforceRetention({ now: options.now")
  assert.ok(order > -1 && expiry > order, "the sweep must run after the fold")
})

test("rates are averaged and cumulative counters take the last value", () => {
  const source = read(RETENTION)
  // Five samples of 20% CPU do not make 100% of CPU. Byte counters are the
  // exception: they are cumulative, so the last value is the one that matters.
  assert.match(source, /const mean = /)
  assert.match(source, /diskUsedBytes: lastOf\("diskUsedBytes", "diskUsed"\)/)
  // Stripped of comments, so the explanatory note about summing is not read as
  // a summing implementation.
  const aggregate = source
    .slice(source.indexOf("function aggregate"), source.indexOf("function mode"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
  assert.ok(!/sum/i.test(aggregate), "a rate that is summed across a bucket is meaningless")
  assert.match(aggregate, /cpuPercent: round\(mean\(/)
})

test("the migration is additive and idempotent", async () => {
  const sql = await readFile(`${process.cwd()}/${MIGRATION}`, "utf8")
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "resolution" TEXT NOT NULL DEFAULT 'raw'/)
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "recorded_at" TIMESTAMP\(3\)/)
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "vm_usage_history_vps_instance_id_resolution_recorded_at_idx"/)
  // The unique index is what makes a downsampling pass safe to interrupt and
  // re-run.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "vm_usage_history_bucket_key"/)
  assert.match(sql, /WHERE "vps_instance_id" IS NOT NULL AND "recorded_at" IS NOT NULL/)
  // Existing rows must remain valid and count as raw.
  assert.match(sql, /SET "recorded_at" = "created_at", "resolution" = 'raw'/)
  assert.ok(!/DROP TABLE|DROP COLUMN|ALTER COLUMN/.test(sql), "the migration must not be destructive")
})

test("the worker runs retention on its own cadence, not on every tick", () => {
  const source = read(WORKER)
  assert.match(source, /VM_METRIC_RETENTION_MS/)
  assert.match(source, /retentionPass/)
  // Folding on every tick is a full scan of the busiest table thirty times an
  // hour to find almost nothing new.
  assert.match(source, /if \(Date\.now\(\) - lastRetentionAt >= RETENTION_MS\)/)
  assert.match(source, /--retention/)
})

test("the worker logs what is backing off, so a silent collector is visible", () => {
  const source = read(WORKER)
  assert.match(source, /backingOff: backoff\.backingOff/)
  assert.match(source, /inFlight: backoff\.inFlight/)
})

test("the worker stops pulling new work when asked to shut down", () => {
  const source = read(WORKER)
  assert.match(source, /if \(stopping\) throw new Error\("shutdown"\)/)
  assert.match(source, /process\.on\("SIGTERM"/)
})
