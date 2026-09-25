import { prisma } from "@/lib/db"
import { createProxmoxClient, ProxmoxError, PROXMOX_LONG_TIMEOUT_MS } from "@/lib/proxmox"
import { writeAuditLog } from "@/lib/audit-log"
import { Client as SshClient } from "ssh2"

const VM_RESTORE_TIMEOUT_MS = 60 * 60 * 1000
const VM_RESTORE_SSH_TIMEOUT_MS = 60 * 60 * 1000

function sshHostOf(nodeHost: string): string {
  try {
    return new URL(nodeHost).hostname
  } catch {
    return nodeHost.split("/")[0].split(":")[0].trim() || nodeHost
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const RESTORE_VOLID_RE = /^[a-zA-Z0-9._:-]+:backup\/vzdump-(qemu|lxc)-\d+-\d{4}_\d{2}_\d{2}-\d{2}_\d{2}_\d{2}\.(vma|tar)(\.(zst|xz|gz|lzo|bz2))?$/

function validateRestoreVolid(volid: string): boolean {
  return RESTORE_VOLID_RE.test(volid)
}

function isValidStorageId(storage: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(storage)
}

export type SshExecResult = {
  stdout: string
  stderr: string
  exitCode: number
}

function sshExec(args: {
  host: string
  username: string
  password: string
  command: string
  timeoutMs: number
  onOutput?: (text: string) => void
}): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient()
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      conn.end()
      reject(new ProxmoxError(504, "SSH restore timed out"))
    }, args.timeoutMs)

    conn.on("ready", () => {
      conn.exec(args.command, { pty: false }, (error, stream) => {
        if (error) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          conn.end()
          reject(new ProxmoxError(502, "SSH restore failed to start: " + String(error?.message || error)))
          return
        }
        const emit = (chunk: Buffer) => {
          const text = chunk.toString("utf8")
          if (!text.trim()) return
          try {
            args.onOutput?.(text)
          } catch {
            // progress callback must never break the restore
          }
        }
        stream.on("close", (code: number | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          conn.end()
          resolve({ stdout, stderr, exitCode: typeof code === "number" ? code : -1 })
        })
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8")
          emit(chunk)
        })
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8")
          emit(chunk)
        })
        stream.on("error", (err: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          conn.end()
          reject(new ProxmoxError(502, "SSH restore stream failed: " + String(err?.message || err)))
        })
      })
    })

    conn.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new ProxmoxError(502, "SSH restore connection failed: " + String(error?.message || error)))
    })

    conn.connect({
      host: args.host,
      port: 22,
      username: args.username,
      password: args.password,
      readyTimeout: Math.min(args.timeoutMs, 15000),
      tryKeyboard: true,
    })
  })
}

export type SshRestoreResult = {
  taskId: null
  status: "completed" | "failed"
  reason?: string
  output?: string
}

export type SshRestoreInput = {
  node: { host: string; sshUsername: string | null | undefined; sshPassword: string | null | undefined; nodeName: string }
  vmid: number
  volid: string
  storage: string | null
}

/**
 * Run `qmrestore` directly on the Proxmox node over SSH. This is the only way to
 * restore on nodes whose REST API schema rejects the `restore` create parameter.
 *
 * Safety guarantees:
 *  - the volid must match the strict vzdump archive pattern (no shell injection)
 *  - the vmid is validated as a positive integer
 *  - the restore storage is validated; qmrestore is run with `--force` and without
 *    `--start`, so the VM stays stopped after a successful restore.
 */
