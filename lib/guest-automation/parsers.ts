/**
 * Output parsers for guest operations.
 *
 * Every parser here is OS-specific and carries an explicit cross-OS guard: a
 * Windows payload is never interpreted as `df` output and vice versa. The
 * normalized result shape is identical for both engines, which is what lets the
 * frontend stay completely OS agnostic.
 *
 * Normalized disk result:
 *   { filesystem, totalBytes, usedBytes, freeBytes, usedPercent, volumes[] }
 *
 * There is no random or synthetic path in this file. A parse that cannot be
 * trusted returns `ok: false` with a machine-readable code, and the caller
 * keeps showing the last known good value.
 */

import type { GuestErrorCode } from "./constants"

export type ParsedVolume = {
  /** Mount point on Linux, drive letter on Windows. */
  name: string
  filesystem?: string | null
  device?: string | null
  totalBytes: number
  usedBytes: number
  freeBytes: number
  usedPercent: number
  /** True for the root/system volume that should drive the headline number. */
  system?: boolean
}

export type ParsedDiskUsage = {
  ok: true
  volumes: ParsedVolume[]
  selected: ParsedVolume | null
  collector: string
}

export type ParseFailure = { ok: false; errorCode: GuestErrorCode; error: string }
export type ParseResult = ParsedDiskUsage | ParseFailure

/**
 * Pseudo filesystems that must never be treated as customer storage.
 * Including these is how a naive `df` collector ends up reporting `overlay` or
 * `squashfs` as "the root filesystem" with nonsense sizes.
 */
const LINUX_IGNORED_FILESYSTEM_TYPES = new Set([
  "proc",
  "sysfs",
  "devtmpfs",
  "devpts",
  "tmpfs",
  "cgroup",
  "cgroup2",
  "overlay",
  "squashfs",
  "efivarfs",
  "securityfs",
  "pstore",
  "bpf",
  "debugfs",
  "tracefs",
  "fusectl",
  "configfs",
  "mqueue",
  "hugetlbfs",
  "autofs",
  "binfmt_misc",
  "nsfs",
  "ramfs",
  "rpc_pipefs",
])

const LINUX_IGNORED_MOUNT_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/snap"]

