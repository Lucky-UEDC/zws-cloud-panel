/**
 * Shared Proxmox task polling with progress parsing.
 *
 * Deduplicates concurrent polls for the same UPID, exposes
 * live progress (parsed from vzdump / task logs), and cleans up
 * when the task finishes or times out.
 */

import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type TaskProgress = {
  status: "pending" | "running" | "completed" | "failed" | "timedout"
  exitstatus: string | null
  percent: number | null
  phase: string | null
  transferredBytes: number | null
  totalBytes: number | null
  transferredLabel: string | null
  totalLabel: string | null
  speedLabel: string | null
  elapsedSeconds: number
  taskId: string | null
  logTail: string[]
  verified: boolean
  error: string | null
}

type PollRecord = {
  promise: Promise<TaskProgress>
  startedAt: number
}

/* ------------------------------------------------------------------ */
/*  In-memory dedup registry (per-process)                             */
/* ------------------------------------------------------------------ */

const inflight = new Map<string, PollRecord>()

function dedupeKey(nodeName: string, upid: string) {
  return `${nodeName}:${upid}`
}

/* ------------------------------------------------------------------ */
/*  Log parsing helpers                                                */
/* ------------------------------------------------------------------ */

const BYTES_RE = /([\d.,]+)\s*([KMGT]iB)/g
const PERCENT_RE = /(\d{1,3})%/
const SPEED_RE = /([\d.,]+)\s*([KMGT]?i?B\/s)/
const PHASE_RE = /INFO:\s+(Starting Backup|Finished Backup|creating Proxmox|starting new backup|restoring|Backup started|Backup finished|starting restored|Verifying Backup|Verification)/i

function parseBytesHuman(s: string): number {
  const m = BYTES_RE.exec(s)
  if (!m) return 0
  const num = parseFloat(m[1].replace(/,/g, ""))
  const unit = m[2]
  const units: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4 }
  return num * (units[unit] || 0)
}

// Monotonic progress clamp: remember the highest seen percentage to prevent
// regression when log lines are reordered or noisy.
let lastPercent = 0
let lastPercentResetAt = 0

function resetPercentClamp() {
  lastPercent = 0
  lastPercentResetAt = Date.now()
}

function clampPercent(value: number | null): number | null {
  if (value === null) return null
  // Reset clamp after 2 minutes of inactivity (task likely restarted)
  if (Date.now() - lastPercentResetAt > 2 * 60 * 1000) resetPercentClamp()
  if (value < lastPercent) return lastPercent
  lastPercent = value
  return value
}

function extractLines(rawLog: any[]): string[] {
  return rawLog.map((entry: any) => {
    const text = typeof entry === "string" ? entry : entry?.text ?? entry?.t ?? ""
    return String(text || "").trim()
  }).filter(Boolean)
}

function parseVzdumpProgress(lines: string[]): {
  percent: number | null
  transferredBytes: number | null
  totalBytes: number | null
  transferredLabel: string | null
  totalLabel: string | null
  speedLabel: string | null
  phase: string | null
} {
  let percent: number | null = null
  let transferredBytes: number | null = null
  let totalBytes: number | null = null
  let transferredLabel: string | null = null
  let totalLabel: string | null = null
  let speedLabel: string | null = null
  let phase: string | null = null

  for (const line of lines) {
    const phaseMatch = line.match(PHASE_RE)
    if (phaseMatch) {
      phase = phaseMatch[1] || line.replace(/^INFO:\s+/, "").slice(0, 80)
      // Normalize verification phase for UI
      if (/verif/i.test(phase)) phase = "Verifying backup"
    }

    const pctMatch = line.match(PERCENT_RE)
    if (pctMatch) {
      const p = parseInt(pctMatch[1], 10)
      if (p >= 0 && p <= 100) percent = clampPercent(p)
    }

    // vzdump format: "INFO: 45% (3.60 GiB of 8.00 GiB)"
    const bytesInLine = [...line.matchAll(/([\d.,]+)\s*([KMGT]iB)/g)]
    if (bytesInLine.length >= 2) {
      const candidateTransferred = parseBytesHuman(bytesInLine[0][0])
      const candidateTotal = parseBytesHuman(bytesInLine[1][0])
      // Reject inconsistent byte pairs (e.g. "80.0 GiB of 1.4 GiB"): the
      // transferred amount can never exceed the declared total, and both
      // must be positive. Invalid pairs are dropped instead of shown.
      if (
        Number.isFinite(candidateTransferred) &&
        Number.isFinite(candidateTotal) &&
        candidateTransferred >= 0 &&
        candidateTotal > 0 &&
        candidateTransferred <= candidateTotal
      ) {
        transferredBytes = candidateTransferred
        totalBytes = candidateTotal
        transferredLabel = bytesInLine[0][0]
        totalLabel = bytesInLine[1][0]
      }
    }

    const speedMatch = line.match(SPEED_RE)
    if (speedMatch) {
      speedLabel = speedMatch[0]
    }
  }

  return { percent, transferredBytes, totalBytes, transferredLabel, totalLabel, speedLabel, phase }
}

function isTerminal(status: string, exitstatus: string | null): boolean {
  if (status === "stopped") return true
  if (status === "running" && exitstatus) return true
  return false
}

function isError(exitstatus: string | null): boolean {
  if (!exitstatus) return false
  return exitstatus.toLowerCase() !== "ok"
}

/* ------------------------------------------------------------------ */
/*  Core poller                                                        */
/* ------------------------------------------------------------------ */

