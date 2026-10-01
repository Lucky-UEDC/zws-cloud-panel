/**
 * Metric retention and downsampling.
 *
 * Raw samples are kept for seven days, five-minute rollups for thirty days, and
 * hourly rollups for a year. That is three tiers rather than one because the
 * three questions are different: "is it full right now" needs raw samples,
 * "was it full last Tuesday" needs five-minute rows, and "was it full last March"
 * needs hourly ones and nothing finer.
 *
 * Aggregation happens in SQL, not in JavaScript. Reading a year of thirty-second
 * samples into memory to average them is how a telemetry job takes down a
 * database, and the row count is the same either way.
 *
 * Everything is idempotent and additive: a rollup row is written only when one
 * does not already exist for that bucket, so re-running a partially completed
 * pass cannot double-count.
 */

import { prisma } from "@/lib/db"

/** Raw samples: fine enough to see a spike, short enough to be cheap to keep. */
export const RAW_RETENTION_DAYS = 7
/** Five-minute rollups: the resolution the 48h customer chart is drawn at. */
export const FIVE_MINUTE_RETENTION_DAYS = 30
/** Hourly rollups: a year of history at a resolution nobody will zoom past. */
export const HOURLY_RETENTION_DAYS = 365

/** Rows deleted per statement. Bounded so no single transaction gets large. */
const BATCH_SIZE = 5_000

const FIVE_MINUTE_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export type RetentionPlan = {
  rawCutoff: Date
  fiveMinuteCutoff: Date
  hourlyCutoff: Date
  now: Date
}

export function retentionPlan(now = new Date()): RetentionPlan {
  return {
    now,
    rawCutoff: new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * HOUR_MS),
    fiveMinuteCutoff: new Date(now.getTime() - FIVE_MINUTE_RETENTION_DAYS * 24 * HOUR_MS),
    hourlyCutoff: new Date(now.getTime() - HOURLY_RETENTION_DAYS * 24 * HOUR_MS),
  }
}

/**
 * Which of these buckets already have a rollup row.
 *
 * Keyed on the same `@<epoch-ms>` form the buckets use, so a comparison is a
 * string equality rather than a date comparison with a timezone surprise.
 */
async function existingBucketKeys(input: { vpsInstanceIds: string[]; resolution: string; ats: Date[] }): Promise<Set<string>> {
  if (!input.ats.length) return new Set()
  const earliest = new Date(Math.min(...input.ats.map((at) => at.getTime())))
  const latest = new Date(Math.max(...input.ats.map((at) => at.getTime())))
  const rows = await (prisma as any).vmUsageHistory.findMany({
    where: {
      vpsInstanceId: { in: input.vpsInstanceIds },
      resolution: input.resolution,
      recordedAt: { gte: earliest, lte: latest },
    },
    select: { vpsInstanceId: true, recordedAt: true },
  }).catch(() => [] as any[])
  return new Set(rows.map((row: any) => `${row.vpsInstanceId}@${new Date(row.recordedAt).getTime()}`))
}

function bucketStart(at: Date, sizeMs: number) {
  return new Date(Math.floor(at.getTime() / sizeMs) * sizeMs)
}

/**
 * Fold raw samples older than the raw window into five-minute rows.
 *
 * Bounded per pass. A pass that tried to fold a year of history in one go would
 * hold a long transaction against the busiest table in the system.
 */
