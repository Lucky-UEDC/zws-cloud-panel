import assert from "node:assert/strict"
import test from "node:test"
import {
  collectGuestDiskUsage,
  parseLinuxDfBytes,
  parseWindowsVolumes,
  waitForGuestExecOutcome,
} from "@/lib/vm-guest-disk"

const LINUX_OUTPUT = [
  "Filesystem 1B-blocks Used Available Use% Mounted on",
  "/dev/vda1 200000000000 90000000000 110000000000 45% /",
  "tmpfs 1000000000 100000 999900000 1% /run",
  "overlay 5000000000 2000000000 3000000000 40% /overlay-mnt",
  "efivarfs 100000 50000 50000 50% /sys/efi/vars",
  "/dev/vdb1 1000000000000 100000000000 900000000000 10% /data",
].join("\n")

test("linux df parser filters pseudo filesystems and selects the root filesystem", () => {
  const usage = parseLinuxDfBytes(LINUX_OUTPUT)
  assert.equal(usage.ok, true)
  assert.equal(usage.selectedVolume?.mountpoint, "/")
  assert.equal(usage.selectedVolume?.name, "/dev/vda1")
  assert.equal(usage.totalBytes, 200_000_000_000)
  assert.equal(usage.usedBytes, 90_000_000_000)
  assert.equal(usage.freeBytes, 110_000_000_000)
  // tmpfs /run, overlay, efivarfs all filtered → only vda1 + vdb1 survive.
  assert.equal(usage.volumes.length, 2)
})

test("linux parser skips header variants and unescapes space-escaped mounts", () => {
  const usage = parseLinuxDfBytes([
    "Filesystem 1024-blocks Used Available Capacity Mounted on",
    "/dev/mapper/root 104857600 52428800 52428800 50% /",
  ].join("\n"))
  assert.equal(usage.ok, true)
  assert.equal(usage.selectedVolume?.mountpoint, "/")
  assert.equal(usage.totalBytes, 104_857_600)

  const escaped = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 1000000000 100000000 900000000 10% /mnt/with\\040space\n")
  assert.equal(escaped.ok, true)
  assert.equal(escaped.selectedVolume?.mountpoint, "/mnt/with space")
})

test("linux selector prefers root, then backing device, then largest filesystem", () => {
  const backingOnly = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/vda2 80000000000 10000000000 70000000000 13% /home\n/dev/vdb1 50000000000 10000000000 40000000000 20% /opt\n")
  assert.equal(backingOnly.ok, true)
  assert.equal(backingOnly.selectedVolume?.mountpoint, "/home")
  assert.equal(backingOnly.totalBytes, 80_000_000_000)

  const largestOnly = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\ndata-pool/a 50000000000 10000000000 40000000000 20% /app1\ndata-pool/b 100000000000 20000000000 80000000000 20% /app2\n")
  assert.equal(largestOnly.ok, true)
  assert.equal(largestOnly.selectedVolume?.mountpoint, "/app2")
  assert.equal(largestOnly.totalBytes, 100_000_000_000)
})

test("linux parser rejects invalid data and empty output", () => {
  const invalid = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 100 200 -100 200% /\n")
  assert.equal(invalid.ok, false)
  assert.equal(invalid.errorCode, "DISK_DATA_INVALID")
  assert.equal(invalid.volumes.length, 1)
  assert.equal(invalid.volumes[0]?.errorCode, "DISK_DATA_INVALID")

  const pctOutOfRange = parseLinuxDfBytes("Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 100 80 20 150% /\n")
  assert.equal(pctOutOfRange.ok, false)
  assert.equal(pctOutOfRange.errorCode, "DISK_DATA_INVALID")

  const empty = parseLinuxDfBytes("")
  assert.equal(empty.ok, false)
  assert.equal(empty.errorCode, "PARSE_FAILED")
})

