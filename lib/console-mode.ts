export type ConsoleMode = "serial" | "vnc" | "both" | "unknown"
export type ConsoleFrontendMode = "serial" | "vnc"

export type ConsoleModeInput = {
  vmConfig?: Record<string, any> | null
  targetKind?: "qemu" | "lxc"
  osName?: string | null
  osSlug?: string | null
  osType?: string | null
  osCategory?: string | null
  templateName?: string | null
  templateConfig?: any
}

export type ConsoleModeResult = {
  mode: ConsoleMode
  defaultMode: ConsoleFrontendMode
  reason: string
  display: {
    vga: string | null
    serial0: string | null
    spice: boolean
    cloudInitPresent: boolean
    likelyCloudImage: boolean
    graphicalCompatible: boolean
    reason: string
  }
  switches: {
    canUseSerial: boolean
    canUseVnc: boolean
  }
}

const VGA_ALIASES: Record<string, string> = {
  "": "default",
  "default": "default",
  "std-vga": "std",
  "virtio-gpu": "virtio",
  "virtio-vga": "virtio",
}
const GRAPHICAL_VGA_TYPES = new Set(["default", "std", "virtio", "virtio-gl", "qxl", "vmware", "cirrus"])
const SERIAL_VGA_TYPES = new Set(["serial0", "serial1", "serial2", "serial3"])
const NON_GRAPHICAL_VGA_TYPES = new Set(["none", "serial0", "serial1", "serial2", "serial3"])

function stringValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : ""
  return text || null
}

export function baseVgaType(value: unknown) {
  const raw = stringValue(value)
  const base = raw ? raw.split(",")[0].toLowerCase() : ""
  return VGA_ALIASES[base] || base
}

function hasSocketSerial(config: Record<string, any> | null | undefined) {
  if (!config) return false
  return ["serial0", "serial1", "serial2", "serial3"].some((key) => {
    const value = typeof config[key] === "string" ? config[key].trim().split(",")[0]?.toLowerCase() : ""
    return value === "socket"
  })
}

function serial0Value(config: Record<string, any> | null | undefined) {
  return stringValue(config?.serial0)
}

function hasSpice(config: Record<string, any> | null | undefined) {
  if (!config) return false
  return Object.entries(config).some(([key, value]) => {
    const text = `${key} ${String(value || "")}`.toLowerCase()
    return text.includes("spice")
  })
}

function hasCloudInitConfig(config: Record<string, any> | null | undefined) {
  if (!config) return false
  for (const [key, value] of Object.entries(config)) {
    const lowerKey = key.toLowerCase()
    const lowerValue = String(value || "").toLowerCase()
    if (lowerKey === "citype" || lowerKey === "ciuser" || lowerKey === "cipassword") return true
    if (lowerKey.startsWith("ipconfig") || lowerKey === "sshkeys" || lowerKey === "nameserver" || lowerKey === "searchdomain") return true
    if (lowerValue.includes("cloudinit") || lowerValue.includes("cloud-init")) return true
  }
  return false
}

function textFromMetadata(input: ConsoleModeInput) {
  return [
    input.osName,
    input.osSlug,
    input.osType,
    input.osCategory,
    input.templateName,
    typeof input.templateConfig === "string" ? input.templateConfig : JSON.stringify(input.templateConfig || {}),
  ].filter(Boolean).join(" ").toLowerCase()
}

function isWindows(input: ConsoleModeInput) {
  const text = textFromMetadata(input)
  return /\b(windows|win10|win11|win2\d{3}|server\s*20\d{2})\b/.test(text)
}

function isLinux(input: ConsoleModeInput) {
  const text = textFromMetadata(input)
  return /\b(linux|ubuntu|debian|alma|almalinux|rocky|centos|rhel|fedora|arch|opensuse|sles|cloudlinux)\b/.test(text)
}

function isLikelyCloudImage(input: ConsoleModeInput, cloudInitPresent: boolean) {
  if (cloudInitPresent) return true
  const text = textFromMetadata(input)
  if (!text) return false
  if (/cloud[-_\s]?init|cloud image|genericcloud|generic-cloud|nocloud/.test(text)) return true
  return /(alma|rhel|rocky|centos|fedora|ubuntu|debian).*cloud/.test(text)
}

export function computeConsoleMode(input: ConsoleModeInput): ConsoleModeResult {
  const config = input.vmConfig || {}
  const targetKind = input.targetKind || "qemu"
  const vga = stringValue(config.vga)
  const serial0 = serial0Value(config)
  const vgaBase = baseVgaType(vga)
  const spice = hasSpice(config)
  const windowsGuest = isWindows(input)
  const linuxGuest = isLinux(input)
  const graphicalCompatible = GRAPHICAL_VGA_TYPES.has(vgaBase) || (windowsGuest && !NON_GRAPHICAL_VGA_TYPES.has(vgaBase))
  const serialDisplay = SERIAL_VGA_TYPES.has(vgaBase)
  const serialPresent = hasSocketSerial(config)
  const cloudInitPresent = hasCloudInitConfig(config)
  const likelyCloudImage = isLikelyCloudImage(input, cloudInitPresent)
  const canUseVnc = targetKind === "qemu" && graphicalCompatible && !serialDisplay
  const canUseSerial = targetKind === "lxc" || serialPresent

  let mode: ConsoleMode = "unknown"
  let defaultMode: ConsoleFrontendMode = "vnc"
  let reason = "Console mode could not be determined from the VM display configuration."

  if (windowsGuest && canUseVnc) {
    mode = "vnc"
    defaultMode = "vnc"
    reason = "Windows VPS consoles use noVNC graphical access."
  } else if (linuxGuest && canUseSerial && canUseVnc) {
    mode = "both"
    defaultMode = "vnc"
    reason = "Linux VPS consoles open in graphical noVNC by default; the serial console remains available."
  } else if (canUseSerial && canUseVnc) {
    mode = "both"
    defaultMode = "vnc"
    reason = likelyCloudImage
      ? "This cloud image has both graphical and serial console paths; graphical console opens by default and serial remains available."
      : "This VM has both graphical and serial console paths."
  } else if (canUseSerial) {
    mode = "serial"
    defaultMode = "serial"
    reason = targetKind === "lxc"
      ? "This container uses the Proxmox LXC terminal console."
      : serialDisplay
      ? "This VM is configured for serial console output."
      : "This VM exposes a serial console device."
  } else if (canUseVnc) {
    mode = "vnc"
    defaultMode = "vnc"
    reason = windowsGuest
      ? "This Windows VPS has a graphical console compatible with noVNC."
      : "This VM has a graphical VGA adapter compatible with noVNC."
  }

  return {
    mode,
    defaultMode,
    reason,
    display: {
      vga,
      serial0,
      spice,
      cloudInitPresent,
      likelyCloudImage,
      graphicalCompatible,
      reason,
    },
    switches: {
      canUseSerial: windowsGuest && canUseVnc ? false : canUseSerial,
      canUseVnc,
    },
  }
}

export function consoleModeLabel(mode: ConsoleMode) {
  if (mode === "serial") return "Serial console"
  if (mode === "vnc") return "Graphical console"
  if (mode === "both") return "Graphical + serial"
  return "Console unavailable"
}