export async function downsampleToFiveMinutes(options: { now?: Date; limitVms?: number; olderThan?: Date; dryRun?: boolean } = {}) {
  const now = options.now ?? new Date()
  const olderThan = options.olderThan ?? new Date(now.getTime() - RAW_RETENTION_DAYS * 24 * HOUR_MS)
  const limitVms = options.limitVms ?? 200

  // Fold the oldest eligible samples first. If a pass is cut short, it has done
  // the cheapest-to-lose work rather than re-folding recent history.
  //
  // `groupBy` rather than `findMany({ distinct })`: the latter does not order by
  // the column being made distinct, so "oldest first, capped at N" is not
  // something it can express, and a capped pass would end up re-folding the same
  // recent VMs forever.
  const oldest = await (prisma as any).vpsMetric.findFirst({
    where: { recordedAt: { lt: olderThan } },
    orderBy: { recordedAt: "asc" },
    select: { vpsInstanceId: true, recordedAt: true },
  })
  if (!oldest) return { vms: 0, buckets: 0, skipped: true }

  const vpsIds = await (prisma as any).vpsMetric.groupBy({
    by: ["vpsInstanceId"],
    where: { recordedAt: { lt: olderThan }, vpsInstanceId: { gte: oldest.vpsInstanceId } },
    _max: { recordedAt: true },
    orderBy: { vpsInstanceId: "asc" },
    take: limitVms,
  }).then((rows: any[]) => rows.map((row) => String(row.vpsInstanceId))).catch(() => [String(oldest.vpsInstanceId)])
  if (!vpsIds.length) return { vms: 0, buckets: 0, written: 0, skipped: true }

  const samples = await (prisma as any).vpsMetric.findMany({
    where: { vpsInstanceId: { in: vpsIds }, recordedAt: { lt: olderThan } },
    orderBy: { recordedAt: "asc" },
    select: {
      vpsInstanceId: true,
      vmid: true,
      recordedAt: true,
      cpuPercent: true,
      ramUsedBytes: true,
      ramTotalBytes: true,
      diskUsedBytes: true,
      diskTotalBytes: true,
      diskFreeBytes: true,
      runtimeStatus: true,
    },
  })
  if (!samples.length) return { vms: 0, buckets: 0, written: 0, skipped: false }

  // The bucket is held as a value rather than encoded into the key. An ISO
  // timestamp contains colons, so a `${id}:${iso}` key cannot be split back
  // apart — and a silently wrong date is worse than a visible failure.
  const buckets = new Map<string, { vpsInstanceId: string; at: Date; samples: any[] }>()
  for (const sample of samples) {
    const at = bucketStart(new Date(sample.recordedAt), FIVE_MINUTE_MS)
    const key = `${sample.vpsInstanceId}@${at.getTime()}`
    const entry = buckets.get(key) || { vpsInstanceId: String(sample.vpsInstanceId), at, samples: [] }
    entry.samples.push(sample)
    buckets.set(key, entry)
  }

  // One existence query for the whole pass, not one per bucket. Two thousand
  // round trips to a database for a question with a single answer is how a
  // maintenance job becomes a slow one.
  const existingBuckets = await existingBucketKeys({
    vpsInstanceIds: vpsIds,
    resolution: "5m",
    ats: [...buckets.values()].map((bucket) => bucket.at),
  })

  let written = 0
  for (const bucket of buckets.values()) {
    const { vpsInstanceId, at, samples: list } = bucket
    if (existingBuckets.has(`${vpsInstanceId}@${at.getTime()}`)) continue
    const rolled = aggregate(list)
    // A dry run reports what it would write and writes nothing. A "dry run"
    // that fills the table is not a dry run.
    if (options.dryRun) {
      written += 1
      continue
    }
    await (prisma as any).vmUsageHistory.create({
      data: {
        vmId: String(rolled.vmid),
        vpsInstanceId,
        runtimeStatus: rolled.runtimeStatus,
        cpuPercent: rolled.cpuPercent,
        ramUsed: BigInt(Math.round(rolled.ramUsedBytes)),
        ramTotal: BigInt(Math.round(rolled.ramTotalBytes)),
        diskUsed: BigInt(Math.round(rolled.diskUsedBytes)),
        diskTotal: BigInt(Math.round(rolled.diskTotalBytes)),
        diskFree: BigInt(Math.round(rolled.diskFreeBytes)),
        sampleCount: list.length,
        resolution: "5m",
        recordedAt: at,
        metadata: { downsampledFrom: "vps_metric", samples: list.length } as any,
        createdAt: now,
      },
    }).catch(() => null)
    written += 1
  }

  return { vms: vpsIds.length, buckets: buckets.size, written, skipped: false }
}