test("windows parser prefers the system drive and ignores CD/removable volumes", () => {
  const usage = parseWindowsVolumes(JSON.stringify([
    { DriveLetter: "D", DriveType: 3, Size: 500000000000, FreeSpace: 400000000000, FileSystem: "NTFS" },
    { DriveLetter: "C", DriveType: 3, Size: 200000000000, FreeSpace: 156000000000, FileSystem: "NTFS" },
    { DriveLetter: "E", DriveType: 5, Size: 1000000000, FreeSpace: 0, FileSystem: "UDF" },
    { DriveLetter: "F", DriveType: 2, Size: 4000000000, FreeSpace: 4000000000, FileSystem: "FAT32" },
  ]))
  assert.equal(usage.ok, true)
  assert.equal(usage.selectedVolume?.name, "C:")
  assert.equal(usage.totalBytes, 200_000_000_000)
  assert.equal(usage.usedBytes, 44_000_000_000)
  assert.equal(usage.volumes.length, 2)
})

test("cross-OS parsers refuse the other operating system's payload", () => {
  const windowsPayload = "DeviceID=C:\r\nFreeSpace=10000000000\r\nSize=50000000000\r\n\r\n"
  const crossLinux = parseLinuxDfBytes(windowsPayload)
  assert.equal(crossLinux.ok, false)
  assert.equal(crossLinux.errorCode, "PARSE_FAILED")

  const linuxPayload = "Filesystem 1B-blocks Used Available Use% Mounted on\n/dev/sda1 200000000000 44000000000 156000000000 22% /\n"
  const crossWindows = parseWindowsVolumes(linuxPayload)
  assert.equal(crossWindows.ok, false)
  assert.equal(crossWindows.errorCode, "PARSE_FAILED")
})

function loggedClient(options: {
  execError?: Error
  hintFor?: (command: string[]) => "running" | "done" | "never"
}) {
  const state = { execCalls: 0, statusCalls: 0, commands: [] as string[][] }
  const client: any = {
    state,
    async execVMGuestCommand(_node: string, _vmid: number, command: string[]) {
      state.execCalls += 1
      state.commands.push(command)
      if (options.execError) throw options.execError
      return { pid: 7 }
    },
    async getVMGuestExecStatus() {
      state.statusCalls += 1
      const command = state.commands[state.commands.length - 1] || []
      const hint = options.hintFor?.(command) || "done"
      if (hint === "running") return { result: { pid: 7 } }
      if (hint === "never") throw new Error("status unavailable")
      const isWmic = command[0]?.toLowerCase() === "wmic"
      if (isWmic) {
        return { result: { exited: 1, exitcode: 0, "out-data": "DeviceID=C:\r\nFreeSpace=32100000000\r\nSize=49900000000\r\n\r\n" } }
      }
      const isPowerShell = command[0]?.toLowerCase() === "powershell"
      if (isPowerShell) {
        return { result: { exited: 1, exitcode: 0, "out-data": "" } }
      }
      return { result: { exited: 1, exitcode: 0, "out-data": "/dev/vda1 200000000000 90000000000 110000000000 45% /\n" } }
    },
  }
  return client
}

test("collectGuestDiskUsage with unknown OS runs no guest command and reports OS_UNKNOWN", async () => {
  const client = loggedClient({})
  const usage = await collectGuestDiskUsage({ client, nodeName: "pve1", vmid: 1, os: "unknown" })
  assert.equal(usage.ok, false)
  assert.equal(usage.errorCode, "OS_UNKNOWN")
  assert.equal(usage.os, "unknown")
  assert.equal(client.state.execCalls, 0)
  assert.ok(usage.collectionDurationMs !== null)
  assert.ok(usage.checkedAt !== null)
})

