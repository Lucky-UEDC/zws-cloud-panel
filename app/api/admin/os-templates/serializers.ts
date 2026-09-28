import { defaultUsernameForOs, normalizeOsTemplate } from "@/lib/os-template-normalization"
import { isWindowsOsTemplate, osTemplateUnavailableReason } from "@/lib/os-template-availability"
import { normalizeConsoleType, resolveConsoleType } from "@/lib/console-resolution"

type AnyRecord = Record<string, any>

export function unsupportedTemplateReason(row: AnyRecord): string | null {
  if (String(row?.source || "").toLowerCase() !== "proxmox") return "Manual templates are not supported for reinstall"
  return osTemplateUnavailableReason(row, { purpose: "reinstall" })
}

/**
 * Is the QEMU guest agent channel open on this template?
 *
 * This is the only part of guest-agent readiness the host can see. Whether the
 * agent is actually installed inside the image cannot be known from the host, so
 * it is never reported here as fact — it is proven on the first clone.
 */
export function guestAgentChannelEnabled(row: AnyRecord): boolean {
  const config = row?.proxmoxConfig && typeof row.proxmoxConfig === "object" ? row.proxmoxConfig : {}
  return Object.entries(config as Record<string, unknown>).some(
    ([key, value]) => /^agent(\d+)?$/i.test(key) && Number(value) === 1,
  )
}

function templateWarnings(row: AnyRecord, _isWindows: boolean) {
  const warnings: string[] = []
  if (!guestAgentChannelEnabled(row)) {
    warnings.push("Guest agent channel is not enabled on this template. Guest automation configures servers through the QEMU guest agent, so a server cloned from this template cannot be configured until the channel is open.")
  }
  return warnings
}

function inferArchitecture(row: AnyRecord) {
  const config = row?.proxmoxConfig && typeof row.proxmoxConfig === "object" ? row.proxmoxConfig : {}
  const search = [
    row?.architecture,
    row?.arch,
    row?.format,
    row?.name,
    row?.slug,
    row?.proxmoxTemplateName,
    config?.arch,
    config?.architecture,
    config?.ostype,
  ].filter(Boolean).join(" ").toLowerCase()
  if (/\b(aarch64|arm64)\b/.test(search)) return "arm64"
  if (/\b(i386|i686|x86)\b/.test(search) && !/\b(x86_64|amd64|x64)\b/.test(search)) return "x86"
  return "x64"
}

export function serializeOperatingSystem(row: AnyRecord): AnyRecord {
  const normalized = normalizeOsTemplate(String(row.name || row.slug || row.proxmoxTemplateName || ""))
  const isWindows = normalized.familyKey === "windows" || isWindowsOsTemplate(row)
  const distro = isWindows ? "windows" : normalized.familyKey || String(row.osFamily || row.category || "linux").toLowerCase()
  const defaultUsername = isWindows ? "Administrator" : row.defaultUsername || defaultUsernameForOs(row.osFamily || row.name || "")
  const proxmoxConfig =
    row.proxmoxConfig === null || row.proxmoxConfig === undefined
      ? null
      : JSON.parse(JSON.stringify(row.proxmoxConfig))

  return {
    ...row,
    size: typeof row.size === "bigint" ? row.size.toString() : row.size ?? null,
    diskGb: row.diskGb === null || row.diskGb === undefined ? null : Number(row.diskGb),
    memoryMb: row.memoryMb === null || row.memoryMb === undefined ? null : Number(row.memoryMb),
    cpu: row.cpu === null || row.cpu === undefined ? null : Number(row.cpu),
    proxmoxVmid: row.proxmoxVmid === null || row.proxmoxVmid === undefined ? null : Number(row.proxmoxVmid),
    proxmoxConfig,
    defaultUsername,
    distro,
    family: distro,
    version: isWindows ? normalized.version || row.osVersion || null : row.osVersion || normalized.version || null,
    architecture: inferArchitecture(row),
    supportsSSH: !isWindows,
    guestAgentChannel: guestAgentChannelEnabled(row),
    osType: isWindows ? "windows" : "linux",
    osFamily: isWindows ? "windows" : row.osFamily || normalized.family,
    osVersion: isWindows ? normalized.version || null : row.osVersion || normalized.version || null,
    category: isWindows ? "windows" : row.category,
    isRecommended: Boolean(row.isRecommended),
    eolWarningText: row.eolWarningText || null,
    reinstallEnabled: row.reinstallEnabled !== false,
    supported: !unsupportedTemplateReason(row),

    consoleType: normalizeConsoleType(row.consoleType),
    resolvedConsoleType: resolveConsoleType({ template: row }).consoleType,
    unsupportedReason: unsupportedTemplateReason(row),
    warnings: templateWarnings(row, isWindows),
  }
}

export function isVmTemplateRecord(row: AnyRecord) {
  return row?.source === "PROXMOX" && row?.proxmoxVmid !== null && row?.proxmoxVmid !== undefined
}
