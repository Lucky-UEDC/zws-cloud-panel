/**
 * OS detection for the guest engine.
 *
 * Two sources, in strict priority order:
 *  1. `qm guest cmd <vmid> get-osinfo` — authoritative for the LIVE guest.
 *  2. Authoritative VM/service metadata (OsTemplate + VpsInstance + Order).
 *
 * Hostnames, instance names and other free text are never consulted. When both
 * sources are unavailable the result is `unknown` and the engine runs NO guest
 * command at all — guessing is worse than waiting.
 */

import { prisma } from "@/lib/db"
import { guestOsFromHint, type VmGuestOsKind } from "@/lib/vm-os-detection"
import { guestNative, type GuestTarget, type ProxmoxGuestClient } from "./proxmox-guest"
import type { GuestEngine } from "./constants"

/** Shape of `agent/get-osinfo` (QEMU Guest Agent spec). */
export type GuestOsInfo = {
  id?: string
  "name"?: string
  "version"?: string
  "version-id"?: string
  "kernel-release"?: string
  "kernel-version"?: string
  "machine"?: string
}

export type DetectedOs = {
  /** linux | windows | unknown — drives the whole engine selection. */
  kind: VmGuestOsKind
  engine: GuestEngine | "unknown"
  /** The QGA osinfo `id` (lowercased), e.g. "ubuntu", "rocky", "windows". */
  osId: string | null
  name: string | null
  version: string | null
  kernelVersion: string | null
  /** Which source produced this answer. */
  source: "guest-agent" | "metadata" | "unavailable"
  raw?: GuestOsInfo | null
}

export const UNAVAILABLE_DETECTION: DetectedOs = {
  kind: "unknown",
  engine: "unknown",
  osId: null,
  name: null,
  version: null,
  kernelVersion: null,
  source: "unavailable",
}

const WINDOWS_OS_ID = /^(windows|win32|win64|winnt|msdos|ms-dos)/i
const WINDOWS_NAME = /windows|win\s*server|win\s*xp|win\s*10|win\s*11/i

/**
 * `get-osinfo` has no OS-type field, so the engine is decided by the `id` the
 * agent reports. A recognised id is required: an unrecognised one stays
 * `unknown` and no guest command runs. Defaulting unknown ids to Linux would
 * let `df -B1 -P` be sent to a guest we know nothing about.
 */
const RECOGNISED_LINUX_OS_IDS: ReadonlySet<string> = new Set([
  // Debian family
  "debian", "ubuntu", "linuxmint", "mint", "raspbian", "devuan", "kali", "kali-linux", "pop", "elementary",
  "ubuntu-server", "ubuntucore", "zorin", "neon",
  // RHEL family
  "rhel", "redhat", "redhat-enterprise-server", "centos", "centos-stream", "rocky", "rocky-linux", "almalinux",
  "almalinux-almalinux", "fedora", "ol", "oracle", "oraclelinux", "oracle-linux-server", "scientific", "virtuozzo",
  "eurolinux", "xenserver",
  // SUSE family
  "opensuse", "opensuse-leap", "opensuse-tumbleweed", "suse", "sled", "sles", "sles_sap",
  // Arch / Gentoo / Slackware
  "arch", "archarm", "manjaro", "manjaro-arm", "endeavouros", "gentoo", "funtoo", "slackware", "nixos", "nix",
  // Alpine / BSD / Void
  "alpine", "void", "freebsd", "openbsd", "netbsd", "dragonflybsd", "ghostbsd",
  // Other Linux
  "linux", "generic-linux", "kali-rolling", "deepin", "uos", "antergos", "pureos", "tails",
  // Containers occasionally report the host id
  "flatcar", "coreos", "clear-linux-os", "bottlerocket",
])

/**
 * Map a raw `get-osinfo` payload to a Linux/Windows verdict.
 *
 * An unrecognised payload is `unknown`, not Linux by elimination — Windows and
 * Linux agent payloads are structurally different and guessing produces
 * cross-OS command mistakes.
 */
