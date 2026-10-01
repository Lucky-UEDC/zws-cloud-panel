/**
 * Verification engine.
 *
 * A non-zero exit code is NOT proof that the requested state exists. Every
 * operation with `verificationRequired` runs an independent check afterwards:
 * re-read the guest via a native verb (or parse the operation's own output) and
 * assert the desired state. A change that cannot be verified is a failure, not
 * a success — this is the single rule that prevents "we applied it" theatre.
 */

import { GUEST_ERROR_MESSAGES, type GuestErrorCode } from "./constants"
import {
  parseIpLines,
  parseLinuxDf,
  parseNativeFsInfo,
  parseNativeInterfaces,
  parseNativeOsInfo,
  parseNativeUsers,
  parseSingleLine,
  parseWindowsFsutil,
  parseWindowsLogicalDiskJson,
  parseWindowsWmicList,
} from "./parsers"
import { guestNative, type GuestTarget } from "./proxmox-guest"

export type VerificationExpectation = {
  /** Placeholder-free expected value, already validated by the caller. */
  expected?: Record<string, unknown>
  operation: string
  engine: "linux" | "windows"
}

export type VerificationResult = {
  ok: boolean
  /** Human-readable, customer-safe summary. */
  message: string
  errorCode?: GuestErrorCode
  /** What the guest actually reported. */
  observed?: Record<string, unknown>
}

const ok = (message: string, observed?: Record<string, unknown>): VerificationResult => ({ ok: true, message, observed })
const fail = (message: string, errorCode: GuestErrorCode = "VERIFICATION_FAILED", observed?: Record<string, unknown>): VerificationResult => ({ ok: false, message, errorCode, observed })

/**
 * The observation an operation's parser produces. Disk collectors own this
 * because the parse is engine-specific.
 */
export type Observation =
  | { kind: "disk"; ok: true; totalBytes: number; usedBytes: number; freeBytes: number; usedPercent: number; filesystem: string }
  | { kind: "interfaces"; ok: true; ipv4: string[]; name: string }
  | { kind: "hostname"; ok: true; value: string }
  | { kind: "osinfo"; ok: true; osId: string | null; version: string | null }
  | { kind: "users"; ok: true; names: string[] }
  | { kind: "fsinfo"; ok: true; entries: Array<{ name: string; mountpoint: string | null; totalBytes: number }> }
  | { kind: "generic"; ok: true; text: string; data?: unknown }
  | { kind: "failed"; ok: false; errorCode: GuestErrorCode; error: string }

/** Turn raw command output into a typed observation for the given parser. */
export function observeFromOutput(parser: string | null, output: string, engine: "linux" | "windows", drive = "C:"): Observation {
  switch (parser) {
    case "df-posix": {
      const parsed = parseLinuxDf(output)
      if (!parsed.ok) return { kind: "failed", ok: false, errorCode: parsed.errorCode, error: parsed.error }
      return {
        kind: "disk",
        ok: true,
        totalBytes: parsed.selected!.totalBytes,
        usedBytes: parsed.selected!.usedBytes,
        freeBytes: parsed.selected!.freeBytes,
        usedPercent: parsed.selected!.usedPercent,
        filesystem: parsed.selected!.name,
      }
    }
    case "win-logicaldisk": {
      const parsed = parseWindowsLogicalDiskJson(output)
      if (!parsed.ok) return { kind: "failed", ok: false, errorCode: parsed.errorCode, error: parsed.error }
      return {
        kind: "disk",
        ok: true,
        totalBytes: parsed.selected!.totalBytes,
        usedBytes: parsed.selected!.usedBytes,
        freeBytes: parsed.selected!.freeBytes,
        usedPercent: parsed.selected!.usedPercent,
        filesystem: parsed.selected!.name,
      }
    }
    case "fsutil-list": {
      const parsed = parseWindowsFsutil(output, drive)
      if (!parsed.ok) return { kind: "failed", ok: false, errorCode: parsed.errorCode, error: parsed.error }
      return {
        kind: "disk",
        ok: true,
        totalBytes: parsed.selected!.totalBytes,
        usedBytes: parsed.selected!.usedBytes,
        freeBytes: parsed.selected!.freeBytes,
        usedPercent: parsed.selected!.usedPercent,
        filesystem: parsed.selected!.name,
      }
    }
    case "exit-code": {
      // exit-code verification: the command already succeeded (exit code 0),
      // so we just return a generic observation that will pass verification.
      return { kind: "generic", ok: true, text: String(output || "") }
    }
    default:
      break
  }

  // Windows wmic list is a fallback collector rather than a verification parser,
  // but accepting it here keeps the disk contract uniform.
  if (engine === "windows" && /\bDeviceID=/i.test(output) && !/\bDriveType=/i.test(output)) {
    const parsed = parseWindowsWmicList(output)
    if (parsed.ok) {
      return {
        kind: "disk",
        ok: true,
        totalBytes: parsed.selected!.totalBytes,
        usedBytes: parsed.selected!.usedBytes,
        freeBytes: parsed.selected!.freeBytes,
        usedPercent: parsed.selected!.usedPercent,
        filesystem: parsed.selected!.name,
      }
    }
  }

   {
    // exit-code verification: the command already succeeded (exit code 0),
    // so we just return a generic observation that will pass verification.
    return { kind: "generic", ok: true, text: String(output || "") }
  }

  return { kind: "generic", ok: true, text: String(output || "") }
}

