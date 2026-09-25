export type GuestDiskVolume = {
  name: string
  mountpoint?: string | null
  filesystem?: string | null
  totalBytes: number
  usedBytes: number
  freeBytes: number
  system?: boolean
}

export type GuestDiskUsage = {
  ok: boolean
  source: "guest-agent-linux" | "guest-agent-windows" | "unavailable"
  totalBytes: number
  usedBytes: number
  freeBytes: number
  volumes: GuestDiskVolume[]
  error?: string | null
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function empty(source: GuestDiskUsage["source"], error?: string | null): GuestDiskUsage {
  return { ok: false, source, totalBytes: 0, usedBytes: 0, freeBytes: 0, volumes: [], error: error || null }
}

export function parseLinuxDfBytes(output: string): GuestDiskUsage {
  const lines = String(output || "").trim().split(/\r?\n/).filter(Boolean)
  const data = lines.find((line) => /^\S+\s+\d+\s+\d+\s+\d+/.test(line))
  if (!data) return empty("guest-agent-linux", "df_output_unparseable")
  const parts = data.trim().split(/\s+/)
  const totalBytes = numberValue(parts[1])
  const usedBytes = numberValue(parts[2])
  const freeBytes = numberValue(parts[3])
  if (totalBytes <= 0) return empty("guest-agent-linux", "df_total_missing")
  return {
    ok: true,
    source: "guest-agent-linux",
    totalBytes,
    usedBytes,
    freeBytes: freeBytes || Math.max(0, totalBytes - usedBytes),
    volumes: [{
      name: parts[0] || "/",
      mountpoint: parts[5] || "/",
      totalBytes,
      usedBytes,
      freeBytes: freeBytes || Math.max(0, totalBytes - usedBytes),
      system: true,
    }],
  }
}

function powershellRows(output: string) {
  const text = String(output || "").trim()
  if (!text) return []
  if (/^\s*DeviceID\s*=/im.test(text)) return wmicRows(text)
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
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

function wmicRows(output: string) {
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

export function parseWindowsVolumes(output: string): GuestDiskUsage {
  const volumes = powershellRows(output)
    .map((row: any): GuestDiskVolume | null => {
      const letter = String(row.DriveLetter || row.driveLetter || row.drive || row.DeviceID || row.deviceId || "").replace(/:$/, "").trim().toUpperCase()
      const totalBytes = numberValue(row.Size ?? row.size)
      const freeBytes = numberValue(row.SizeRemaining ?? row.sizeRemaining ?? row.FreeSpace ?? row.freeSpace ?? row.Free ?? row.free)
      if (!letter || totalBytes <= 0) return null
      return {
        name: `${letter}:`,
        totalBytes,
        usedBytes: Math.max(0, totalBytes - freeBytes),
        freeBytes: Math.max(0, freeBytes),
        filesystem: row.FileSystem || row.fileSystem || null,
        system: letter === "C",
      }
    })
    .filter(Boolean) as GuestDiskVolume[]

  if (!volumes.length) return empty("guest-agent-windows", "windows_volume_output_unparseable")
  volumes.sort((a, b) => Number(b.system) - Number(a.system) || b.totalBytes - a.totalBytes)
  const totalBytes = volumes.reduce((sum, volume) => sum + volume.totalBytes, 0)
  const usedBytes = volumes.reduce((sum, volume) => sum + volume.usedBytes, 0)
  const freeBytes = volumes.reduce((sum, volume) => sum + volume.freeBytes, 0)
  return { ok: true, source: "guest-agent-windows", totalBytes, usedBytes, freeBytes, volumes }
}

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

export async function collectGuestDiskUsage(input: {
  client: any
  nodeName: string
  vmid: number
  osHint?: string | null
}) {
  const osHint = String(input.osHint || "").toLowerCase()
  const windows = osHint.includes("windows") || /\bwin(?:dows)?\b/.test(osHint)
  try {
    const command = windows
      ? [
          "wmic",
          "logicaldisk",
          "get",
          "DeviceID,Size,FreeSpace",
          "/format:list",
        ]
      : ["df", "-B1", "/"]
    const exec = await input.client.execVMGuestCommand(input.nodeName, input.vmid, command)
    const status = await waitForGuestExec(input.client, input.nodeName, input.vmid, Number((exec as any).pid || (exec as any).result?.pid || 0))
    const output = outputFromExecStatus(status)
    return windows ? parseWindowsVolumes(output) : parseLinuxDfBytes(output)
  } catch (error: any) {
    return empty(windows ? "guest-agent-windows" : "guest-agent-linux", error?.message || String(error))
  }
}

async function runGuestCommand(input: { client: any; nodeName: string; vmid: number; command: string[]; timeoutMs?: number }) {
  const exec = await input.client.execVMGuestCommand(input.nodeName, input.vmid, input.command)
  return waitForGuestExec(input.client, input.nodeName, input.vmid, Number((exec as any).pid || (exec as any).result?.pid || 0), input.timeoutMs || 60_000)
}

export async function expandGuestPrimaryDisk(input: {
  client: any
  nodeName: string
  vmid: number
  osHint?: string | null
  previousTotalBytes?: number | null
}) {
  const osHint = String(input.osHint || "").toLowerCase()
  const windows = osHint.includes("windows") || /\bwin(?:dows)?\b/.test(osHint)
  const before = input.previousTotalBytes && input.previousTotalBytes > 0
    ? input.previousTotalBytes
    : (await collectGuestDiskUsage(input).catch(() => null))?.totalBytes || 0

  if (windows) {
    await runGuestCommand({
      ...input,
      command: [
        "powershell",
        "-NoProfile",
        "-Command",
        "$p=Get-Partition | Where-Object DriveLetter | Sort-Object Size -Descending | Select-Object -First 1; if($p){$s=Get-PartitionSupportedSize -DiskNumber $p.DiskNumber -PartitionNumber $p.PartitionNumber; Resize-Partition -DiskNumber $p.DiskNumber -PartitionNumber $p.PartitionNumber -Size $s.SizeMax}",
      ],
      timeoutMs: 120_000,
    })
  } else {
    await runGuestCommand({
      ...input,
      command: [
        "sh",
        "-lc",
        "set -e; root=$(findmnt -no SOURCE /); part=${root##*/}; disk=/dev/$(echo \"$part\" | sed -E 's/p?[0-9]+$//'); num=$(echo \"$part\" | grep -oE '[0-9]+$'); command -v growpart >/dev/null 2>&1 && growpart \"$disk\" \"$num\" || true; fs=$(findmnt -no FSTYPE /); if [ \"$fs\" = xfs ]; then xfs_growfs /; else resize2fs \"$root\"; fi",
      ],
      timeoutMs: 120_000,
    })
  }

  const after = await collectGuestDiskUsage(input)
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