export function classifyGuestOsInfo(raw: unknown): Pick<DetectedOs, "kind" | "engine" | "osId" | "name" | "version" | "kernelVersion"> {
  const empty = { kind: "unknown" as VmGuestOsKind, engine: "unknown" as const, osId: null, name: null, version: null, kernelVersion: null }
  if (!raw || typeof raw !== "object") return empty
  const info = raw as GuestOsInfo
  const id = String(info.id ?? "").trim()
  const name = String(info.name ?? "").trim()
  if (!id && !name) return empty

  const version = info["version-id"] || info.version || null
  const kernelVersion = info["kernel-release"] || null

  if (WINDOWS_OS_ID.test(id) || WINDOWS_NAME.test(name)) {
    return { kind: "windows", engine: "windows", osId: (id || "windows").toLowerCase(), name: name || "Windows", version, kernelVersion }
  }

  if (!id) return empty
  const osId = id.toLowerCase()
  if (!RECOGNISED_LINUX_OS_IDS.has(osId)) return empty
  return { kind: "linux", engine: "linux", osId, name: name || id, version, kernelVersion }
}

export function normalizeDetected(input: Pick<DetectedOs, "kind" | "engine" | "osId" | "name" | "version" | "kernelVersion">): DetectedOs {
  const kind = input.kind as VmGuestOsKind
  return {
    kind,
    engine: kind === "unknown" ? "unknown" : (kind as GuestEngine),
    osId: input.osId ?? null,
    name: input.name ?? null,
    version: input.version ?? null,
    kernelVersion: input.kernelVersion ?? null,
    source: kind === "unknown" ? "unavailable" : "metadata",
  }
}

/**
 * Detect the live guest OS.
 *
 * Requires a running VM with a reachable agent: `get-osinfo` is meaningless on
 * a stopped guest, so we short-circuit and report the metadata fallback instead.
 */
export async function detectGuestOs(input: {
  client: ProxmoxGuestClient
  node: string
  vmid: number
  running: boolean
  /** Authoritative metadata fallback, already loaded by the caller. */
  metadata?: VmOsDetectionInputLike | null
  timeoutMs?: number
}): Promise<DetectedOs> {
  const metadataFallback = input.metadata ? detectFromMetadata(input.metadata) : UNAVAILABLE_DETECTION

  if (!input.running) {
    // A stopped guest has no agent. Metadata is the only honest answer, and it
    // is explicitly NOT enough to run a guest command.
    return { ...metadataFallback, source: metadataFallback.kind === "unknown" ? "unavailable" : "metadata" }
  }

  const result = await guestNative<GuestOsInfo>(
    { client: input.client, node: input.node, vmid: input.vmid, engine: "unknown" },
    "get-osinfo",
    { timeoutMs: input.timeoutMs ?? 8_000 },
  )
  if (!result.ok) return { ...metadataFallback, source: metadataFallback.kind === "unknown" ? "unavailable" : "metadata" }

  const classified = classifyGuestOsInfo(result.data)
  if (classified.kind === "unknown") {
    return { ...metadataFallback, source: metadataFallback.kind === "unknown" ? "unavailable" : "metadata" }
  }
  return { ...classified, source: "guest-agent" }
}

type VmOsDetectionInputLike = {
  osType?: string | null
  osFamily?: string | null
  category?: string | null
  osName?: string | null
  vmOsFamily?: string | null
  orderOsName?: string | null
}

/** Metadata-only detection. Reuses the single authoritative resolver. */
export function detectFromMetadata(metadata: VmOsDetectionInputLike | null | undefined): DetectedOs {
  if (!metadata) return UNAVAILABLE_DETECTION
  const kind = guestOsFromHint(
    [metadata.osFamily, metadata.osType, metadata.vmOsFamily, metadata.orderOsName, metadata.osName, metadata.category]
      .filter(Boolean)
      .join(" "),
  )
  if (kind === "unknown") return UNAVAILABLE_DETECTION
  return {
    kind,
    engine: kind,
    osId: String(metadata.osFamily || metadata.osType || "").trim().toLowerCase() || null,
    name: metadata.osName || metadata.orderOsName || null,
    version: null,
    kernelVersion: null,
    source: "metadata",
  }
}