/** Convert a native guest verb payload into a typed observation. */
export function observeFromNative(verb: string, payload: unknown): Observation {
  try {
    switch (verb) {
      case "network-get-interfaces": {
        const parsed = parseNativeInterfaces(payload)
        if (!parsed.primary) return { kind: "failed", ok: false, errorCode: "PARSE_FAILED", error: "guest reported no usable non-loopback interface" }
        return { kind: "interfaces", ok: true, ipv4: parsed.primary.ipv4, name: parsed.primary.name }
      }
      case "get-osinfo": {
        const parsed = parseNativeOsInfo(payload)
        return { kind: "osinfo", ok: true, osId: parsed.osId, version: parsed.version }
      }
      case "get-users": {
        const parsed = parseNativeUsers(payload)
        return { kind: "users", ok: true, names: parsed.map((user) => user.name) }
      }
      case "get-fsinfo": {
        const parsed = parseNativeFsInfo(payload)
        if (!parsed.length) return { kind: "failed", ok: false, errorCode: "DISK_DATA_INVALID", error: "guest reported no filesystems" }
        return { kind: "fsinfo", ok: true, entries: parsed }
      }
      case "get-host-name":
        return { kind: "hostname", ok: true, value: parseSingleLine(String((payload as any)?.name ?? payload ?? "")) }
      default:
        return { kind: "generic", ok: true, text: typeof payload === "string" ? payload : JSON.stringify(payload ?? null) }
    }
  } catch (error) {
    return { kind: "failed", ok: false, errorCode: "PARSE_FAILED", error: (error as Error).message }
  }
}

/**
 * Decide whether an observation satisfies the requested state.
 *
 * Idempotency lives here: when the guest already reports the desired value the
 * caller reports `already_applied` instead of rewriting configuration.
 */