function bytes(value: unknown): number {
  const parsed = Number(String(value ?? "").trim())
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function percent(used: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const value = (used / total) * 100
  return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
}

/** used + free must reconcile with total, otherwise the row is untrustworthy. */
function rowIsConsistent(total: number, used: number, free: number): boolean {
  if (!(total > 0)) return false
  if (used > total) return false
  if (free > total) return false
  // POSIX reserves some blocks; allow a generous 5% slack either way.
  const slack = total * 0.05
  return Math.abs(total - (used + free)) <= slack
}

function selectLinuxRoot(volumes: ParsedVolume[]): ParsedVolume | null {
  if (!volumes.length) return null
  const root = volumes.find((volume) => volume.name === "/")
  if (root) return root
  // The mount that backs `/` when `/` itself is a bind/overlay we filtered out.
  const backing = volumes.find((volume) => volume.name.startsWith("/") && !LINUX_IGNORED_MOUNT_PREFIXES.some((p) => volume.name.startsWith(p)))
  if (backing) return backing
  return [...volumes].sort((a, b) => b.totalBytes - a.totalBytes)[0] ?? null
}

/**
 * Parse `df -B1 -P` output.
 *
 * `-B1` gives bytes and `-P` guarantees one line per filesystem, but a mount
 * point may still contain spaces, so the numeric fields are located relative to
 * the `Use%` column rather than from either edge. That is what makes a
 * positional parse safe.
 *
 * The reported percentage is taken from `df` itself: it accounts for the
 * filesystem's reserved blocks, so recomputing `used / total` systematically
 * disagrees with the number the guest itself reports.
 */
export function parseLinuxDf(output: string): ParseResult {
  const text = String(output || "")
  if (!text.trim()) return { ok: false, errorCode: "PARSE_FAILED", error: "df produced no output" }

  // Cross-OS guard: a Windows payload here means the wrong command ran.
  if (/^\s*DeviceID\s*=/m.test(text) || /LogicalDisk/i.test(text) || /^\s*DriveType\s*[:=]/m.test(text)) {
    return { ok: false, errorCode: "PARSE_FAILED", error: "Windows volume payload received by the df parser" }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim())
  if (!lines.length) return { ok: false, errorCode: "PARSE_FAILED", error: "df produced no usable lines" }

  const headerIndex = lines.findIndex((line) => /^filesystem\b/i.test(line.trim()))
  if (headerIndex === -1) {
    // `df` without a recognised header: refuse rather than guess positions.
    return { ok: false, errorCode: "PARSE_FAILED", error: "df output has no recognizable header" }
  }

  const volumes: ParsedVolume[] = []
  let rejected = 0
  let ignoredCount = 0
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 6) continue

    // Anchor on the Use% column: it is the only field with a `%` suffix.
    const capacityIndex = fields.findIndex((field) => /^\d{1,3}%$/.test(field))
    if (capacityIndex < 4 || capacityIndex + 1 >= fields.length) {
      rejected++
      continue
    }
    const total = bytes(fields[capacityIndex - 3])
    const used = bytes(fields[capacityIndex - 2])
    const free = bytes(fields[capacityIndex - 1])
    const reportedPercent = Number(fields[capacityIndex].replace("%", ""))
    const mountPoint = fields.slice(capacityIndex + 1).join(" ") || "/"
    const device = fields.slice(0, capacityIndex - 3).join(" ")

    if (!rowIsConsistent(total, used, free)) {
      rejected++
      continue
    }
    // Pseudo filesystems are dropped here, not filtered later, so a caller
    // iterating `volumes` can never pick up `overlay` or `tmpfs` as root.
    if (
      LINUX_IGNORED_FILESYSTEM_TYPES.has(String(device).split("/").pop()?.toLowerCase() || "") ||
      LINUX_IGNORED_MOUNT_PREFIXES.some((prefix) => mountPoint === prefix || mountPoint.startsWith(`${prefix}/`))
    ) {
      ignoredCount++
      continue
    }
    volumes.push({
      name: mountPoint,
      device,
      // POSIX df reports no filesystem type; `df -B1 -P` has no such column, so
      // this stays null rather than being guessed from the device name.
      filesystem: null,
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usedPercent: Number.isFinite(reportedPercent) ? Math.min(100, Math.max(0, reportedPercent)) : percent(used, total),
      system: mountPoint === "/",
    })
  }

  if (!volumes.length) {
    return {
      ok: false,
      errorCode: ignoredCount ? "DISK_DATA_INVALID" : "PARSE_FAILED",
      error: ignoredCount
        ? "every reported filesystem was a pseudo filesystem"
        : `no reconcilable df rows (${rejected} rejected)`,
    }
  }

  const selected = selectLinuxRoot(volumes)
  if (!selected) return { ok: false, errorCode: "DISK_DATA_INVALID", error: "no selectable root filesystem" }
  return { ok: true, volumes, selected, collector: "linux_df" }
}

function isIgnoredWindowsDriveType(value: unknown): boolean {
  // DriveType: 0 unknown, 1 no root dir, 2 removable, 3 fixed, 4 network,
  // 5 cdrom, 6 ramdisk. We only accept fixed (3) and ramdisk-free local media.
  const type = Number(value)
  if (!Number.isFinite(type)) return true
  return type !== 3
}

function selectWindowsDrive(volumes: ParsedVolume[]): ParsedVolume | null {
  if (!volumes.length) return null
  const c = volumes.find((volume) => volume.name.toUpperCase() === "C:")
  if (c) return c
  return [...volumes].sort((a, b) => b.totalBytes - a.totalBytes)[0] ?? null
}

/**
 * Parse the JSON emitted by `Get-CimInstance Win32_LogicalDisk ... |
 * ConvertTo-Json -Compress`. Accepts a single object or an array (PowerShell
 * unwraps a 1-element array when the pipeline yields one item).
 */
export function parseWindowsLogicalDiskJson(output: string): ParseResult {
  const text = String(output || "").trim()
  if (!text) return { ok: false, errorCode: "PARSE_FAILED", error: "PowerShell produced no output" }
  // Cross-OS guard: this is `df` output, not a Windows volume payload.
  if (/^filesystem\s+\d+\s+\d+/im.test(text) && !/DeviceID|FreeSpace/i.test(text)) {
    return { ok: false, errorCode: "PARSE_FAILED", error: "df payload received by the Windows parser" }
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return { ok: false, errorCode: "PARSE_FAILED", error: "PowerShell output was not valid JSON" }
  }

  const rows = Array.isArray(payload) ? payload : [payload]
  const volumes: ParsedVolume[] = []
  let sawIrrelevant = 0
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const record = row as Record<string, unknown>
    if (isIgnoredWindowsDriveType(record.DriveType)) {
      sawIrrelevant++
      continue
    }
    const deviceId = String(record.DeviceID ?? record.DeviceId ?? "").trim()
    if (!/^[A-Za-z]:$/.test(deviceId)) continue
    const total = bytes(record.Size)
    const free = bytes(record.FreeSpace)
    if (!rowIsConsistent(total, bytes(record.Size) - free, free)) continue
    const used = total - free
    volumes.push({
      name: deviceId,
      device: deviceId,
      filesystem: record.FileSystem ? String(record.FileSystem) : null,
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usedPercent: percent(used, total),
      system: deviceId.toUpperCase() === "C:",
    })
  }

  if (!volumes.length) {
    return {
      ok: false,
      errorCode: sawIrrelevant ? "DISK_DATA_INVALID" : "PARSE_FAILED",
      error: sawIrrelevant ? "only removable/CD/network drives were reported" : "no fixed volumes with valid sizes",
    }
  }
  const selected = selectWindowsDrive(volumes)
  if (!selected) return { ok: false, errorCode: "DISK_DATA_INVALID", error: "no selectable Windows volume" }
  return { ok: true, volumes, selected, collector: "windows_cim" }
}

