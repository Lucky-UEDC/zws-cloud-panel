/**
 * Canonical vocabulary for the guest automation engine.
 *
 * Everything the engine is allowed to do is enumerated here. The admin
 * template editor can only select from these values, and the runtime
 * validators reject anything outside them — that is what makes "adding a new
 * OS" a configuration task instead of a source-code task.
 */

export const GUEST_OPERATIONS = [
  "detect_os",
  "detect_network",
  "detect_filesystem",
  "set_ip",
  "set_gateway",
  "set_dns",
  "set_password",
  "create_user",
  "update_user",
  "enable_user",
  "disable_user",
  "delete_user",
  "set_hostname",
  "disk_usage",
  "disk_usage_all",
  "disk_resize",
  "filesystem_grow",
  "enable_ssh",
  "enable_rdp",
  "firewall",
  "reboot",
  "shutdown",
  "timezone",
  "guest_health",
] as const

export type GuestOperation = (typeof GUEST_OPERATIONS)[number]

/**
 * Engines are mutually exclusive. A `linux-*` shell is never executed against a
 * guest whose resolved engine is `windows`, and vice versa. This is enforced in
 * `assertShellMatchesEngine` and covered by cross-OS unit tests.
 */
export type GuestEngine = "linux" | "windows"

export const GUEST_ENGINES: GuestEngine[] = ["linux", "windows"]

export const GUEST_SHELLS = [
  "linux-sh",
  "linux-bash",
  "windows-powershell",
  "windows-cmd",
  "windows-netsh",
] as const

export type GuestShell = (typeof GUEST_SHELLS)[number]

export const GUEST_COMMAND_TYPES = ["guest-native", "guest-exec"] as const
export type GuestCommandType = (typeof GUEST_COMMAND_TYPES)[number]

export const GUEST_DANGER_LEVELS = ["safe", "caution", "dangerous"] as const
export type GuestDangerLevel = (typeof GUEST_DANGER_LEVELS)[number]

/**
 * Native `qm guest cmd` verbs. Native-first is a hard requirement: a shell is
 * only spawned when no native verb exists for the job.
 */
export const GUEST_NATIVE_VERBS = [
  "ping",
  "get-osinfo",
  "get-host-name",
  "get-users",
  "get-time",
  "get-timezone",
  "get-vcpus",
  "get-memory-blocks",
  "network-get-interfaces",
  "get-fsinfo",
  "fstrim",
  "set-user-password",
] as const

export type GuestNativeVerb = (typeof GUEST_NATIVE_VERBS)[number]

/**
 * Read-only verbs. These are safe to call before the engine is known, because
 * they change nothing and their payload is what we use to learn the engine.
 */
export const GUEST_READ_ONLY_VERBS: ReadonlySet<string> = new Set<string>([
  "ping",
  "get-osinfo",
  "get-host-name",
  "get-users",
  "get-time",
  "get-timezone",
  "get-vcpus",
  "get-memory-blocks",
  "network-get-interfaces",
  "get-fsinfo",
])

/** Verbs that mutate the guest. They require a resolved engine. */
export const GUEST_MUTATING_VERBS: ReadonlySet<string> = new Set<string>([
  "fstrim",
  "set-user-password",
])

export type GuestVerificationParser =
  | "df-posix"
  | "win-logicaldisk"
  | "fsutil-list"
  | "native-json"
  | "native-interfaces"
  | "native-osinfo"
  | "native-users"
  | "native-hostname"
  | "native-fsinfo"
  | "exit-code"
  | "none"

export const GUEST_VERIFICATION_PARSERS: GuestVerificationParser[] = [
  "df-posix",
  "win-logicaldisk",
  "fsutil-list",
  "native-json",
  "native-interfaces",
  "native-osinfo",
  "native-users",
  "native-hostname",
  "native-fsinfo",
  "exit-code",
  "none",
]

export type GuestOperationStatus =
  | "pending"
  | "running"
  | "success"
  | "already_applied"
  | "skipped"
  | "failed"
  | "timeout"
  | "unsupported"