export async function restoreVmViaSsh(input: SshRestoreInput & { onOutput?: (text: string) => void }): Promise<SshRestoreResult> {
  const { node } = input
  if (!node.sshUsername || !node.sshPassword) {
    return { taskId: null, status: "failed", reason: "This Proxmox node has no SSH credentials for QEMU backup restore." }
  }
  if (!validateRestoreVolid(input.volid)) {
    return { taskId: null, status: "failed", reason: "Archive volume ID failed validation; restore aborted before touching the node." }
  }
  if (!Number.isInteger(input.vmid) || input.vmid <= 0) {
    return { taskId: null, status: "failed", reason: "Invalid VMID for restore." }
  }

  let storageArgs = ""
  if (input.storage) {
    if (!isValidStorageId(input.storage)) {
      return { taskId: null, status: "failed", reason: "Restore storage failed validation; restore aborted before touching the node." }
    }
    storageArgs = `--storage ${shellQuote(input.storage)}`
  }

  const command = `qmrestore ${shellQuote(input.volid)} ${Number(input.vmid)} --force ${storageArgs}`
  const timeoutMs = VM_RESTORE_SSH_TIMEOUT_MS

  let result: SshExecResult
  try {
    result = await sshExec({
      host: sshHostOf(node.host),
      username: node.sshUsername,
      password: node.sshPassword,
      command,
      timeoutMs,
      onOutput: input.onOutput,
    })
  } catch (error: any) {
    if (error instanceof ProxmoxError) return { taskId: null, status: "failed", reason: error.message }
    return { taskId: null, status: "failed", reason: String(error?.message || "SSH restore worker failed") }
  }

  const output = `${result.stderr || result.stdout || ""}`.trim()
  if (result.exitCode === 0) {
    return { taskId: null, status: "completed", output }
  }
  return {
    taskId: null,
    status: "failed",
    reason: output ? `qmrestore exited with code ${result.exitCode}` : `qmrestore exited with code ${result.exitCode}`,
    output,
  }
}

export type VmRestoreResult = {
  taskId: string | null
  status: "completed" | "failed" | "unsupported"
  verifyStatus?: string
  reason?: string
}

function proxmoxClientForNode(node: { host: string; tokenId: string; tokenSecret: string; allowInsecureTls: boolean }) {
  if (!node.host) throw new ProxmoxError(404, "Node has no host configured")
  return createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
    timeoutMs: PROXMOX_LONG_TIMEOUT_MS,
  })
}

function normalizeUpid(payload: any): string | null {
  if (!payload) return null
  if (typeof payload === "string") return payload
  const data = payload?.data ?? payload
  if (typeof data === "string") return data
  if (typeof data?.upid === "string") return data.upid
  return null
}

const VM_SHUTDOWN_TIMEOUT_MS = 10 * 60 * 1000
const VM_SHUTDOWN_POLL_MS = 3000

export type ShutdownResult = {
  ok: boolean
  previousStatus: string
  status: string
  message?: string
}

/**
 * Shut down a VM and wait until it reports "stopped".
 * Returns the final status or a timed-out state. Never force-stops.
 */
export async function shutdownVmAndWait(node: { host: string; tokenId: string; tokenSecret: string; allowInsecureTls: boolean }, nodeName: string, vmid: number): Promise<ShutdownResult> {
  const client = proxmoxClientForNode(node)

  const runtime = await client.getVMStatus(nodeName, Number(vmid)).catch(() => null)
  const currentStatus = String(runtime?.status || "unknown").toLowerCase()
  if (currentStatus === "stopped") {
    return { ok: true, previousStatus: currentStatus, status: "stopped" }
  }

  if (currentStatus !== "running" && currentStatus !== "paused") {
    return { ok: false, previousStatus: currentStatus, status: currentStatus, message: `VM cannot be shut down while in '${currentStatus}' state` }
  }

  await client.shutdownVM(nodeName, Number(vmid)).catch(() => null)

  const started = Date.now()
  while (Date.now() - started < VM_SHUTDOWN_TIMEOUT_MS) {
    const status = await client.getVMStatus(nodeName, Number(vmid)).catch(() => null)
    const s = String(status?.status || "").toLowerCase()
    if (s === "stopped" || s === "not-running") {
      return { ok: true, previousStatus: currentStatus, status: "stopped" }
    }
    await new Promise((r) => setTimeout(r, VM_SHUTDOWN_POLL_MS))
  }

  return { ok: false, previousStatus: currentStatus, status: "running", message: "Timed out waiting for the VM to shut down" }
}

const SCHEMA_UNSUPPORTED_MARKERS = [
  "property is not defined in schema",
  "the schema does not allow additional properties",
  "restore is not defined",
  "can't locate object method",
  "not implemented",
]

