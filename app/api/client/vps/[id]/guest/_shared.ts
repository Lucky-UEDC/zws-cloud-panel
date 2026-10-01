/**
 * Customer-facing guest automation.
 *
 * The customer submits intent. Nothing else.
 *
 * A request that arrives here can say "my server should have this address" or
 * "reset this account's password" — never "run this command". The command, the
 * shell, the arguments and the OS-specific syntax are all resolved here, from
 * the guest's own reported operating system and the template that matches it.
 * If this file ever read a `command` or `shell` field off a request body it
 * would be an arbitrary-command execution endpoint with a login in front of it,
 * so the accepted payload shapes are enumerated rather than spread.
 *
 * The cost model is the same as anywhere else: the customer only ever pays for
 * the operations that are actually affected, and each one is verified inside the
 * guest before it is reported as done.
 */

import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { GuestAutomationService, osMetadataForVps } from "@/lib/guest-automation/service"
import { guestContextFor } from "@/lib/guest-automation/first-boot"
import { GUEST_ERROR_MESSAGES, type GuestOperationStatus } from "@/lib/guest-automation/constants"
import { publishLiveVmSnapshot } from "@/lib/proxmox-live"
import { createPanelLog } from "@/lib/panel-log"

export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }

export class CustomerRequestError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = "INVALID_REQUEST") {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Reject any request that tries to influence the command rather than the intent.
 *
 * Checked before the body is read, and reported as a plain validation error, so
 * a caller cannot probe for which field names are accepted. The names are the
 * obvious ones; rejecting them is belt and braces, not the primary defence —
 * nothing downstream reads them either.
 */
const FORBIDDEN_FIELDS = ["command", "shell", "arguments", "args", "script", "cmd", "powershell", "bash", "templateId", "engine", "operation", "osTemplateId"] as const

export function assertIntentOnly(body: any) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CustomerRequestError("Invalid request")
  for (const field of FORBIDDEN_FIELDS) {
    if (field in body) {
      throw new CustomerRequestError(
        "This endpoint accepts what you want changed, not how to change it. Remove the command-related field and try again.",
        400,
        "COMMAND_FIELDS_NOT_ACCEPTED",
      )
    }
  }
}

/** Authenticate, own the server, and return a service already bound to it. */
export async function requireOwnedVps(id: string, request?: NextRequest) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) throw new CustomerRequestError("Unauthorized", 401, "UNAUTHORIZED")

  const vps = await prisma.vpsInstance.findFirst({
    where: {
      OR: [{ id }, { orderId: id }],
      customerId,
      deletedAt: null,
      status: { not: "DELETED" },
      order: { deletedAt: null, status: { not: "DELETED" } },
    },
    include: { proxmoxNode: true, operatingSystem: true, ipAllocations: { include: { pool: true }, take: 5 } },
  })
  if (!vps) throw new CustomerRequestError("Instance not found", 404, "NOT_FOUND")
  if (!vps.proxmoxNode || !vps.vmid) {
    throw new CustomerRequestError("This server is not running on infrastructure yet.", 409, "NO_INFRASTRUCTURE")
  }

  const service = new GuestAutomationService(guestContextFor({ vpsInstanceId: vps.id, vmid: vps.vmid, node: vps.proxmoxNode }))
  return {
    vps,
    service,
    customerId,
    actor: {
      requestedBy: customerId,
      role: "customer" as const,
      ipAddress: clientIp(request),
    },
    metadata: osMetadataForVps(vps) as Record<string, unknown>,
  }
}

function clientIp(request?: NextRequest) {
  if (!request) return null
  const forwarded = request.headers.get("x-forwarded-for")
  return forwarded ? String(forwarded).split(",")[0].trim() : request.headers.get("x-real-ip")
}

function text(value: unknown, field: string, options: { min?: number; max?: number } = {}) {
  const next = String(value ?? "").trim()
  if (next.length < (options.min ?? 1)) throw new CustomerRequestError(`${field} is required.`, 400, "FIELD_REQUIRED")
  if (next.length > (options.max ?? 512)) throw new CustomerRequestError(`${field} is too long.`, 400, "FIELD_TOO_LONG")
  return next
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** Addresses that are syntactically valid but can never be a server's address. */
const UNUSABLE_IPV4 = new Set([
  "0.0.0.0",        // "this network" — configuring it would unroute the server
  "255.255.255.255", // limited broadcast
  "127.0.0.1",      // loopback, only ever correct for the host itself
  "169.254.0.1",    // link-local, unused by this platform
])

export function parseIpv4(value: unknown, field: string) {
  const next = text(value, field, { max: 15 })
  if (!IPV4.test(next)) throw new CustomerRequestError(`${field} must be a valid IPv4 address.`, 400, "INVALID_IP")
  if (UNUSABLE_IPV4.has(next)) {
    throw new CustomerRequestError(`${field} cannot be ${next}.`, 400, "INVALID_IP")
  }
  if (next.endsWith(".0") || next.endsWith(".255")) {
    // A host address whose last octet is the network or broadcast address of a
    // /24 is almost always a typo. Refusing beats silently taking the server
    // off the network.
    throw new CustomerRequestError(`${field} looks like a network or broadcast address. Use a host address.`, 400, "INVALID_IP")
  }
  return next
}

export function parsePrefix(value: unknown) {
  // `Number("")` is 0, which is a legal prefix. An absent value is not the same
  // as a deliberate /0, so it is refused rather than defaulted.
  if (value === undefined || value === null || value === "") {
    throw new CustomerRequestError("The subnet prefix is required.", 400, "PREFIX_REQUIRED")
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 32) {
    throw new CustomerRequestError("The subnet prefix must be a whole number between 0 and 32.", 400, "INVALID_PREFIX")
  }
  return parsed
}

export function parseDnsList(value: unknown) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,\s]+/)
  const cleaned = list.map((entry) => String(entry).trim()).filter(Boolean)
  if (!cleaned.length) throw new CustomerRequestError("At least one nameserver is required.", 400, "DNS_REQUIRED")
  if (cleaned.length > 4) throw new CustomerRequestError("At most four nameservers are supported.", 400, "TOO_MANY_DNS")
  return cleaned.map((entry) => parseIpv4(entry, "Each nameserver"))
}