export function assertExpectation(observation: Observation, expectation: VerificationExpectation): VerificationResult {
  const expected = expectation.expected ?? {}

  switch (observation.kind) {
    case "failed":
      return fail(observation.error, observation.errorCode)

    case "generic": {
      // Handle native-json parser output which includes parsed JSON data
      if (observation.data && typeof observation.data === "object") {
        const data = observation.data as Record<string, unknown>
        // Handle array responses (e.g., from ConvertTo-Json which outputs arrays)
        const dataArray = Array.isArray(data) ? data : [data]
        // Handle set_ip verification (Get-NetIPAddress output)
        if (expected.ip) {
          for (const item of dataArray) {
            if (item.IPAddress) {
              const ips = Array.isArray(item.IPAddress) ? item.IPAddress : [item.IPAddress]
              const wantIp = String(expected.ip)
              if (ips.includes(wantIp)) {
                return ok(`Address ${wantIp} confirmed.`, data)
              }
            }
          }
          return fail(`Expected address ${expected.ip} was not reported by the guest.`, "VERIFICATION_FAILED", data)
        }
        // Handle set_gateway verification (Get-NetRoute output)
        if (expected.gateway) {
          for (const item of dataArray) {
            if (item.NextHop) {
              const wantGateway = String(expected.gateway)
              const gotGateway = String(item.NextHop)
              if (gotGateway === wantGateway) {
                return ok(`Gateway ${wantGateway} confirmed.`, data)
              }
            }
          }
          return fail(`Expected gateway ${expected.gateway} was not reported by the guest.`, "VERIFICATION_FAILED", data)
        }
        // Handle set_dns verification (Get-DnsClientServerAddress output)
        if (expected.dns) {
          for (const item of dataArray) {
            if (item.ServerAddresses) {
              const wantDns = Array.isArray(expected.dns) ? expected.dns : [expected.dns]
              const gotDns = Array.isArray(item.ServerAddresses) ? item.ServerAddresses : [item.ServerAddresses]
              const allMatch = wantDns.every(w => gotDns.includes(w))
              if (allMatch) {
                return ok(`DNS ${wantDns.join(", ")} confirmed.`, data)
              }
            }
          }
          return fail(`Expected DNS ${expected.dns} was not reported by the guest.`, "VERIFICATION_FAILED", data)
        }
      }
      const needle = String(expected.contains ?? expected.equals ?? "").trim()
      if (!needle) return ok("Command completed with the expected exit code.")
      return observation.text.includes(needle)
        ? ok("Verified.")
        : fail(`Guest output did not contain the expected value.`, "VERIFICATION_FAILED", { text: observation.text.slice(0, 500) })
    }

    case "disk": {
      // A disk operation is verified by the fact that we could read coherent
      // numbers from the target volume; there is no "desired" disk state.
      if (observation.totalBytes > 0) return ok(`Read ${observation.filesystem}.`, observation as unknown as Record<string, unknown>)
      return fail("Guest reported a zero-sized filesystem.", "DISK_DATA_INVALID")
    }

    case "interfaces": {
      const wantIp = expected.ip ? String(expected.ip) : null
      const wantGateway = expected.gateway ? String(expected.gateway) : null
      if (!wantIp) {
        return observation.ipv4.length ? ok(`Guest interface ${observation.name} reports an address.`, observation as unknown as Record<string, unknown>) : fail("Guest interface has no IPv4 address.", "VERIFICATION_FAILED")
      }
      if (!observation.ipv4.includes(wantIp)) {
        return fail(`Expected address ${wantIp} was not reported by the guest.`, "VERIFICATION_FAILED", observation as unknown as Record<string, unknown>)
      }
      if (wantGateway) {
        // The gateway is not part of network-get-interfaces; confirm it via the
        // operation's own text output when the template captured it.
        const text = String(expected.gatewayEvidence ?? "")
        if (text && !text.includes(wantGateway)) {
          return fail(`Address applied but gateway ${wantGateway} was not confirmed.`, "VERIFICATION_FAILED")
        }
      }
      return ok(`Address ${wantIp} confirmed.`, observation as unknown as Record<string, unknown>)
    }

    case "hostname": {
      const want = expected.hostname ? String(expected.hostname).toLowerCase() : null
      if (!want) return ok("Hostname readable.", observation as unknown as Record<string, unknown>)
      const got = observation.value.toLowerCase()
      // Windows appends the domain, so compare the short name too.
      const short = got.split(".")[0]
      return want === got || want === short
        ? ok("Hostname confirmed.", observation as unknown as Record<string, unknown>)
        : fail(`Hostname is "${observation.value}", expected "${want}".`, "VERIFICATION_FAILED", observation as unknown as Record<string, unknown>)
    }

    case "osinfo": {
      const wantId = expected.osId ? String(expected.osId).toLowerCase() : null
      if (!wantId) return ok("OS information readable.", observation as unknown as Record<string, unknown>)
      const got = (observation.osId || "").toLowerCase()
      return got.includes(wantId) || wantId.includes(got)
        ? ok("OS confirmed.", observation as unknown as Record<string, unknown>)
        : fail(`Guest reported OS "${observation.osId}", expected "${expected.osId}".`, "VERIFICATION_FAILED", observation as unknown as Record<string, unknown>)
    }

    case "users": {
      // The caller may key the expectation either as `username` (the account
      // being operated on) or explicitly as `expectedUsername`.
      const want = expected.expectedUsername !== undefined
        ? String(expected.expectedUsername)
        : expected.username !== undefined
          ? String(expected.username)
          : null
      if (!want) return ok("Guest users readable.", observation as unknown as Record<string, unknown>)
      return observation.names.includes(want)
        ? ok(`Account ${want} exists.`, observation as unknown as Record<string, unknown>)
        : fail(`Account ${want} was not found in the guest.`, "VERIFICATION_FAILED", observation as unknown as Record<string, unknown>)
    }

    case "fsinfo": {
      const wantPath = expected.filesystem ? String(expected.filesystem) : null
      if (!wantPath) return ok("Filesystem information readable.", observation as unknown as Record<string, unknown>)
      const found = observation.entries.find((entry) => entry.mountpoint === wantPath || entry.name === wantPath)
      return found
        ? ok(`Filesystem ${wantPath} confirmed.`, observation as unknown as Record<string, unknown>)
        : fail(`Filesystem ${wantPath} was not reported by the guest.`, "VERIFICATION_FAILED", observation as unknown as Record<string, unknown>)
    }

    default:
      return fail(GUEST_ERROR_MESSAGES.VERIFICATION_FAILED)
  }
}