const POLL_INTERVAL_MS = 3000
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000

async function doPoll(nodeName: string, upid: string, timeoutMs: number): Promise<TaskProgress> {
  const start = Date.now()

  const node = await prisma.proxmoxNode.findFirst({ where: { nodeName, isActive: true } })
  if (!node || !node.host) {
    return { status: "failed", exitstatus: null, percent: null, phase: null, transferredBytes: null, totalBytes: null, transferredLabel: null, totalLabel: null, speedLabel: null, elapsedSeconds: 0, taskId: upid, logTail: [], verified: false, error: "Node not found" }
  }

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: 30000 })

  while (Date.now() - start < timeoutMs) {
    try {
      const [status, rawLog] = await Promise.all([
        client.getTaskStatus(nodeName, upid).catch(() => null),
        client.getTaskLog(nodeName, upid, 200).catch(() => []),
      ])

      const taskStatus = String(status?.status || "").toLowerCase()
      const exitStatus = String(status?.exitstatus || "").toLowerCase() || null
      const lines = extractLines(rawLog)
      const parsed = parseVzdumpProgress(lines)

      if (isTerminal(taskStatus, exitStatus)) {
        const failed = isError(exitStatus)
        return {
          status: failed ? "failed" : "completed",
          exitstatus: exitStatus,
          // The final task state is authoritative: a successful task is
          // always 100% — the last log line may still show an earlier
          // percentage (e.g. 97%), which must never be shown as final.
          percent: failed ? null : 100,
          phase: failed ? parsed.phase : parsed.phase === "Finished Backup" ? "Finished Backup" : "Backup finished",
          transferredBytes: parsed.transferredBytes,
          totalBytes: parsed.totalBytes,
          transferredLabel: parsed.transferredLabel,
          totalLabel: parsed.totalLabel,
          speedLabel: null,
          elapsedSeconds: Math.round((Date.now() - start) / 1000),
          taskId: upid,
          logTail: lines.slice(-30),
          verified: true,
          error: failed ? `Task failed with status: ${exitStatus}` : null,
        }
      }
    } catch {
      // transient poll error - retry
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  return {
    status: "timedout",
    exitstatus: null,
    percent: null,
    phase: "timed out",
    transferredBytes: null,
    totalBytes: null,
    transferredLabel: null,
    totalLabel: null,
    speedLabel: null,
    elapsedSeconds: Math.round((Date.now() - start) / 1000),
    taskId: upid,
    logTail: [],
    verified: false,
    error: "Task polling timed out",
  }
}

/**
 * Poll a Proxmox task by UPID. Returns live progress.
 * Deduplicates concurrent calls for the same UPID.
 */
export async function pollTaskProgress(nodeName: string, upid: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<TaskProgress> {
  const key = dedupeKey(nodeName, upid)

  const existing = inflight.get(key)
  if (existing) {
    try {
      return await existing.promise
    } finally {
      inflight.delete(key)
    }
  }

  const promise = doPoll(nodeName, upid, timeoutMs)
  inflight.set(key, { promise, startedAt: Date.now() })

  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/**
 * Non-blocking snapshot of current progress for a running task.
 * Returns the *current* PVE state without waiting for completion.
 */
export async function snapshotTaskProgress(nodeName: string, upid: string): Promise<TaskProgress> {
  const node = await prisma.proxmoxNode.findFirst({ where: { nodeName, isActive: true } })
  if (!node || !node.host) {
    return { status: "failed", exitstatus: null, percent: null, phase: null, transferredBytes: null, totalBytes: null, transferredLabel: null, totalLabel: null, speedLabel: null, elapsedSeconds: 0, taskId: upid, logTail: [], verified: false, error: "Node not found" }
  }

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls, timeoutMs: 10000 })

  const [status, rawLog] = await Promise.all([
    client.getTaskStatus(nodeName, upid).catch(() => null),
    client.getTaskLog(nodeName, upid, 200).catch(() => []),
  ])

  const taskStatus = String(status?.status || "running").toLowerCase()
  const exitStatus = String(status?.exitstatus || "").toLowerCase() || null
  const lines = extractLines(rawLog)
  const parsed = parseVzdumpProgress(lines)

  const terminal = isTerminal(taskStatus, exitStatus)
  const failed = isError(exitStatus)

  // Final task state is authoritative: a successful task maps to 100%.
  // The raw log may still show a stale earlier percentage (e.g. 97%).
  const percent = terminal ? (failed ? null : 100) : parsed.percent
  // Failed tasks never report a completed-looking percentage.
  const phase = terminal
    ? failed
      ? parsed.phase || "Backup failed"
      : parsed.phase === "Finished Backup"
        ? "Finished Backup"
        : "Backup finished"
    : parsed.phase

  return {
    status: terminal ? (failed ? "failed" : "completed") : "running",
    exitstatus: exitStatus,
    percent,
    phase,
    transferredBytes: parsed.transferredBytes,
    totalBytes: parsed.totalBytes,
    transferredLabel: parsed.transferredLabel,
    totalLabel: parsed.totalLabel,
    speedLabel: speedLabelForSnapshot(parsed.speedLabel, terminal),
    elapsedSeconds: 0,
    taskId: upid,
    logTail: lines.slice(-30),
    verified: terminal,
    error: failed ? `Task failed: ${exitStatus}` : null,
  }
}

function speedLabelForSnapshot(label: string | null, terminal: boolean) {
  // After completion PVE no longer reports live throughput.
  return terminal ? null : label
}