test("collectGuestDiskUsage Linux runs df -B1 -P and returns selected totals", async () => {
  const client = loggedClient({})
  const usage = await collectGuestDiskUsage({ client, nodeName: "pve1", vmid: 2, os: "linux" })
  assert.equal(usage.ok, true)
  assert.equal(usage.source, "guest-agent-linux")
  assert.equal(usage.os, "linux")
  assert.equal(usage.totalBytes, 200_000_000_000)
  assert.equal(usage.usedBytes, 90_000_000_000)
  assert.deepEqual(client.state.commands[0], ["df", "-B1", "-P"])
})

test("collectGuestDiskUsage maps an unreachable agent to GUEST_AGENT_DISABLED", async () => {
  const client = loggedClient({ execError: new Error("500 Can't connect to QEMU guest agent (channel is closed)") })
  const usage = await collectGuestDiskUsage({ client, nodeName: "pve1", vmid: 3, os: "linux" })
  assert.equal(usage.ok, false)
  assert.equal(usage.errorCode, "GUEST_AGENT_DISABLED")
})

test("collectGuestDiskUsage falls from PowerShell to wmic for Windows guests", async () => {
  const client = loggedClient({})
  const usage = await collectGuestDiskUsage({ client, nodeName: "pve1", vmid: 4, os: "windows" })
  assert.equal(usage.ok, true)
  assert.equal(usage.source, "guest-agent-windows")
  assert.equal(usage.os, "windows")
  assert.equal(usage.totalBytes, 49_900_000_000)
  assert.equal(usage.usedBytes, 17_800_000_000)
  // First attempt must be PowerShell (Get-CimInstance), the fallback wmic.
  assert.equal(client.state.commands[0]?.[0]?.toLowerCase(), "powershell")
  assert.equal(client.state.commands.at(-1)?.[0]?.toLowerCase(), "wmic")
})

test("waitForGuestExecOutcome distinguishes timeout from parse failure", async () => {
  const stalling: any = {
    async execVMGuestCommand() { return { pid: 9 } },
    async getVMGuestExecStatus() { return { result: { pid: 9 } } }, // never exits
  }
  const timeoutOutcome = await waitForGuestExecOutcome(stalling, "pve1", 5, 9, 120, 20)
  assert.equal(timeoutOutcome.ok, false)
  assert.equal(timeoutOutcome.timedOut, true)
  assert.equal(timeoutOutcome.errorCode, "GUEST_AGENT_TIMEOUT")

  const failing: any = {
    async execVMGuestCommand() { return { pid: 10 } },
    async getVMGuestExecStatus() { return { result: { exited: 1, exitcode: 127, "err-data": "df: not found", "out-data": "" } } },
  }
  const failedOutcome = await waitForGuestExecOutcome(failing, "pve1", 6, 10, 500)
  assert.equal(failedOutcome.ok, false)
  assert.equal(failedOutcome.timedOut, false)
  assert.equal(failedOutcome.exitCode, 127)
  assert.equal(failedOutcome.errorCode, "GUEST_EXEC_FAILED")
  assert.match(failedOutcome.error || "", /df: not found/)

  const good: any = {
    async execVMGuestCommand() { return { pid: 11 } },
    async getVMGuestExecStatus() { return { result: { exited: 1, exitcode: 0, "out-data": "/dev/vda1 100 50 50 50% /\n" } } },
  }
  const goodOutcome = await waitForGuestExecOutcome(good, "pve1", 7, 11, 500)
  assert.equal(goodOutcome.ok, true)
  assert.match(goodOutcome.output, /dev\/vda1/)
})

test("collectGuestDiskUsage surfaces a guest-agent timeout end to end", async () => {
  const client = loggedClient({ hintFor: () => "running" })
  const usage = await collectGuestDiskUsage({ client, nodeName: "pve1", vmid: 8, os: "linux", timeoutMs: 60 })
  assert.equal(usage.ok, false)
  assert.equal(usage.errorCode, "GUEST_AGENT_TIMEOUT")
  assert.equal(client.state.execCalls, 1)
  assert.ok(client.state.statusCalls >= 1)
})