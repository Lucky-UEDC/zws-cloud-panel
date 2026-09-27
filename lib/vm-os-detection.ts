/**
 * Authoritative guest-OS detection for VM disk telemetry.
 *
 * The guest OS is resolved ONLY from authoritative VM/service metadata
 * (OsTemplate.osType/osFamily/category + VpsInstance.vmOsFamily + order.osName).
 * It is never derived from hostnames, instance names, or any free-text hint.
 *
 * Resolution rules (in priority order):
 *   1. If any authoritative field carries a strong Windows signal → "windows".
 *   2. Else if any authoritative field carries a Linux signal → "linux".
 *   3. Else → "unknown" (callers must NOT run any guest command).
 *
 * `unknown` deliberately returns no command: running `df -B1 -P` on a Windows
 * guest (or PowerShell on a Linux guest) is unsafe, so we refuse to guess.
 */

export type VmGuestOsKind = "linux" | "windows" | "unknown"

export type VmOsDetectionInput = {
  /** OsTemplate.osType, e.g. "linux", "windows-11", "debian-12" */
  osType?: string | null
  /** OsTemplate.osFamily, e.g. "debian", "windows" */
  osFamily?: string | null
  /** OsTemplate.category (defaults to "linux") */
  category?: string | null
  /** OsTemplate.name, e.g. "Ubuntu 22.04 LTS" */
  osName?: string | null
  /** VpsInstance.vmOsFamily captured at provisioning time */
  vmOsFamily?: string | null
  /** Order.osName chosen at checkout, e.g. "Windows Server 2019" */
  orderOsName?: string | null
}

const WINDOWS_WORD = /\b(?:windows|win\s*\d+|winnt|win95|win98|win2000|winxp|win7|win8|win8\.1|win10|win11|microsoft|ms-dos)\b/i

/** Linux/family OS tokens that accept `df -B1 -P` semantics. */
const LINUX_TOKENS = new Set([
  "linux",
  "debian",
  "ubuntu",
  "centos",
  "rhel",
  "rocky",
  "alma",
  "almalinux",
  "fedora",
  "arch",
  "manjaro",
  "alpine",
  "suse",
  "opensuse",
  "kali",
  "mint",
  "linuxmint",
  "gentoo",
  "slackware",
  "freebsd",
  "openbsd",
  "netbsd",
  "coreos",
  "flatcar",
  "amazon",
  "oracle",
  "cloudlinux",
  "pop",
  "elementary",
  "zorin",
  "mx",
  "voyager",
  "endeavouros",
])

function looksWindows(value: string | null | undefined): boolean {
  if (!value) return false
  const text = String(value).trim()
  if (!text) return false
  return WINDOWS_WORD.test(text)
}

function looksLinux(value: string | null | undefined): boolean {
  if (!value) return false
  const text = String(value).trim().toLowerCase()
  if (!text) return false
  if (text.includes("linux") || text.includes("gnu/linux")) return true
  const token = text.split(/[\s\-_.]+/)[0] || ""
  return LINUX_TOKENS.has(token)
}

/**
 * Resolve the guest OS kind from authoritative VM/service metadata.
 *
 * Returns "unknown" when there is no trustworthy signal. Consumers must treat
 * "unknown" as "OS detection unavailable" and must not issue guest commands.
 */
export function resolveVmGuestOs(input: VmOsDetectionInput | null | undefined): VmGuestOsKind {
  const fields = [
    input?.osType,
    input?.osFamily,
    input?.category,
    input?.osName,
    input?.vmOsFamily,
    input?.orderOsName,
  ]
  const anyWindows = fields.some((field) => looksWindows(field))
  if (anyWindows) return "windows"
  const anyLinux = fields.some((field) => looksLinux(field))
  if (anyLinux) return "linux"
  return "unknown"
}

/**
 * Back-compat resolver used by legacy callers that only carry a pre-built
 * osHint string (built from authoritative metadata, never a hostname).
 */
export function guestOsFromHint(hint?: string | null): VmGuestOsKind {
  if (!hint) return "unknown"
  const text = String(hint)
  if (looksWindows(text)) return "windows"
  if (looksLinux(text)) return "linux"
  return "unknown"
}