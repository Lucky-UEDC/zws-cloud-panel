import type { ConsoleFrontendMode, ConsoleModeResult } from "@/lib/console-mode"

export type PersistedConsoleType = "auto" | "novnc" | "xtermjs"
export type RuntimeConsoleTransport = "vnc" | "serial"

export type ConsoleResolutionSettings = {
  defaultConsoleType?: unknown
  templateGroupConsoleTypes?: Record<string, unknown> | null
}

export type ConsoleTemplateInput = {
  consoleType?: unknown
  name?: string | null
  slug?: string | null
  osType?: string | null
  category?: string | null
  osFamily?: string | null
  osVersion?: string | null
  proxmoxTemplateName?: string | null
  proxmoxConfig?: unknown
}

export type ConsoleResolutionInput = {
  template?: ConsoleTemplateInput | null
  templateGroupConsoleType?: unknown
  settings?: ConsoleResolutionSettings | null
  systemDefault?: PersistedConsoleType
}

export type ConsoleResolutionResult = {
  consoleType: Exclude<PersistedConsoleType, "auto">
  persistedConsoleType: PersistedConsoleType
  transport: RuntimeConsoleTransport
  vmOsFamily: string
  source: "template" | "template-group" | "os-family" | "system-default"
}

const PERSISTED_TYPES = new Set<PersistedConsoleType>(["auto", "novnc", "xtermjs"])
const LINUX_FAMILIES = new Set([
  "almalinux",
  "alma",
  "arch",
  "centos",
  "cloudlinux",
  "debian",
  "fedora",
  "linux",
  "opensuse",
  "rhel",
  "rocky",
  "sles",
  "ubuntu",
])

export function normalizeConsoleType(value: unknown, fallback: PersistedConsoleType = "auto"): PersistedConsoleType {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")
  if (normalized === "novnc" || normalized === "vnc") return "novnc"
  if (normalized === "xtermjs" || normalized === "xterm" || normalized === "serial" || normalized === "terminal") return "xtermjs"
  if (normalized === "auto") return "auto"
  return PERSISTED_TYPES.has(fallback) ? fallback : "auto"
}

export function consoleTransportForType(type: PersistedConsoleType): RuntimeConsoleTransport {
  return normalizeConsoleType(type) === "novnc" ? "vnc" : "serial"
}

function textFromTemplate(template?: ConsoleTemplateInput | null) {
  const config = template?.proxmoxConfig
  return [
    template?.name,
    template?.slug,
    template?.osType,
    template?.category,
    template?.osFamily,
    template?.osVersion,
    template?.proxmoxTemplateName,
    typeof config === "string" ? config : JSON.stringify(config || {}),
  ].filter(Boolean).join(" ").toLowerCase()
}

export function detectConsoleOsFamily(template?: ConsoleTemplateInput | null): string {
  const explicit = String(template?.osFamily || "").trim().toLowerCase().replace(/\s+/g, "-")
  if (explicit) {
    if (explicit.includes("windows")) return "windows"
    if (explicit.includes("ubuntu")) return "ubuntu"
    if (explicit.includes("debian")) return "debian"
    if (explicit.includes("rocky")) return "rocky"
    if (explicit.includes("alma")) return "almalinux"
    if (explicit.includes("centos")) return "centos"
    if (explicit.includes("rhel")) return "rhel"
    if (explicit.includes("fedora")) return "fedora"
    if (explicit.includes("arch")) return "arch"
    if (explicit.includes("linux")) return "linux"
    return explicit
  }

  const text = textFromTemplate(template)
  if (/\b(windows|win10|win11|win2\d{3}|server\s*20\d{2})\b/.test(text)) return "windows"
  if (/\bubuntu\b/.test(text)) return "ubuntu"
  if (/\bdebian\b/.test(text)) return "debian"
  if (/\brocky\b/.test(text)) return "rocky"
  if (/\balma(?:linux)?\b/.test(text)) return "almalinux"
  if (/\bcentos\b/.test(text)) return "centos"
  if (/\brhel\b|red hat/.test(text)) return "rhel"
  if (/\bfedora\b/.test(text)) return "fedora"
  if (/\barch\b/.test(text)) return "arch"
  if (/\b(linux|cloud[-_\s]?init|genericcloud|generic-cloud)\b/.test(text)) return "linux"
  return "unknown"
}