export function parseUsername(value: unknown) {
  const next = text(value, "Username", { max: 64 })
  // Deliberately narrow. A username is interpolated into `useradd`, `usermod` and
  // `New-LocalUser`, so anything that could break out of a quoted argument or
  // name an account that should not exist is refused here rather than escaped
  // and hoped for.
  if (!/^[a-z_][a-z0-9_-]{0,31}\$?$/i.test(next)) {
    throw new CustomerRequestError("The username may contain letters, digits, underscore and hyphen, and must start with a letter or underscore.", 400, "INVALID_USERNAME")
  }
  return next
}

export function parsePassword(value: unknown) {
  const next = String(value ?? "")
  if (next.length < 8) throw new CustomerRequestError("The password must be at least 8 characters.", 400, "PASSWORD_TOO_SHORT")
  if (next.length > 256) throw new CustomerRequestError("The password is too long.", 400, "PASSWORD_TOO_LONG")
  if (/[\r\n\x00]/.test(next)) throw new CustomerRequestError("The password cannot contain line breaks.", 400, "PASSWORD_INVALID")
  return next
}

/** Turn an engine refusal into a sentence a customer can act on. */
export function guestFailureToResponse(errorCode: string | null | undefined, message?: string | null) {
  const text_ = message || (errorCode ? GUEST_ERROR_MESSAGES[errorCode as keyof typeof GUEST_ERROR_MESSAGES] : null) || "This change could not be applied."
  // 409: the request was legitimate but the current state does not allow it.
  // 412: the OS could not be identified, so no template could be selected.
  const status = errorCode === "OS_DETECTION_UNAVAILABLE" ? 412
    : errorCode === "OS_TEMPLATE_MISSING" || errorCode === "OS_UNSUPPORTED" || errorCode === "OS_TEMPLATE_DISABLED" ? 422
      : errorCode === "VM_STOPPED_REQUIRED" ? 409
        : errorCode === "GUEST_AGENT_UNREACHABLE" ? 503
          : 409
  return { status, body: { success: false, error: text_, errorCode: errorCode || null } }
}

/**
 * A customer-safe view of a run.
 *
 * Operation names, statuses and how long each took. No command text, no
 * arguments, no substituted values, no Proxmox identifiers.
 */
export function publicRunResult(result: {
  runId: string
  status: string
  steps: Array<{ operation: string; status: GuestOperationStatus; changed: boolean; verified: boolean; durationMs: number; errorCode: string | null; error: string | null }>
  detected?: { osId?: string | null; name?: string | null; version?: string | null; engine?: string | null }
  errorCode?: string | null
  error?: string | null
}) {
  return {
    runId: result.runId,
    status: result.status,
    os: result.detected?.osId || null,
    osName: result.detected?.name || null,
    osVersion: result.detected?.version || null,
    errorCode: result.errorCode || null,
    error: result.error || null,
    operations: result.steps.map((step) => ({
      operation: step.operation,
      status: step.status,
      changed: step.changed,
      verified: step.verified,
      durationMs: step.durationMs,
      error: step.error,
      errorCode: step.errorCode,
    })),
  }
}

export async function auditCustomerChange(input: {
  vps: { id: string }
  customerId: string
  action: string
  actor: { ipAddress: string | null }
  result: Record<string, unknown>
}) {
  await createPanelLog({
    category: "Guest Automation",
    message: `Customer requested ${input.action}`,
    actorType: "customer",
    actorEmail: null,
    customerId: input.customerId,
    vpsInstanceId: input.vps.id,
    // No command, no arguments, no substituted values. The run id is enough to
    // find the full record, which is admin-only.
    metadata: { action: input.action, ip: input.actor.ipAddress, ...input.result },
  }).catch(() => null)
}

export async function notifyAfterChange(id: string, reason: string) {
  await publishLiveVmSnapshot(id, `guest:${reason}`).catch(() => null)
}