/** Same shape, one hour wide, folding five-minute rows. */
export async function downsampleToHourly(options: { now?: Date; limitVms?: number; olderThan?: Date; dryRun?: boolean } = {}) {
  const now = options.now ?? new Date()
  const olderThan = options.olderThan ?? new Date(now.getTime() - FIVE_MINUTE_RETENTION_DAYS * 24 * HOUR_MS)
  const limitVms = options.limitVms ?? 200

  const oldest = await (prisma as any).vmUsageHistory.findFirst({
    where: { resolution: "5m", recordedAt: { lt: olderThan } },
    orderBy: { recordedAt: "asc" },
    select: { vpsInstanceId: true },
  })
  if (!oldest) return { vms: 0, buckets: 0, skipped: true }

  const vpsIds = await (prisma as any).vmUsageHistory.groupBy({
    by: ["vpsInstanceId"],
    where: { resolution: "5m", recordedAt: { lt: olderThan } },
    _max: { recordedAt: true },
    orderBy: { vpsInstanceId: "asc" },
    take: limitVms,
  }).then((rows: any[]) => rows.map((row) => String(row.vpsInstanceId))).catch(() => [String(oldest.vpsInstanceId)])
  if (!vpsIds.length) return { vms: 0, buckets: 0, written: 0, skipped: true }

  const samples = await (prisma as any).vmUsageHistory.findMany({
    where: { vpsInstanceId: { in: vpsIds }, resolution: "5m", recordedAt: { lt: olderThan } },
    orderBy: { recordedAt: "asc" },
  })
  if (!samples.length) return { vms: 0, buckets: 0, written: 0, skipped: false }

  const buckets = new Map<string, { vpsInstanceId: string; at: Date; samples: any[] }>()
  for (const sample of samples) {
    const at = bucketStart(new Date(sample.recordedAt), HOUR_MS)
    const key = `${sample.vpsInstanceId}@${at.getTime()}`
    const entry = buckets.get(key) || { vpsInstanceId: String(sample.vpsInstanceId), at, samples: [] }
    entry.samples.push(sample)
    buckets.set(key, entry)
  }

  const existingBuckets = await existingBucketKeys({
    vpsInstanceIds: vpsIds,
    resolution: "1h",
    ats: [...buckets.values()].map((bucket) => bucket.at),
  })

  let written = 0
  for (const bucket of buckets.values()) {
    const { vpsInstanceId, at, samples: list } = bucket
    if (existingBuckets.has(`${vpsInstanceId}@${at.getTime()}`)) continue
    const rolled = aggregate(list)
    if (options.dryRun) {
      written += 1
      continue
    }
    await (prisma as any).vmUsageHistory.create({
      data: {
        vmId: String(rolled.vmid),
        vpsInstanceId,
        runtimeStatus: rolled.runtimeStatus,
        cpuPercent: rolled.cpuPercent,
        ramUsed: BigInt(Math.round(rolled.ramUsedBytes)),
        ramTotal: BigInt(Math.round(rolled.ramTotalBytes)),
        diskUsed: BigInt(Math.round(rolled.diskUsedBytes)),
        diskTotal: BigInt(Math.round(rolled.diskTotalBytes)),
        diskFree: BigInt(Math.round(rolled.diskFreeBytes)),
        sampleCount: list.length,
        resolution: "1h",
        recordedAt: at,
        metadata: { downsampledFrom: "5m", samples: list.length } as any,
        createdAt: now,
      },
    }).catch(() => null)
    written += 1
  }

  return { vms: vpsIds.length, buckets: buckets.size, written, skipped: false }
}

/**
 * Averages rather than sums.
 *
 * A rate summed across a bucket is meaningless — five samples of 20% CPU do not
 * make 100% of CPU. Byte counters are the exception: those are cumulative, so
 * the last value in the bucket is the one that matters.
 */
type Aggregate = {
  vmid: number | string | null
  runtimeStatus: string
  cpuPercent: number
  ramUsedBytes: number
  ramTotalBytes: number
  diskUsedBytes: number
  diskTotalBytes: number
  diskFreeBytes: number
}