export const GUEST_OPERATION_STATUSES: GuestOperationStatus[] = [
  "pending",
  "running",
  "success",
  "already_applied",
  "skipped",
  "failed",
  "timeout",
  "unsupported",
]

/**
 * Machine-readable error codes. The customer UI maps these to plain language;
 * admins see the code. Stack traces never cross the API boundary.
 */
export type GuestErrorCode =
  | "OS_DETECTION_UNAVAILABLE"
  | "OS_UNSUPPORTED"
  | "OS_TEMPLATE_MISSING"
  | "OS_TEMPLATE_DISABLED"
  | "GUEST_AGENT_DISABLED"
  | "GUEST_AGENT_UNREACHABLE"
  | "GUEST_AGENT_TIMEOUT"
  | "GUEST_EXEC_FAILED"
  | "GUEST_EXEC_TIMEOUT"
  | "PARSE_FAILED"
  | "DISK_DATA_INVALID"
  | "VM_STOPPED"
  | "VM_RUNNING_REQUIRED"
  | "VM_STOPPED_REQUIRED"
  | "CROSS_OS_VIOLATION"
  | "TEMPLATE_INVALID"
  | "UNSUPPORTED_OPERATION"
  | "VERIFICATION_FAILED"
  | "ROLLBACK_FAILED"
  | "NETWORK_RECOVERY_REQUIRED"
  | "TEMPLATE_TEST_FAILED"
  | "INTERNAL_ERROR"

/** Human-readable, customer-safe copy for every error code. */
export const GUEST_ERROR_MESSAGES: Record<GuestErrorCode, string> = {
  OS_DETECTION_UNAVAILABLE: "OS detection unavailable",
  OS_UNSUPPORTED: "This operating system is not yet supported for automated configuration.",
  OS_TEMPLATE_MISSING: "No automation profile is configured for this operating system.",
  OS_TEMPLATE_DISABLED: "Automation for this operating system is currently disabled.",
  GUEST_AGENT_DISABLED: "Guest agent unavailable",
  GUEST_AGENT_UNREACHABLE: "Guest agent unavailable",
  GUEST_AGENT_TIMEOUT: "Guest agent unavailable",
  GUEST_EXEC_FAILED: "The guest could not run the requested operation.",
  GUEST_EXEC_TIMEOUT: "The guest did not respond in time.",
  PARSE_FAILED: "The guest returned an unreadable response.",
  DISK_DATA_INVALID: "Disk usage unavailable",
  VM_STOPPED: "Server stopped",
  VM_RUNNING_REQUIRED: "This server must be running to apply the change.",
  VM_STOPPED_REQUIRED: "This server must be stopped to apply the change.",
  CROSS_OS_VIOLATION: "Refused to run: the command does not match this server's operating system.",
  TEMPLATE_INVALID: "The automation profile is invalid and was not applied.",
  UNSUPPORTED_OPERATION: "This operation is not available for this operating system.",
  VERIFICATION_FAILED: "The change could not be verified.",
  ROLLBACK_FAILED: "The change could not be rolled back. Support has been notified.",
  NETWORK_RECOVERY_REQUIRED: "Network recovery is required. Support has been notified.",
  TEMPLATE_TEST_FAILED: "The test run failed.",
  INTERNAL_ERROR: "The operation could not be completed.",
}

export type GuestRunStatus = "pending" | "running" | "success" | "partial" | "failed" | "rolled_back"

export type GuestRunTrigger = "first_boot" | "customer_change" | "repair" | "admin_test" | "scheduled" | "adoption"

export const GUEST_RUN_TRIGGERS: GuestRunTrigger[] = [
  "first_boot",
  "customer_change",
  "repair",
  "admin_test",
  "scheduled",
  "adoption",
]

/**
 * Ordered first-boot sequence. Progress is surfaced verbatim to the customer
 * deployment page, so each step must read as plain language.
 */