function isUnsupportedRestore(error: any): boolean {
  const message = String(error?.message || error?.proxmoxMessage || "")
  return SCHEMA_UNSUPPORTED_MARKERS.some((marker) => message.includes(marker))
}

function volidOfBackup(backup: { backupPath?: string | null; metadata?: unknown | null }): string | null {
  if (backup.backupPath) return String(backup.backupPath)
  if (backup.metadata && typeof backup.metadata === "object") {
    const volid = (backup.metadata as Record<string, unknown>).volid
    if (typeof volid === "string" && volid) return volid
  }
  return null
}

/**
 * Restore a VM from its latest completed backup.
 *
 * Preconditions (enforced):
 *  - the VM exists and is currently STOPPED (never silently powers it down)
 *  - the backup belongs to the customer and is in "completed" state
 *  - an explicit confirmation token ("RESTORE") is provided
 *  - the node's REST API supports restore (PVE `qmrestore`-backed create with `restore`).
 *    On nodes where the API schema rejects `restore`, this falls back to an SSH
 *    `qmrestore` worker that runs directly on the node.
 *
 * The VM is never auto-started afterwards; it remains stopped for the customer to
 * start explicitly.
 */
export async function restoreVmFromBackup(input: {
  customerId?: string
  vpsInstanceId: string
  backupId: string
  confirmation?: string
  actor?: string
  onProgress?: (patch: { phase?: string; percent?: number | null; logTail?: string[]; transferredLabel?: string | null; totalLabel?: string | null; speedLabel?: string | null }) => void
}): Promise<VmRestoreResult> {
  const { vpsInstanceId, backupId, confirmation, actor = "client", onProgress } = input

  if (!backupId) throw new ProxmoxError(400, "backupId is required")
  if (String(confirmation || "").trim().toUpperCase() !== "RESTORE") {
    throw new ProxmoxError(400, 'Restore requires the explicit confirmation token "RESTORE"')
  }

  const backup = await prisma.vmBackup.findUnique({ where: { id: backupId } })
  if (!backup) throw new ProxmoxError(404, "Backup not found")
  if (String(backup.vpsInstanceId) !== String(vpsInstanceId)) throw new ProxmoxError(403, "Backup does not belong to this instance")
  if (input.customerId && String(backup.customerId || "") !== String(input.customerId)) throw new ProxmoxError(403, "Backup does not belong to this account")

  const volid = volidOfBackup(backup)
  if (!volid) throw new ProxmoxError(409, `Backup has no restorable archive (status=${backup.status})`)
  if (backup.status !== "completed") throw new ProxmoxError(409, `Only completed backups can be restored (current status=${backup.status})`)

  const instance = await prisma.vpsInstance.findUnique({ where: { id: vpsInstanceId } })
  if (!instance || !instance.vmid) throw new ProxmoxError(404, "Instance not found")

  const node = backup.proxmoxNodeId ? await prisma.proxmoxNode.findUnique({ where: { id: backup.proxmoxNodeId } }) : null
  if (!node || !node.host || !node.nodeName) throw new ProxmoxError(404, "Proxmox node not found")

  const client = proxmoxClientForNode(node)
  const runtime = await client.getVMStatus(node.nodeName, Number(instance.vmid)).catch(() => null)
  const status = String(runtime?.status || "").toLowerCase()
  if (status !== "stopped") {
    throw new ProxmoxError(409, `VM must be stopped before restore (current status=${status || "unknown"})`)
  }

  try {
    const payload = await client.restoreVMFromDump(node.nodeName, {
      vmid: Number(instance.vmid),
      name: instance.instanceName || instance.name || `VM-${instance.vmid}`,
      restore: volid,
    })
    const upid = normalizeUpid(payload)

    if (upid) {
      onProgress?.({ phase: "Restoring cloud server from archive", percent: null })
      const task = await client.waitForTask(node.nodeName, upid, VM_RESTORE_TIMEOUT_MS).catch(async (error: any) => {
        const unsupported = error instanceof ProxmoxError && isUnsupportedRestore(error)
        if (unsupported) return null
        throw error
      })
      if (!task) return { taskId: upid, status: "unsupported", reason: "Restore task rejected by node; API-based restore is unavailable on this Proxmox node." }
    }

    const verified = await client.getVMStatus(node.nodeName, Number(instance.vmid)).catch(() => null)
    const verifyStatus = String(verified?.status || "").toLowerCase()
    if (verifyStatus !== "stopped") {
      return {
        taskId: upid,
        status: "completed",
        verifyStatus,
        reason: "Restore finished but the VM is no longer stopped; the customer must start it explicitly.",
      }
    }

    await prisma.vmBackup
      .update({
        where: { id: backup.id },
        data: { metadata: { ...(backup.metadata as Record<string, unknown>), restoredAt: new Date().toISOString(), restoredBy: actor, restoreTask: upid || null } },
      })
      .catch(() => null)

    writeAuditLog({
      action: "vm.restore.completed",
      customerId: backup.customerId,
      targetType: "vm_backup",
      targetId: backup.id,
      newValue: { vmid: Number(instance.vmid), volid, restoreTask: upid || null, verifyStatus },
      metadata: { vpsInstanceId, actor },
    }).catch(() => null)

    return { taskId: upid, status: "completed", verifyStatus: "stopped" }
  } catch (error: any) {
    if (error instanceof ProxmoxError && isUnsupportedRestore(error)) {
      const ssh = await restoreVmViaSsh({
        node: {
          host: node.host,
          sshUsername: (node as any).sshUsername || null,
          sshPassword: (node as any).sshPassword || null,
          nodeName: node.nodeName,
        },
        vmid: Number(instance.vmid),
        volid,
        storage: null,
        onOutput: (text) => {
          onProgress?.({
            phase: "Restoring cloud server from archive",
            logTail: text.split("\n").map((line) => line.trim()).filter(Boolean),
            percent: null,
          })
        },
      })
      if (ssh.status === "completed") {
        const verified = await client.getVMStatus(node.nodeName, Number(instance.vmid)).catch(() => null)
        const verifyStatus = String(verified?.status || "").toLowerCase()
        await prisma.vmBackup
          .update({
            where: { id: backup.id },
            data: { metadata: { ...(backup.metadata as Record<string, unknown>), restoredAt: new Date().toISOString(), restoredBy: actor, restoreTask: "ssh-qmrestore", verifyStatus } },
          })
          .catch(() => null)
        writeAuditLog({
          action: "vm.restore.completed",
          customerId: backup.customerId,
          targetType: "vm_backup",
          targetId: backup.id,
          newValue: { vmid: Number(instance.vmid), volid, restoreTask: "ssh-qmrestore", verifyStatus },
          metadata: { vpsInstanceId, actor, mechanism: "ssh-qmrestore" },
        }).catch(() => null)
        return {
          taskId: null,
          status: "completed",
          verifyStatus,
          reason: verifyStatus === "stopped" ? undefined : `SSH restore finished but the VM is no longer stopped (${verifyStatus}).`,
        }
      }

      const reason = ssh.reason || "SSH qmrestore restore failed on the node."
      writeAuditLog({
        action: "vm.restore.failed",
        customerId: backup.customerId,
        targetType: "vm_backup",
        targetId: backup.id,
        newValue: { vmid: Number(instance.vmid), volid, reason, mechanism: "ssh-qmrestore" },
        metadata: { vpsInstanceId, actor },
      }).catch(() => null)
      return { taskId: null, status: "failed", reason }
    }
    writeAuditLog({
      action: "vm.restore.failed",
      customerId: backup.customerId,
      targetType: "vm_backup",
      targetId: backup.id,
      newValue: { vmid: Number(instance.vmid), volid, error: String(error?.message || "unknown") },
      metadata: { vpsInstanceId, actor },
    }).catch(() => null)
    throw error
  }
}

export async function latestCompletedBackupForInstance(vpsInstanceId: string): Promise<{ id: string; status: string } | null> {
  const row = await prisma.vmBackup.findFirst({
    where: { vpsInstanceId: String(vpsInstanceId), status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { id: true, status: true },
  })
  return row
}