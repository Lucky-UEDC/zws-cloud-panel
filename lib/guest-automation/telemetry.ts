/**
 * Template-driven telemetry collection.
 *
 * The worker used to import its disk collectors from `lib/vm-guest-disk.ts`,
 * where the commands for each OS are constants. That is the same coupling this
 * whole change removes: correcting a command on a Linux guest or a Windows
 * guest meant editing code and shipping a build.
 *
 * Now the collector is whatever the enabled OS template says it is. The template
 * is resolved from the guest's own reported OS — not from the panel's guess, and
 * not from a name matched against the template name — and the same normalized
 * result shape comes back either way:
 *
 *   { ok, os, source, totalBytes, usedBytes, freeBytes, usedPercent, volumes, selected }
 *
 * The per-VM lock and per-VM failure backoff live here rather than in the
 * caller, because a collector that can be invoked from the worker, an admin
 * refresh and a customer page refresh all need the same guarantee: one
 * collection per VM at a time, and a VM that keeps failing is left alone for a
 * while instead of being retried every thirty seconds forever.
 */

import { prisma } from "@/lib/db"
import { GuestAutomationService } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import type { GuestErrorCode } from "@/lib/guest-automation/constants"

/** Concurrency the worker is allowed. Bounded on purpose; see the queue below. */
export const TELEMETRY_CONCURRENCY = (() => {
  const parsed = Number(process.env.VM_TELEMETRY_CONCURRENCY || 4)
  if (!Number.isInteger(parsed)) return 4
  // 4 / 8 / 16 are the supported settings. Anything else is clamped rather than
  // trusted, because an unbounded value against a hypervisor is how a telemetry
  // collector takes down a node.
  if (parsed <= 4) return 4
  if (parsed <= 8) return 8
  return 16
})()

/** A VM being collected right now, in this process. */
const inFlight = new Set<string>()
/** When a VM may be retried after a failure. */
const backoffUntil = new Map<string, number>()
/** Consecutive failures, so the backoff grows rather than staying flat. */
const failureCounts = new Map<string, number>()

const BASE_BACKOFF_MS = 60_000
const MAX_BACKOFF_MS = 30 * 60_000

export type TelemetryDiskResult = {
  ok: boolean
  os: string
  engine: string | null
  source: string
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
  filesystem: string | null
  volumes: unknown[]
  selectedVolume: Record<string, unknown> | null
  errorCode: GuestErrorCode | null
  error: string | null
  collectionDurationMs: number
  templateId: string | null
  templateVersion: number | null
  checkedAt: string
}

/**
 * Collect disk usage for one VM, through its OS template.
 *
 * Never throws. A collector that throws takes the tick down with it, and one
 * misbehaving guest should cost one VM's number, not the whole run.
 */