export const FIRST_BOOT_SEQUENCE: GuestOperation[] = [
  "set_ip",
  "set_gateway",
  "set_dns",
  "set_hostname",
  "set_password",
  "create_user",
  "enable_ssh",
  "timezone",
  "guest_health",
]

/** Customer-facing progress labels for the deployment state machine. */
export const DEPLOYMENT_STAGES = [
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "ORDER_ACCEPTED",
  "NODE_SELECTED",
  "VM_CREATED",
  "VM_STARTED",
  "WAITING_FOR_GUEST_AGENT",
  "DETECTING_OS",
  "LOADING_OS_TEMPLATE",
  "CONFIGURING_NETWORK",
  "CONFIGURING_ACCESS",
  "CONFIGURING_GUEST",
  "VERIFYING_GUEST",
  "COLLECTING_METRICS",
  "SERVICE_ACTIVE",
  "SERVICE_FAILED",
] as const

export type DeploymentStage = (typeof DEPLOYMENT_STAGES)[number]

/** Plain-language copy for each stage (customer UI must not leak Proxmox terms). */
export const DEPLOYMENT_STAGE_LABELS: Record<DeploymentStage, string> = {
  PAYMENT_PENDING: "Waiting for payment confirmation",
  PAYMENT_CONFIRMED: "Payment confirmed",
  ORDER_ACCEPTED: "Order accepted",
  NODE_SELECTED: "Allocating your server",
  VM_CREATED: "Server created",
  VM_STARTED: "Starting your server",
  WAITING_FOR_GUEST_AGENT: "Waiting for guest agent",
  DETECTING_OS: "Detecting operating system",
  LOADING_OS_TEMPLATE: "Loading OS profile",
  CONFIGURING_NETWORK: "Configuring network",
  CONFIGURING_ACCESS: "Configuring access",
  CONFIGURING_GUEST: "Applying system settings",
  VERIFYING_GUEST: "Verifying your server",
  COLLECTING_METRICS: "Collecting resource usage",
  SERVICE_ACTIVE: "Service active",
  SERVICE_FAILED: "Service failed",
}

/**
 * Operations that can leave a guest unmanagegable if interrupted. These get a
 * recorded backup point, a rollback attempt, and (for network) an immediate
 * admin escalation when verification fails.
 */
export const NETWORK_OPERATIONS: ReadonlySet<GuestOperation> = new Set([
  "set_ip",
  "set_gateway",
  "set_dns",
  "firewall",
])

export const DESTRUCTIVE_OPERATIONS: ReadonlySet<GuestOperation> = new Set([
  "delete_user",
  "disable_user",
  "disk_resize",
  "filesystem_grow",
  "firewall",
])

/** Operations that cannot be idempotency-checked before running. */
export const NON_IDEMPOTENT_OPERATIONS: ReadonlySet<GuestOperation> = new Set([
  "reboot",
  "shutdown",
  "set_password",
])

export function isGuestOperation(value: unknown): value is GuestOperation {
  return typeof value === "string" && (GUEST_OPERATIONS as readonly string[]).includes(value)
}

export function isGuestShell(value: unknown): value is GuestShell {
  return typeof value === "string" && (GUEST_SHELLS as readonly string[]).includes(value)
}

export function isGuestEngine(value: unknown): value is GuestEngine {
  return value === "linux" || value === "windows"
}

export function isGuestDangerLevel(value: unknown): value is GuestDangerLevel {
  return typeof value === "string" && (GUEST_DANGER_LEVELS as readonly string[]).includes(value)
}

export function isGuestCommandType(value: unknown): value is GuestCommandType {
  return typeof value === "string" && (GUEST_COMMAND_TYPES as readonly string[]).includes(value)
}

export function isGuestNativeVerb(value: unknown): value is GuestNativeVerb {
  return typeof value === "string" && (GUEST_NATIVE_VERBS as readonly string[]).includes(value)
}

