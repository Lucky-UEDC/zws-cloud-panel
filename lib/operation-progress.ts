import { snapshotTaskProgress } from "@/lib/task-progress"

export type OperationKind = "backup" | "restore" | "snapshot" | "rollback" | "shutdown" | "start" | "stop" | "restart" | "password"

export type OperationStatus = "queued" | "running" | "completed" | "failed" | "timedout" | "gone"

export type OperationState = {
  operationId: string
  kind: OperationKind
  vpsInstanceId: string
  customerId: string
  vmId: number | null
  status: OperationStatus
  headline: string
  startedAt: string
  finishedAt?: string | null
  nodeName?: string | null
  upid?: string | null
  taskId?: string | null
  percent?: number | null
  phase?: string | null
  transferredBytes?: number | null
  totalBytes?: number | null
  transferredLabel?: string | null
  totalLabel?: string | null
  speedLabel?: string | null
  elapsedSeconds?: number
  logTail?: string[]
  exitStatus?: string | null
  verified?: boolean
  error?: string | null
  result?: Record<string, unknown> | null
}

/* ------------------------------------------------------------------ */
/*  In-memory registry (per process). Detached background operations   */
/*  keep this process alive via their own timers/promises.             */
/* ------------------------------------------------------------------ */

const registry = new Map<string, OperationState>()

function cloneOperation(operation: OperationState): OperationState {
  return { ...operation, logTail: operation.logTail ? [...operation.logTail] : [] }
}

export function registerOperation(input: Omit<OperationState, "operationId" | "status"> & { operationId: string }): OperationState {
  const operation: OperationState = cloneOperation({
    ...input,
    status: "running",
    percent: null,
    phase: null,
    logTail: [],
    verified: false,
  })
  registry.set(input.operationId, operation)
  return operation
}

export function updateOperation(operationId: string, patch: Partial<OperationState>) {
  const current = registry.get(operationId)
  if (!current) return
  const merged: OperationState = {
    ...current,
    ...patch,
    logTail: patch.logTail ? patch.logTail.slice(-40) : current.logTail,
    elapsedSeconds: Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000),
  }
  registry.set(operationId, merged)
}

export function markOperation(operationId: string, status: OperationStatus, extra: Partial<OperationState> = {}) {
  const current = registry.get(operationId)
  if (!current) return
  const terminal = status === "completed" || status === "failed" || status === "timedout"
  updateOperation(operationId, {
    ...extra,
    status,
    verified: status === "completed" ? true : current.verified,
    finishedAt: terminal ? new Date().toISOString() : undefined,
  })
}

export function getOperation(operationId: string): OperationState | null {
  const operation = registry.get(operationId)
  if (!operation) return null
  return cloneOperation(operation)
}

export function getOperationsForVps(vpsInstanceId: string): OperationState[] {
  return Array.from(registry.values())
    .filter((operation) => operation.vpsInstanceId === vpsInstanceId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .map((operation) => cloneOperation(operation))
}

/**
 * Run a blocking operation in the background and report it through the
 * registry. `run` receives a `report` helper used to publish live progress.
 * Terminal state (completed/failed/timedout) is applied automatically.
 */
export function runOperationBackground(input: {
  operationId: string
  kind: OperationKind
  vpsInstanceId: string
  customerId: string
  vmId: number | null
  headline: string
  nodeName?: string | null
  upid?: string | null
  run: (report: (patch: Partial<OperationState>) => void) => Promise<void>
}): OperationState {
  registerOperation({
    operationId: input.operationId,
    kind: input.kind,
    vpsInstanceId: input.vpsInstanceId,
    customerId: input.customerId,
    vmId: input.vmId,
    headline: input.headline,
    startedAt: new Date().toISOString(),
    nodeName: input.nodeName || null,
    upid: input.upid || null,
  })

  void (async () => {
    try {
      await input.run((patch) => updateOperation(input.operationId, patch))
      markOperation(input.operationId, "completed")
    } catch (error: any) {
      markOperation(input.operationId, "failed", { error: String(error?.message || "Operation failed") })
    }
  })()

  return getOperation(input.operationId)!
}

/**
 * Merge registry state with live PVE task progress when the operation is
 * backed by a real Proxmox UPID. Used by the client progress endpoint so a
 * poll returns the actual task state on the node, not just what we last saw.
 */
export async function resolveOperationProgress(operationId: string): Promise<OperationState | null> {
  const operation = getOperation(operationId)
  if (!operation) return null

  if (operation.status === "running" || operation.status === "queued") {
    if (operation.upid && operation.nodeName) {
      try {
        const live = await snapshotTaskProgress(operation.nodeName, operation.upid)
        if (live.status === "completed" || live.status === "failed") {
          markOperation(operationId, live.status, {
            percent: live.percent,
            phase: live.phase || "completed",
            exitStatus: live.exitstatus,
            verified: live.status === "completed",
            error: live.error || undefined,
            result: { taskId: live.taskId },
          })
        } else if (live.status === "running") {
          updateOperation(operationId, {
            percent: live.percent,
            phase: live.phase || undefined,
            transferredBytes: live.transferredBytes,
            totalBytes: live.totalBytes,
            transferredLabel: live.transferredLabel,
            totalLabel: live.totalLabel,
            speedLabel: live.speedLabel,
            logTail: live.logTail,
          })
        }
      } catch {
        // PVE unreachable - keep last known state (do not invent progress)
      }
    }
  }

  return getOperation(operationId)
}