export async function collectTemplateDiskUsage(input: {
  vpsInstanceId: string
  vmid: number
  node: { nodeName: string; host: string; tokenId: string; tokenSecret: string; allowInsecureTls?: boolean | null }
  includeAllVolumes?: boolean
  /** Ignores the lock and the backoff. For an explicit admin refresh. */
  force?: boolean
}): Promise<TelemetryDiskResult> {
  const now = new Date()
  const failed = (errorCode: GuestErrorCode, error: string, os = "unknown", durationMs = 0): TelemetryDiskResult => ({
    ok: false,
    os,
    engine: null,
    source: "template-collector",
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    usedPercent: 0,
    filesystem: null,
    volumes: [],
    selectedVolume: null,
    errorCode,
    error,
    collectionDurationMs: durationMs,
    templateId: null,
    templateVersion: null,
    checkedAt: now.toISOString(),
  })

  if (!input.force) {
    if (inFlight.has(input.vpsInstanceId)) {
      // A collection is already running for this VM. Returning rather than
      // queueing is deliberate: the running one will produce a fresher answer
      // than anything this call could add.
      return failed("VM_STOPPED" as GuestErrorCode, "A collection is already running for this server.")
    }
    const until = backoffUntil.get(input.vpsInstanceId) || 0
    if (Date.now() < until) {
      return failed("GUEST_AGENT_UNREACHABLE", `Backing off until ${new Date(until).toISOString()}`)
    }
  }

  inFlight.add(input.vpsInstanceId)
  try {
    const service = new GuestAutomationService(
      guestContextFor({ vpsInstanceId: input.vpsInstanceId, vmid: input.vmid, node: input.node }),
    )
    const result = await service.getDiskUsage({ includeAllVolumes: input.includeAllVolumes === true })

    if (!result.ok) {
      recordFailure(input.vpsInstanceId)
      return {
        ok: false,
        os: String(result.os),
        engine: null,
        source: "template-collector",
        totalBytes: 0,
        usedBytes: 0,
        freeBytes: 0,
        usedPercent: 0,
        filesystem: null,
        volumes: [],
        selectedVolume: null,
        errorCode: result.errorCode,
        error: result.message,
        collectionDurationMs: result.collectionDurationMs,
        templateId: null,
        templateVersion: null,
        checkedAt: now.toISOString(),
      }
    }

    recordSuccess(input.vpsInstanceId)
    return {
      ok: true,
      os: String(result.os),
      engine: result.engine ?? null,
      source: result.source,
      totalBytes: result.totalBytes,
      usedBytes: result.usedBytes,
      freeBytes: result.freeBytes,
      usedPercent: result.usedPercent,
      filesystem: result.filesystem ?? null,
      volumes: result.volumes || [],
      selectedVolume: (result.selected as unknown as Record<string, unknown>) ?? null,
      errorCode: null,
      error: null,
      collectionDurationMs: result.collectionDurationMs,
      templateId: result.templateId ?? null,
      templateVersion: result.templateVersion ?? null,
      checkedAt: now.toISOString(),
    }
  } catch (error: any) {
    recordFailure(input.vpsInstanceId)
    return failed("GUEST_EXEC_FAILED", String(error?.message || error || "Collector failed"))
  } finally {
    inFlight.delete(input.vpsInstanceId)
  }
}

function recordSuccess(vpsInstanceId: string) {
  backoffUntil.delete(vpsInstanceId)
  failureCounts.delete(vpsInstanceId)
}

function recordFailure(vpsInstanceId: string) {
  const count = (failureCounts.get(vpsInstanceId) || 0) + 1
  failureCounts.set(vpsInstanceId, count)
  // Exponential, capped. A guest whose agent is uninstalled will never succeed;
  // hammering it every thirty seconds for a year is a small self-inflicted
  // denial of service against every node it lands on.
  const wait = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(6, count - 1))
  backoffUntil.set(vpsInstanceId, Date.now() + wait)
}

/** Whether a VM is currently being collected. Exposed for the worker's log line. */
export function isCollecting(vpsInstanceId: string) {
  return inFlight.has(vpsInstanceId)
}

/** How many VMs are being collected right now. */
export function inFlightCount() {
  return inFlight.size
}

/**
 * Run a bounded queue.
 *
 * Deliberately not `Promise.all` over a list: an unbounded fan-out of guest
 * sessions is what turns a telemetry collector into a load problem. Items are
 * pulled as slots free up, so one slow guest does not hold a worker slot open
 * while the rest of the queue waits behind it.
 */
export async function runBounded<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  options: { onError?: (item: T, error: unknown) => void } = {},
) {
  const size = Math.max(1, Math.min(limit, items.length || 1))
  let cursor = 0
  const runners = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      try {
        await worker(item)
      } catch (error) {
        options.onError?.(item, error)
      }
    }
  })
  await Promise.all(runners)
}

/** Forget a VM's backoff. Called when a VM is adopted or its state changes. */
export function resetBackoff(vpsInstanceId: string) {
  backoffUntil.delete(vpsInstanceId)
  failureCounts.delete(vpsInstanceId)
}

/** Current backoff state, for diagnostics. */
export function backoffState() {
  return {
    inFlight: inFlight.size,
    backingOff: backoffUntil.size,
    detail: [...backoffUntil.entries()].map(([vpsInstanceId, until]) => ({ vpsInstanceId, until: new Date(until).toISOString(), failures: failureCounts.get(vpsInstanceId) || 0 })),
  }
}

export { prisma }
