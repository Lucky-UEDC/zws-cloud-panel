/**
 * Guest disk telemetry collectors.
 *
 * Design rules (enforced here, not just by callers):
 *  - Linux guests are ONLY probed with `df -B1 -P`; Windows guests are ONLY
 *    probed with PowerShell (Get-CimInstance) with a `wmic` fallback. The OS
 *    is resolved by `lib/vm-os-detection.ts` from authoritative metadata; an
 *    unknown OS produces `OS_UNKNOWN` and no guest command is ever run.
 *  - Parser-level cross-OS guards refuse to interpret a Windows payload as
 *    `df` output (and vice versa), so a mis-typed collect can never yield
 *    a plausible-but-wrong reading.
 *  - Totals describe the SELECTED volume: the root filesystem `/` (Linux) or
 *    the system/fixed drive `C:` (Windows), falling back to the backing/largest
 *    filesystem. Summing every volume inflates the disk percentage on guests
 *    with data disks, which is a customer-visible bug we do not repeat.
 *  - Every failure carries a machine-readable error code:
 *    OS_UNKNOWN, GUEST_AGENT_DISABLED, GUEST_AGENT_TIMEOUT, GUEST_EXEC_FAILED,
 *    PARSE_FAILED, DISK_DATA_INVALID.
 *  - Exec timeouts are distinguishable from parse failures (`timedOut` on
 *    GuestExecOutcome) so the worker can apply backoff instead of re-running a
 *    dead agent every poll.
 */

import { guestOsFromHint, type VmGuestOsKind } from "@/lib/vm-os-detection"

export const LINUX_DF_COMMAND = ["df", "-B1", "-P"]
export const WINDOWS_PS_CIM_COMMAND = [
  "powershell",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,DriveType,Size,FreeSpace,FileSystem,VolumeName | ConvertTo-Json -Compress",
]
export const WINDOWS_WMIC_COMMAND = ["wmic", "logicaldisk", "get", "DeviceID,Size,FreeSpace", "/format:list"]

export type VmDiskErrorCode =
  | "OS_UNKNOWN"
  | "GUEST_AGENT_DISABLED"
  | "GUEST_AGENT_TIMEOUT"
  | "GUEST_EXEC_FAILED"
  | "PARSE_FAILED"
  | "DISK_DATA_INVALID"
  | "VM_STOPPED"

export type VmDiskSource = "guest-agent-linux" | "guest-agent-windows" | "last-known" | "unavailable"

export type GuestDiskVolume = {
  name: string
  mountpoint?: string | null
  drive?: string | null
  filesystem?: string | null
  totalBytes: number
  usedBytes: number
  freeBytes: number
  system?: boolean
  errorCode?: VmDiskErrorCode | null
  error?: string | null
}

export type GuestDiskUsage = {
  ok: boolean
  os: VmGuestOsKind
  source: VmDiskSource
  totalBytes: number
  usedBytes: number
  freeBytes: number
  volumes: GuestDiskVolume[]
  selectedVolume?: GuestDiskVolume | null
  errorCode?: VmDiskErrorCode | null
  error?: string | null
  collectionDurationMs?: number | null
  checkedAt?: string | null
}