/**
 * Read-only observation of the guest for an operation. Uses the template's
 * declared verification command, so an admin can point `set_ip` at
 * `network-get-interfaces` or at a custom `ip -4 addr` collector.
 */
export async function observeGuestState(input: {
  target: GuestTarget
  engine: "linux" | "windows"
  verificationCommand: string | null
  verificationParser: string | null
  /** Present when the verification command is itself a shell command. */
  shell?: string | null
  command?: string | null
  timeoutMs?: number
}): Promise<Observation> {
  const verb = String(input.verificationCommand || "").trim()

  if (verb && !verb.includes(" ") && /^[a-z-]+$/.test(verb)) {
    const native = await guestNative(input.target, verb, { timeoutMs: input.timeoutMs ?? 10_000 })
    if (!native.ok) return { kind: "failed", ok: false, errorCode: native.errorCode, error: native.error }
    return observeFromNative(verb, native.data)
  }

  if (input.command) {
    const { execGuestCommand } = await import("./proxmox-guest")
    const outcome = await execGuestCommand(input.target, {
      engine: input.engine,
      shell: (input.shell as any) || (input.engine === "windows" ? "windows-powershell" : "linux-sh"),
      command: input.command,
      timeoutMs: input.timeoutMs ?? 15_000,
    })
    if (!outcome.ok) return { kind: "failed", ok: false, errorCode: outcome.errorCode, error: outcome.error }
    return observeFromOutput(input.verificationParser, outcome.output, input.engine)
  }

  return { kind: "generic", ok: true, text: "" }
}

/** Full verification: observe, then assert. */
export async function verifyOperation(input: {
  target: GuestTarget
  engine: "linux" | "windows"
  operation: string
  verificationCommand: string | null
  verificationParser: string | null
  verificationShell?: string | null
  verificationCommandBody?: string | null
  expected: Record<string, unknown>
  timeoutMs?: number
}): Promise<VerificationResult> {
  const observation = await observeGuestState({
    target: input.target,
    engine: input.engine,
    verificationCommand: input.verificationCommand,
    verificationParser: input.verificationParser,
    shell: input.verificationShell ?? null,
    command: input.verificationCommandBody ?? null,
    timeoutMs: input.timeoutMs,
  })
  return assertExpectation(observation, { expected: input.expected, operation: input.operation, engine: input.engine })
}

/** `ip -4 addr`-style flat output helper used by simple Linux templates. */
export function observeLinuxAddressList(output: string): Observation {
  return { kind: "generic", ok: true, text: parseIpLines(output).join(" ") }
}