/**
 * Parse `wmic logicaldisk get DeviceID,Size,FreeSpace /format:list`.
 * Used only as the legacy fallback when `Get-CimInstance` is unavailable.
 */
export function parseWindowsWmicList(output: string): ParseResult {
  const text = String(output || "")
  if (!text.trim()) return { ok: false, errorCode: "PARSE_FAILED", error: "wmic produced no output" }
  if (/^filesystem\s+\d+/im.test(text)) {
    return { ok: false, errorCode: "PARSE_FAILED", error: "df payload received by the wmic parser" }
  }

  const records: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (Object.keys(current).length) records.push(current)
      current = {}
      continue
    }
    const separator = line.indexOf("=")
    if (separator === -1) continue
    current[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim()
  }
  if (Object.keys(current).length) records.push(current)

  const volumes: ParsedVolume[] = []
  for (const record of records) {
    const deviceId = String(record.deviceid ?? "").trim()
    if (!/^[A-Za-z]:$/.test(deviceId)) continue
    const total = bytes(record.size)
    const free = bytes(record.freespace)
    if (!rowIsConsistent(total, total - free, free)) continue
    const used = total - free
    volumes.push({
      name: deviceId,
      device: deviceId,
      filesystem: record.filesystem || null,
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usedPercent: percent(used, total),
      system: deviceId.toUpperCase() === "C:",
    })
  }
  if (!volumes.length) return { ok: false, errorCode: "PARSE_FAILED", error: "no fixed volumes in wmic output" }
  const selected = selectWindowsDrive(volumes)
  if (!selected) return { ok: false, errorCode: "DISK_DATA_INVALID", error: "no selectable Windows volume" }
  return { ok: true, volumes, selected, collector: "windows_wmic" }
}

/**
 * Parse `fsutil volume diskfree C:` for the legacy Windows fallback.
 *
 * `fsutil` reports human-readable units ("100 GB"). Those are ambiguous across
 * locales and unit systems, so a payload we cannot read as a raw byte count is
 * REJECTED rather than converted with an assumed factor — a wrong number here
 * would silently misreport a customer's disk.
 */