export type GuestExecOutcome = {
  ok: boolean
  timedOut: boolean
  exited: boolean
  exitCode: number | null
  output: string
  errorCode: VmDiskErrorCode | null
  error?: string | null
  status: any
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function empty(
  source: VmDiskSource,
  errorCode: VmDiskErrorCode | null = null,
  error: string | null = null,
  os: VmGuestOsKind = "unknown",
): GuestDiskUsage {
  return {
    ok: false,
    os,
    source,
    totalBytes: 0,
    usedBytes: 0,
    freeBytes: 0,
    volumes: [],
    selectedVolume: null,
    errorCode,
    error,
    collectionDurationMs: null,
    checkedAt: null,
  }
}

/** Reject negative / non-finite values and used>total / free>total. */
function validateVolume(totalBytes: number, usedBytes: number, freeBytes: number): string | null {
  if (![totalBytes, usedBytes, freeBytes].every((n) => Number.isFinite(n) && n >= 0)) {
    return "non-finite or negative disk values"
  }
  if (usedBytes > totalBytes) return "used exceeds total"
  if (freeBytes > totalBytes) return "free exceeds total"
  return null
}

function pctRawInRange(pctRaw: string | undefined): boolean {
  if (pctRaw === undefined || pctRaw === "" || pctRaw === "-") return true
  const pct = Number(pctRaw.replace("%", ""))
  if (!Number.isFinite(pct)) return true
  return pct >= 0 && pct <= 100
}

function decorateTotals(usage: GuestDiskUsage, selected: GuestDiskVolume): GuestDiskUsage {
  return {
    ...usage,
    ok: true,
    totalBytes: selected.totalBytes,
    usedBytes: selected.usedBytes,
    freeBytes: selected.freeBytes,
    selectedVolume: selected,
  }
}

/* ------------------------------------------------------------------ *
 * Linux `df -B1 -P`
 * ------------------------------------------------------------------ */

const LINUX_PSEUDO_FS = /^(proc|sysfs|devtmpfs|tmpfs|devpts|cgroup2?|overlay|squashfs|efivarfs|mqueue|shm|hugetlbfs|ramfs)$/i
const LINUX_PSEUDO_MOUNT = /^\/(proc|sys|dev|run)(\/|$)/i

function looksLikeWindowsPayload(output: string): boolean {
  const text = String(output || "")
  return /^\s*DeviceID\s*=/im.test(text) || /"DeviceID"\s*:/.test(text) || /SizeRemaining/.test(text)
}

export function parseLinuxDfBytes(output: string): GuestDiskUsage {
  if (looksLikeWindowsPayload(output)) {
    return empty("guest-agent-linux", "PARSE_FAILED", "windows payload passed to linux df parser", "linux")
  }
  const volumes: GuestDiskVolume[] = []
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    // Skip header lines like "Filesystem 1B-blocks Used Available Use% Mounted on".
    const total = Number(parts[1])
    if (!parts[1] || !Number.isFinite(total)) continue
    const used = Number(parts[2])
    const avail = Number(parts[3])
    if (!Number.isFinite(used) || !Number.isFinite(avail)) continue
    let mount = parts.slice(5).join(" ").replace(/\\040/g, " ").replace(/\\011/g, "\t").trim()
    if (!mount) mount = "/"
    const fs = parts[0] || ""
    if (LINUX_PSEUDO_FS.test(fs)) continue
    if (LINUX_PSEUDO_MOUNT.test(mount)) continue
    const totalBytes = total
    const freeBytes = avail
    const usedBytes = used
    const validationError = validateVolume(totalBytes, usedBytes, freeBytes)
    const pctOk = pctRawInRange(parts[4])
    const error = validationError || (pctOk ? null : "df percent out of range")
    volumes.push({
      name: fs,
      mountpoint: mount,
      filesystem: fs,
      totalBytes,
      usedBytes,
      freeBytes,
      system: mount === "/",
      errorCode: error ? "DISK_DATA_INVALID" : null,
      error,
    })
  }

  if (!volumes.length) {
    return empty("guest-agent-linux", "PARSE_FAILED", "df output unparseable or all filesystems filtered", "linux")
  }
  const valid = volumes.filter((volume) => !volume.errorCode)
  if (!valid.length) {
    return { ...empty("guest-agent-linux", "DISK_DATA_INVALID", "all df filesystems failed validation", "linux"), volumes }
  }
  const selected = selectLinuxVolume(valid)
  return decorateTotals(
    { ...empty("guest-agent-linux", null, null, "linux"), volumes },
    selected,
  )
}