/**
 * Guest-agent health probe with a short cache. `agent/ping` is cheap but not
 * free, and the provisioning pipeline plus the telemetry worker both need it.
 */
const pingCache = new Map<string, { at: number; reachable: boolean }>()
const PING_TTL_MS = 15_000

export async function isGuestAgentReachable(input: {
  target: GuestTarget
  timeoutMs?: number
  bypassCache?: boolean
}): Promise<{ reachable: boolean; cached: boolean; checkedAt: number }> {
  const key = `${input.target.node}:${input.target.vmid}`
  if (!input.bypassCache) {
    const hit = pingCache.get(key)
    if (hit && Date.now() - hit.at < PING_TTL_MS) {
      return { reachable: hit.reachable, cached: true, checkedAt: hit.at }
    }
  }
  const { pingVMGuestAgent: runPing } = await import("./proxmox-guest")
  const result = await runPing(input.target, input.timeoutMs)
  const at = Date.now()
  pingCache.set(key, { at, reachable: result.ok })
  return { reachable: result.ok, cached: false, checkedAt: at }
}

export function clearGuestAgentPingCache(vmid?: number) {
  if (vmid === undefined) {
    pingCache.clear()
    return
  }
  for (const key of [...pingCache.keys()]) {
    if (key.endsWith(`:${vmid}`)) pingCache.delete(key)
  }
}

/**
 * Persist detection onto the adoption row so admin pages and later operations
 * share one cached view instead of re-probing Proxmox on every request.
 */
export async function persistDetection(input: {
  vpsInstanceId: string
  osTemplateId?: string | null
  detected: DetectedOs
  guestAgentReachable?: boolean
  automationReady?: boolean
  unsupportedReason?: string | null
  state?: Record<string, unknown>
}) {
  const now = new Date()
  const data = {
    engine: input.detected.engine,
    detectedOsId: input.detected.osId,
    detectedName: input.detected.name,
    detectedVersion: input.detected.version,
    detectedKernelVersion: input.detected.kernelVersion,
    guestAgentReachable: input.guestAgentReachable ?? false,
    guestAgentCheckedAt: input.guestAgentReachable ? now : null,
    lastDetectedAt: now,
    ...(input.automationReady !== undefined ? { automationReady: input.automationReady } : {}),
    ...(input.unsupportedReason !== undefined ? { unsupportedReason: input.unsupportedReason } : {}),
    ...(input.state ? { state: input.state as any } : {}),
  }
  return prisma.vmGuestAdoption.upsert({
    where: { vpsInstanceId: input.vpsInstanceId },
    create: { vpsInstanceId: input.vpsInstanceId, osTemplateId: input.osTemplateId ?? null, ...data },
    update: { ...(input.osTemplateId !== undefined ? { osTemplateId: input.osTemplateId } : {}), ...data },
  })
}

/** Read the cached adoption row, if any. */
export async function readAdoption(vpsInstanceId: string) {
  return prisma.vmGuestAdoption.findUnique({ where: { vpsInstanceId } })
}

/** Cached detection good enough to pick a template without a round trip. */
export function cachedDetection(adoption: { engine: string; detectedOsId: string | null; detectedName: string | null; detectedVersion: string | null } | null): DetectedOs | null {
  if (!adoption) return null
  if (adoption.engine !== "linux" && adoption.engine !== "windows") return null
  if (!adoption.detectedOsId && !adoption.detectedName) return null
  return {
    kind: adoption.engine,
    engine: adoption.engine,
    osId: adoption.detectedOsId,
    name: adoption.detectedName,
    version: adoption.detectedVersion,
    kernelVersion: null,
    source: "metadata",
  }
}