export function detectConsoleTypeForFamily(family: string, fallback: PersistedConsoleType = "xtermjs"): Exclude<PersistedConsoleType, "auto"> {
  const normalized = String(family || "").trim().toLowerCase()
  if (normalized === "windows") return "novnc"
  if (LINUX_FAMILIES.has(normalized)) return "xtermjs"
  const defaultType = normalizeConsoleType(fallback, "xtermjs")
  return defaultType === "novnc" ? "novnc" : "xtermjs"
}

function groupKeys(template: ConsoleTemplateInput | null | undefined, vmOsFamily: string) {
  return [
    vmOsFamily,
    template?.osFamily,
    template?.category,
    template?.osType,
  ].map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean)
}

export function resolveConsoleType(input: ConsoleResolutionInput): ConsoleResolutionResult {
  const template = input.template || null
  const templateConsoleType = normalizeConsoleType(template?.consoleType)
  if (templateConsoleType !== "auto") {
    return {
      consoleType: templateConsoleType,
      persistedConsoleType: templateConsoleType,
      transport: consoleTransportForType(templateConsoleType),
      vmOsFamily: detectConsoleOsFamily(template),
      source: "template",
    }
  }

  const vmOsFamily = detectConsoleOsFamily(template)
  const groupOverride = normalizeConsoleType(input.templateGroupConsoleType)
  if (groupOverride !== "auto") {
    return {
      consoleType: groupOverride,
      persistedConsoleType: groupOverride,
      transport: consoleTransportForType(groupOverride),
      vmOsFamily,
      source: "template-group",
    }
  }

  const groups = input.settings?.templateGroupConsoleTypes || {}
  for (const key of groupKeys(template, vmOsFamily)) {
    const value = normalizeConsoleType(groups[key])
    if (value !== "auto") {
      return {
        consoleType: value,
        persistedConsoleType: value,
        transport: consoleTransportForType(value),
        vmOsFamily,
        source: "template-group",
      }
    }
  }

  if (vmOsFamily !== "unknown") {
    const familyType = detectConsoleTypeForFamily(vmOsFamily)
    return {
      consoleType: familyType,
      persistedConsoleType: familyType,
      transport: consoleTransportForType(familyType),
      vmOsFamily,
      source: "os-family",
    }
  }

  const systemDefault = normalizeConsoleType(input.systemDefault || input.settings?.defaultConsoleType || "xtermjs", "xtermjs")
  const consoleType = systemDefault === "novnc" ? "novnc" : "xtermjs"
  return {
    consoleType,
    persistedConsoleType: consoleType,
    transport: consoleTransportForType(consoleType),
    vmOsFamily,
    source: "system-default",
  }
}

export function consoleModeForResolvedType(resolution: Pick<ConsoleResolutionResult, "consoleType">): ConsoleModeResult {
  const selectedMode: ConsoleFrontendMode = resolution.consoleType === "novnc" ? "vnc" : "serial"
  return {
    mode: selectedMode,
    defaultMode: selectedMode,
    reason: resolution.consoleType === "novnc" ? "Smart Console resolved this VM to noVNC." : "Smart Console resolved this VM to xterm.js serial console.",
    display: {
      vga: null,
      serial0: null,
      spice: false,
      cloudInitPresent: resolution.consoleType === "xtermjs",
      likelyCloudImage: resolution.consoleType === "xtermjs",
      graphicalCompatible: resolution.consoleType === "novnc",
      reason: resolution.consoleType === "novnc" ? "Smart Console resolved graphical access." : "Smart Console resolved serial access.",
    },
    switches: {
      canUseSerial: resolution.consoleType === "xtermjs",
      canUseVnc: resolution.consoleType === "novnc",
    },
  }
}

export function consoleEndpointForVps(vpsId: string, actor: "client" | "admin" = "client") {
  return actor === "admin" ? `/admin/vms/${encodeURIComponent(vpsId)}/console` : `/client-area/vps/${encodeURIComponent(vpsId)}/console`
}