function selectLinuxVolume(volumes: GuestDiskVolume[]): GuestDiskVolume {
  const root = volumes.find((volume) => volume.mountpoint === "/")
  if (root) return root
  const backing = volumes.find((volume) => /^\/dev\//.test(volume.filesystem || volume.name || ""))
  if (backing) return backing
  return [...volumes].sort((a, b) => b.totalBytes - a.totalBytes)[0]!
}

/* ------------------------------------------------------------------ *
 * Windows PowerShell / WMI
 * ------------------------------------------------------------------ */

function looksLikeLinuxPayload(output: string): boolean {
  const text = String(output || "")
  return /^Filesystem\s+\S+\s+Used\s+Available/im.test(text) || /\/dev\/(sd|vd|xvd|nvme|mapper|disk|md)/.test(text)
}

function wmicRows(output: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  let row: Record<string, string> = {}
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (Object.keys(row).length) rows.push(row)
      row = {}
      continue
    }
    const match = line.match(/^([^=]+)=(.*)$/)
    if (!match) continue
    row[match[1]!.trim()] = match[2]!.trim()
  }
  if (Object.keys(row).length) rows.push(row)
  return rows
}

function powershellRows(output: string): Record<string, any>[] {
  const text = String(output || "").trim()
  if (!text) return []
  if (/^\s*DeviceID\s*=/im.test(text)) return wmicRows(text)
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    return parsed && typeof parsed === "object" ? [parsed] : []
  } catch {
    return text.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z]\s+\d+\s+\d+/i.test(line))
      .map((line) => {
        const [driveLetter, sizeRemaining, size, fileSystemLabel, fileSystem] = line.split(/\s+/)
        return { DriveLetter: driveLetter, SizeRemaining: sizeRemaining, Size: size, FileSystemLabel: fileSystemLabel, FileSystem: fileSystem }
      })
  }
}

function volumeLetter(row: Record<string, any>): string | null {
  const raw = String(row.DriveLetter ?? row.driveLetter ?? row.drive ?? row.DeviceID ?? row.deviceId ?? "").replace(/:$/, "").trim().toUpperCase()
  return /^[A-Z]$/.test(raw) ? raw : null
}

function isIgnoredWindowsDriveType(row: Record<string, any>): boolean {
  const raw = row.DriveType ?? row.driveType
  if (raw === null || raw === undefined || raw === "") return false
  const driveType = Number(raw)
  if (!Number.isFinite(driveType)) return false
  // 2 = removable, 5 = CD-ROM. Fixed disks are 3 (and 0 = unknown, keep it).
  return driveType === 2 || driveType === 5
}

export function parseWindowsVolumes(output: string): GuestDiskUsage {
  if (looksLikeLinuxPayload(output)) {
    return empty("guest-agent-windows", "PARSE_FAILED", "linux df payload passed to windows parser", "windows")
  }
  const volumes: GuestDiskVolume[] = []
  for (const row of powershellRows(output)) {
    if (isIgnoredWindowsDriveType(row)) continue
    const letter = volumeLetter(row)
    if (!letter) continue
    const totalBytes = numberValue(row.Size ?? row.size)
    const freeBytes = numberValue(row.SizeRemaining ?? row.sizeRemaining ?? row.FreeSpace ?? row.freeSpace ?? row.Free ?? row.free)
    // A parsed-but-zero total (missing field) is not a fixed disk.
    if (totalBytes <= 0) continue
    const usedBytes = Math.max(0, totalBytes - freeBytes)
    const validationError = validateVolume(totalBytes, usedBytes, freeBytes)
    volumes.push({
      name: `${letter}:`,
      drive: letter,
      mountpoint: `${letter}:\\`,
      filesystem: row.FileSystem || row.fileSystem || null,
      totalBytes,
      usedBytes,
      freeBytes,
      system: letter === "C",
      errorCode: validationError ? "DISK_DATA_INVALID" : null,
      error: validationError,
    })
  }

  if (!volumes.length) {
    return empty("guest-agent-windows", "PARSE_FAILED", "windows volume output unparseable", "windows")
  }
  const valid = volumes.filter((volume) => !volume.errorCode)
  if (!valid.length) {
    return { ...empty("guest-agent-windows", "DISK_DATA_INVALID", "all windows volumes failed validation", "windows"), volumes }
  }
  valid.sort((a, b) => Number(b.system) - Number(a.system) || b.totalBytes - a.totalBytes)
  const selected = valid[0]!
  return decorateTotals(
    { ...empty("guest-agent-windows", null, null, "windows"), volumes },
    selected,
  )
}