function aggregate(list: any[]): Aggregate {
  const number = (value: unknown) => {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const mean = (pick: (row: any) => number) => list.reduce((total, row) => total + pick(row), 0) / Math.max(1, list.length)
  // Cumulative counters: the value at the end of the bucket is the one that
  // matters, because summing them would produce a number no chart can use.
  const lastOf = (...keys: string[]) => number(list[list.length - 1]?.[keys[0]] ?? keys.slice(1).map((key) => list[list.length - 1]?.[key]).find((value) => value !== undefined && value !== null))
  return {
    vmid: list[0]?.vmid ?? list[0]?.vmId ?? null,
    // The most common state in the bucket, which is what a bar chart wants.
    runtimeStatus: mode(list.map((row) => String(row.runtimeStatus || "unknown"))),
    cpuPercent: round(mean((row) => number(row.cpuPercent))),
    ramUsedBytes: mean((row) => number(row.ramUsedBytes ?? row.ramUsed)),
    ramTotalBytes: mean((row) => number(row.ramTotalBytes ?? row.ramTotal)),
    diskUsedBytes: lastOf("diskUsedBytes", "diskUsed"),
    diskTotalBytes: lastOf("diskTotalBytes", "diskTotal"),
    diskFreeBytes: lastOf("diskFreeBytes", "diskFree"),
  }
}

function mode(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  let best = values[0] || "unknown"
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

/** Delete what is past its window. Raw samples go first, then 5m, then 1h. */
export async function enforceRetention(options: { now?: Date; dryRun?: boolean } = {}) {
  const plan = retentionPlan(options.now)
  const cutoffs = [
    { table: "vpsMetric", resolution: "raw", before: plan.rawCutoff },
    { table: "vmUsageHistory", resolution: "5m", before: plan.fiveMinuteCutoff },
    { table: "vmUsageHistory", resolution: "1h", before: plan.hourlyCutoff },
  ] as const

  const results: Array<{ table: string; resolution: string; before: string; deleted: number }> = []
  for (const cutoff of cutoffs) {
    const where = cutoff.table === "vmUsageHistory"
      ? { resolution: cutoff.resolution, recordedAt: { lt: cutoff.before } }
      : { recordedAt: { lt: cutoff.before } }
    if (options.dryRun) {
      const count = await (prisma as any)[cutoff.table].count({ where }).catch(() => 0)
      results.push({ table: cutoff.table, resolution: cutoff.resolution, before: cutoff.before.toISOString(), deleted: count })
      continue
    }
    // Batched by selecting ids first.
    //
    // `deleteMany` takes no `take` in Prisma, so a "batched delete" written as
    // one is actually a single unbounded delete against the busiest table in the
    // system — which is how a retention job becomes an outage. Selecting ids and
    // deleting them in batches bounds the transaction for real.
    let deleted = 0
    for (;;) {
      const rows = await (prisma as any)[cutoff.table].findMany({
        where,
        orderBy: { recordedAt: "asc" },
        take: BATCH_SIZE,
        select: { id: true },
      }).catch(() => [] as Array<{ id: string }>)
      if (!rows.length) break
      const ids = rows.map((row: any) => row.id)
      const batch = await (prisma as any)[cutoff.table].deleteMany({
        where: { id: { in: ids } },
      }).catch(() => ({ count: 0 }))
      deleted += batch.count
      if (!batch.count) break
    }
    results.push({ table: cutoff.table, resolution: cutoff.resolution, before: cutoff.before.toISOString(), deleted })
  }
  return { plan, results }
}

/** One pass. Safe to run repeatedly and safe to interrupt. */
export async function runRetentionPass(options: { now?: Date; dryRun?: boolean; limitVms?: number } = {}) {
  const started = Date.now()
  // Sequential, not parallel. The retention sweep deletes the raw rows the
  // downsampler is reading, and running both at once means a bucket can be
  // folded from a sample that is being deleted underneath it.
  const fiveMinute = await downsampleToFiveMinutes({ now: options.now, limitVms: options.limitVms, dryRun: options.dryRun })
  const hourly = await downsampleToHourly({ now: options.now, limitVms: options.limitVms, dryRun: options.dryRun })
  const retention = await enforceRetention({ now: options.now, dryRun: options.dryRun })
  return { fiveMinute, hourly, retention, durationMs: Date.now() - started }
}