export function parseWindowsFsutil(output: string, drive = "C:"): ParseResult {
  const text = String(output || "")
  if (!text.trim()) return { ok: false, errorCode: "PARSE_FAILED", error: "fsutil produced no output" }
  if (/^filesystem\s+\d+/im.test(text)) {
    return { ok: false, errorCode: "PARSE_FAILED", error: "df payload received by the fsutil parser" }
  }
  // The label alternation must be grouped, otherwise only the first branch
  // carries the capture group and the value silently comes back undefined.
  const pick = (label: RegExp) => {
    const match = text.match(new RegExp(`(?:${label.source})\\s*[:=]\\s*([0-9][0-9, ]*?)\\s*(bytes|byte)?\\s*$`, "im"))
    if (!match) return 0
    return bytes(match[1].replace(/[,\s]/g, ""))
  }
  const free = pick(/Free\s*Space|Free\s*Bytes|Available/)
  const total = pick(/Total\s*Space|Total\s*Bytes|Size/)
  if (!total || !free) {
    return { ok: false, errorCode: "PARSE_FAILED", error: "fsutil reported human-readable units, not bytes" }
  }
  if (!rowIsConsistent(total, total - free, free)) {
    return { ok: false, errorCode: "DISK_DATA_INVALID", error: "fsutil values did not reconcile" }
  }
  const used = total - free
  const volume: ParsedVolume = {
    name: drive,
    device: drive,
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    usedPercent: percent(used, total),
    system: true,
  }
  return { ok: true, volumes: [volume], selected: volume, collector: "windows_fsutil" }
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export type ParsedInterface = {
  name: string
  mac?: string | null
  ipv4: string[]
  ipv6: string[]
  /** True for the interface carrying the default route. */
  primary: boolean
  up: boolean
}

export type ParsedNetwork = {
  interfaces: ParsedInterface[]
  primary: ParsedInterface | null
}

/**
 * Normalise `agent/network-get-interfaces`. We never assume `eth0` / `ens18` /
 * `Ethernet`: the interface actually holding the guest address is selected.
 */
export function parseNativeInterfaces(payload: unknown): ParsedNetwork {
  const raw = Array.isArray(payload) ? payload : []
  const interfaces: ParsedInterface[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, any>
    if (record["name"] === "lo" || record["hardware-address"] === "00:00:00:00:00:00") continue
    const name = String(record["name"] ?? "").trim()
    if (!name) continue
    const ipv4: string[] = []
    const ipv6: string[] = []
    for (const address of Array.isArray(record["ip-addresses"]) ? record["ip-addresses"] : []) {
      const type = Number(address?.["ip-address-type"])
      const value = String(address?.["ip-address"] ?? "").trim()
      if (!value) continue
      if (type === 4) ipv4.push(value)
      else if (type === 6) ipv6.push(value)
    }
    interfaces.push({
      name,
      mac: record["hardware-address"] ? String(record["hardware-address"]) : null,
      ipv4,
      ipv6,
      primary: false,
      up: ipv4.length > 0,
    })
  }
  // Exactly one primary: the first interface with a routable IPv4, else the
  // first up interface. Ties are broken by name for deterministic behaviour.
  const sorted = [...interfaces].sort((a, b) => {
    if (a.ipv4.length !== b.ipv4.length) return b.ipv4.length - a.ipv4.length
    if (a.up !== b.up) return a.up ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  if (sorted[0]) sorted[0].primary = true
  return { interfaces: sorted, primary: sorted[0] ?? null }
}

/** Parse a `hostname -I`-style flat IP list (used by simple templates). */
export function parseIpLines(output: string): string[] {
  return String(output || "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value))
}

/** Parse a single-value expectation, e.g. `hostname`. */
export function parseSingleLine(output: string): string {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? ""
}

export function parseNativeOsInfo(payload: unknown): { osId: string | null; name: string | null; version: string | null; kernel: string | null } {
  const record = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>
  const id = record.id ? String(record.id) : null
  return {
    osId: id,
    name: record.name ? String(record.name) : null,
    version: record["version-id"] ? String(record["version-id"]) : (record.version ? String(record.version) : null),
    kernel: record["kernel-release"] ? String(record["kernel-release"]) : null,
  }
}

export function parseNativeUsers(payload: unknown): Array<{ name: string; uid?: number | null; shell?: string | null; home?: string | null }> {
  const raw = Array.isArray(payload) ? payload : []
  const users: Array<{ name: string; uid?: number | null; shell?: string | null; home?: string | null }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, any>
    const name = String(record.name ?? record.user ?? "").trim()
    if (!name) continue
    users.push({
      name,
      uid: Number.isFinite(Number(record.uid)) ? Number(record.uid) : null,
      shell: record.shell ? String(record.shell) : null,
      home: record.home ? String(record.home) : null,
    })
  }
  return users
}

export function parseNativeFsInfo(payload: unknown): Array<{ name: string; mountpoint: string | null; totalBytes: number; usedBytes: number; freeBytes: number; type: string | null }> {
  const raw = Array.isArray(payload) ? payload : []
  const out: Array<{ name: string; mountpoint: string | null; totalBytes: number; usedBytes: number; freeBytes: number; type: string | null }> = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, any>
    const list = Array.isArray(record.disks) ? record.disks : []
    for (const disk of list) {
      if (!disk || typeof disk !== "object") continue
      const total = bytes(disk["total-bytes"])
      const used = bytes(disk["used-bytes"])
      const remaining = Number.isFinite(Number(disk["remaining-bytes"])) ? bytes(disk["remaining-bytes"]) : 0
      if (!(total > 0)) continue
      out.push({
        name: String(disk.name ?? disk["alias"] ?? ""),
        mountpoint: record.mountpoint ? String(record.mountpoint) : null,
        totalBytes: total,
        usedBytes: used,
        freeBytes: remaining || Math.max(0, total - used),
        type: Array.isArray(disk["fs-type"]) ? (disk["fs-type"] as string[]).join(",") : (disk["fs-type"] ? String(disk["fs-type"]) : null),
      })
    }
  }
  return out
}