/* ------------------------------------------------------------------ *
 * Guest exec plumbing
 * ------------------------------------------------------------------ */

function outputFromExecStatus(status: any) {
  const result = status?.result || status || {}
  return String(result["out-data"] || result.outData || result.stdout || "")
}

export async function waitForGuestExec(client: any, nodeName: string, vmid: number, pid: number, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last: any = null
  while (Date.now() < deadline) {
    last = await client.getVMGuestExecStatus(nodeName, vmid, pid)
    const result = last?.result || last || {}
    if (result.exited === true || result.exited === 1) return last
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return last
}

function exitFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1"
}

/**
 * Poll a guest exec status to completion. Unlike the legacy `waitForGuestExec`,
 * a timeout is NOT conflated with a parse failure: `timedOut` is set and the
 * error code is `GUEST_AGENT_TIMEOUT` so callers can back off a dead agent.
 */
export async function waitForGuestExecOutcome(
  client: any,
  nodeName: string,
  vmid: number,
  pid: number,
  timeoutMs = 30_000,
  pollMs = 750,
): Promise<GuestExecOutcome> {
  const deadline = Date.now() + timeoutMs
  let last: any = null
  let timedOut = true
  while (Date.now() < deadline) {
    last = await client.getVMGuestExecStatus(nodeName, vmid, pid)
    const result = last?.result || last || {}
    if (exitFlag(result.exited)) {
      timedOut = false
      break
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  const result = last?.result || last || {}
  const exited = exitFlag(result.exited)
  const output = outputFromExecStatus(last)
  if (timedOut) {
    return {
      ok: false,
      timedOut: true,
      exited,
      exitCode: null,
      output: "",
      errorCode: "GUEST_AGENT_TIMEOUT",
      error: `guest exec pid ${pid} did not finish within ${timeoutMs}ms`,
      status: last,
    }
  }
  if (!exited) {
    return {
      ok: false,
      timedOut: false,
      exited,
      exitCode: null,
      output: "",
      errorCode: "GUEST_EXEC_FAILED",
      error: "guest exec status unavailable",
      status: last,
    }
  }
  const exitCode = Number(result.exitcode ?? result.exitCode ?? 0)
  if (!Number.isFinite(exitCode) || exitCode !== 0) {
    const errData = String(result["err-data"] || result.errData || "").trim()
    return {
      ok: false,
      timedOut: false,
      exited,
      exitCode,
      output,
      errorCode: "GUEST_EXEC_FAILED",
      error: errData || `guest command exited with code ${exitCode}`,
      status: last,
    }
  }
  return { ok: true, timedOut: false, exited, exitCode, output, errorCode: null, error: null, status: last }
}

function guestExecErrorMessage(error: any): string {
  return String(error?.proxmoxResponse || error?.proxmoxMessage || error?.message || error || "guest exec failed")
}

function guestExecErrorCode(error: any): VmDiskErrorCode {
  const detail = guestExecErrorMessage(error).toLowerCase()
  if (/timeout|timed ?out/i.test(detail)) return "GUEST_AGENT_TIMEOUT"
  if (
    /agent/.test(detail) &&
    /(not running|disabled|not enabled|can'?t connect|cannot connect|unable to connect|connection (closed|refused)|inactive|no agent|start the service|channel is closed)/i.test(detail)
  ) {
    return "GUEST_AGENT_DISABLED"
  }
  return "GUEST_EXEC_FAILED"
}

async function runGuestCommandOutcome(input: {
  client: any
  nodeName: string
  vmid: number
  command: string[]
  timeoutMs?: number
}): Promise<GuestExecOutcome> {
  let exec: any
  try {
    exec = await input.client.execVMGuestCommand(input.nodeName, input.vmid, input.command)
  } catch (error: any) {
    return {
      ok: false,
      timedOut: false,
      exited: false,
      exitCode: null,
      output: "",
      errorCode: guestExecErrorCode(error),
      error: guestExecErrorMessage(error),
      status: null,
    }
  }
  const pid = Number((exec as any)?.pid || (exec as any)?.result?.pid || 0)
  if (!pid) {
    return {
      ok: false,
      timedOut: false,
      exited: false,
      exitCode: null,
      output: "",
      errorCode: "GUEST_EXEC_FAILED",
      error: "guest exec returned no pid",
      status: exec,
    }
  }
  return waitForGuestExecOutcome(input.client, input.nodeName, input.vmid, pid, input.timeoutMs || 30_000)
}

async function runGuestCommand(input: { client: any; nodeName: string; vmid: number; command: string[]; timeoutMs?: number }) {
  const outcome = await runGuestCommandOutcome(input)
  return outcome.status
}

/* ------------------------------------------------------------------ *
 * Collectors
 * ------------------------------------------------------------------ */

function emptyFromOutcome(source: VmDiskSource, os: VmGuestOsKind, outcome: GuestExecOutcome): GuestDiskUsage {
  return empty(source, outcome.errorCode || "GUEST_EXEC_FAILED", outcome.error || "guest exec failed", os)
}

function finalize(usage: GuestDiskUsage, startedAt: number): GuestDiskUsage {
  if (!usage.ok && !usage.errorCode) {
    return { ...usage, errorCode: "PARSE_FAILED", error: usage.error || "guest disk output unparseable", collectionDurationMs: Date.now() - startedAt, checkedAt: new Date().toISOString() }
  }
  return {
    ...usage,
    collectionDurationMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  }
}

async function collectLinuxDiskUsage(input: { client: any; nodeName: string; vmid: number; timeoutMs?: number }, startedAt: number): Promise<GuestDiskUsage> {
  const outcome = await runGuestCommandOutcome({
    client: input.client,
    nodeName: input.nodeName,
    vmid: input.vmid,
    command: LINUX_DF_COMMAND,
    timeoutMs: input.timeoutMs || 30_000,
  })
  if (!outcome.ok) return finalize(emptyFromOutcome("guest-agent-linux", "linux", outcome), startedAt)
  const parsed = parseLinuxDfBytes(outcome.output)
  if (!parsed.ok) return finalize(parsed, startedAt)
  return finalize({ ...parsed, os: "linux" }, startedAt)
}

type WinAttempt = { outcome: GuestExecOutcome; usage: GuestDiskUsage | null }

async function collectWindowsDiskUsage(input: { client: any; nodeName: string; vmid: number; timeoutMs?: number }, startedAt: number): Promise<GuestDiskUsage> {
  const attempt = async (command: string[]): Promise<WinAttempt> => {
    const outcome = await runGuestCommandOutcome({
      client: input.client,
      nodeName: input.nodeName,
      vmid: input.vmid,
      command,
      timeoutMs: input.timeoutMs || 30_000,
    })
    if (!outcome.ok) return { outcome, usage: null }
    return { outcome, usage: parseWindowsVolumes(outcome.output) }
  }

  const primary = await attempt(WINDOWS_PS_CIM_COMMAND)
  if (primary.usage?.ok) return finalize(primary.usage, startedAt)

  const agentLevelFailure =
    primary.outcome.errorCode === "GUEST_AGENT_DISABLED" || primary.outcome.errorCode === "GUEST_AGENT_TIMEOUT"
  if (agentLevelFailure) return finalize(emptyFromOutcome("guest-agent-windows", "windows", primary.outcome), startedAt)

  // PowerShell missing/unavailable on the guest (removed in modern Windows) or
  // its output was unparseable → retry once with wmic before giving up.
  const fallback = await attempt(WINDOWS_WMIC_COMMAND)
  if (fallback.usage?.ok) return finalize(fallback.usage, startedAt)

  const bestOf = (a: WinAttempt, b: WinAttempt): GuestDiskUsage => {
    if (b.usage && !b.usage.ok) return b.usage
    if (!b.outcome.ok) return emptyFromOutcome("guest-agent-windows", "windows", b.outcome)
    if (a.usage && !a.usage.ok) return a.usage
    return emptyFromOutcome("guest-agent-windows", "windows", a.outcome)
  }
  return finalize(bestOf(primary, fallback), startedAt)
}

/**
 * Collect guest disk usage for a single VM.
 *
 * `os` (from `resolveVmGuestOs`) is authoritative; `osHint` is only a
 * back-compat fallback for callers that still carry a metadata-built hint.
 * When the resolved OS is unknown no guest command is executed and the result
 * carries error code `OS_UNKNOWN`.
 */
export async function collectGuestDiskUsage(input: {
  client: any
  nodeName: string
  vmid: number
  os?: VmGuestOsKind | null
  osHint?: string | null
  timeoutMs?: number
}): Promise<GuestDiskUsage> {
  const startedAt = Date.now()
  const os = input.os || guestOsFromHint(input.osHint)
  if (os === "unknown") {
    return finalize(empty("unavailable", "OS_UNKNOWN", "OS detection unavailable", "unknown"), startedAt)
  }
  const usage = os === "windows"
    ? await collectWindowsDiskUsage(input, startedAt)
    : await collectLinuxDiskUsage(input, startedAt)
  return usage
}

/* ------------------------------------------------------------------ *
 * Primary-disk online resize
 * ------------------------------------------------------------------ */

export async function expandGuestPrimaryDisk(input: {
  client: any
  nodeName: string
  vmid: number
  os?: VmGuestOsKind | null
  previousTotalBytes?: number | null
}) {
  const os = input.os || "unknown"
  const before = input.previousTotalBytes && input.previousTotalBytes > 0
    ? input.previousTotalBytes
    : (await collectGuestDiskUsage(input).catch(() => null))?.totalBytes || 0

  if (os === "windows") {
    await runGuestCommand({
      client: input.client,
      nodeName: input.nodeName,
      vmid: input.vmid,
      command: [
        "powershell",
        "-NoProfile",
        "-Command",
        "$p=Get-Partition | Where-Object DriveLetter | Sort-Object Size -Descending | Select-Object -First 1; if($p){$s=Get-PartitionSupportedSize -DiskNumber $p.DiskNumber -PartitionNumber $p.PartitionNumber; Resize-Partition -DiskNumber $p.DiskNumber -PartitionNumber $p.PartitionNumber -Size $s.SizeMax}",
      ],
      timeoutMs: 120_000,
    })
  } else if (os === "linux") {
    await runGuestCommand({
      client: input.client,
      nodeName: input.nodeName,
      vmid: input.vmid,
      command: [
        "sh",
        "-lc",
        "set -e; root=$(findmnt -no SOURCE /); part=${root##*/}; disk=/dev/$(echo \"$part\" | sed -E 's/p?[0-9]+$//'); num=$(echo \"$part\" | grep -oE '[0-9]+$'); command -v growpart >/dev/null 2>&1 && growpart \"$disk\" \"$num\" || true; fs=$(findmnt -no FSTYPE /); if [ \"$fs\" = xfs ]; then xfs_growfs /; else resize2fs \"$root\"; fi",
      ],
      timeoutMs: 120_000,
    })
  }

  const after = os === "unknown" ? empty("unavailable", "OS_UNKNOWN", "OS detection unavailable", "unknown") : await collectGuestDiskUsage({ client: input.client, nodeName: input.nodeName, vmid: input.vmid, os })
  return {
    ok: after.ok && (!before || after.totalBytes >= before),
    beforeTotalBytes: before,
    afterTotalBytes: after.totalBytes,
    usage: after,
  }
}

export function configuredMemoryBytes(config: Record<string, any> | null | undefined, fallbackBytes?: unknown) {
  const memoryMb = numberValue(config?.memory)
  if (memoryMb > 0) return Math.floor(memoryMb * 1024 * 1024)
  return Math.max(0, Math.floor(numberValue(fallbackBytes)))
}