export function isGuestVerificationParser(value: unknown): value is GuestVerificationParser {
  return typeof value === "string" && (GUEST_VERIFICATION_PARSERS as readonly string[]).includes(value)
}

/** Engine implied by a shell id. `null` for an unknown shell. */
export function engineForShell(shell: unknown): GuestEngine | null {
  if (shell === "linux-sh" || shell === "linux-bash") return "linux"
  if (shell === "windows-powershell" || shell === "windows-cmd" || shell === "windows-netsh") return "windows"
  return null
}

/**
 * Hard cross-OS gate. Returns `null` when the pairing is safe, otherwise a
 * human-readable refusal reason. This is the single choke point that makes
 * "Linux command on a Windows guest" impossible rather than merely unlikely.
 */
export function assertShellMatchesEngine(
  shell: unknown,
  engine: GuestEngine | "unknown",
): { ok: true } | { ok: false; reason: string; code: "CROSS_OS_VIOLATION" } {
  const shellEngine = engineForShell(shell)
  if (!shellEngine) {
    return { ok: false, reason: `Unknown shell "${String(shell)}".`, code: "CROSS_OS_VIOLATION" }
  }
  if (engine === "unknown") {
    return {
      ok: false,
      reason: "Operating system detection is unavailable, so no guest command was run.",
      code: "CROSS_OS_VIOLATION",
    }
  }
  if (shellEngine !== engine) {
    const guestWord = engine === "windows" ? "Windows" : "Linux"
    const shellWord = shellEngine === "windows" ? "a Windows shell" : "a Linux shell"
    return {
      ok: false,
      reason: `Refusing to run ${shellWord} command on a ${guestWord} guest.`,
      code: "CROSS_OS_VIOLATION",
    }
  }
  return { ok: true }
}

/**
 * Command tokens that identify one engine. A template is checked against the
 * OTHER engine's list, so a Windows command pasted into a Linux template is
 * refused even when the shell field was set consistently. This is the
 * content-level guard behind the shell/engine gate.
 */
const WINDOWS_COMMAND_TOKENS = [
  "powershell",
  "pwsh",
  "netsh",
  "wmic",
  "win32_logicaldisk",
  "get-ciminstance",
  "net user",
  "diskpart",
  "fsutil",
  "choco",
  "sc.exe",
  "reg add",
]

const LINUX_COMMAND_TOKENS = [
  "df ",
  "df -",
  "/bin/",
  "systemctl",
  "nmcli",
  "netplan",
  "ifupdown",
  "ifup ",
  "ifdown",
  "/etc/network",
  "/etc/resolv",
  "chpasswd",
  "useradd",
  "adduser",
  "usermod",
  "apt-get",
  "apt install",
  "yum install",
  "dnf install",
  "zypper",
  "pacman",
  "apk add",
  "fstrim",
  "lsblk",
]

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Returns the list of offending tokens, empty when the command is engine-safe.
 * Matching is token-boundary based, so `df` matches the `df -B1 -P` collector
 * but never a similarly named binary.
 */
export function crossOsCommandViolations(command: unknown, engine: GuestEngine): string[] {
  const text = String(command || "").toLowerCase()
  if (!text.trim()) return []
  // The point of the list is to catch a command belonging to the OTHER engine.
  const forbidden = engine === "linux" ? WINDOWS_COMMAND_TOKENS : LINUX_COMMAND_TOKENS
  const hits: string[] = []
  for (const token of forbidden) {
    const needle = token.trim().toLowerCase()
    if (!needle) continue
    const pattern = new RegExp(`(^|[^a-z0-9._/-])${escapeRegExp(needle)}([^a-z0-9]|$)`)
    if (pattern.test(text)) hits.push(token)
  }
  return hits
}

/** Exposed for the admin editor help text. */
/** Tokens refused in each engine's templates, for the admin editor help text. */
export const CROSS_OS_FORBIDDEN_TOKENS: Record<GuestEngine, string[]> = {
  linux: WINDOWS_COMMAND_TOKENS,
  windows: LINUX_COMMAND_TOKENS,
}
