const GRAPHICAL_VGA_TYPES = new Set(["std", "virtio", "qxl"])

export type VncDisplayMetadata = {
  vga: string | null
  serial0: string | null
  compatible: boolean
}

function normalizeVga(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : ""
  return raw ? raw.split(",")[0].toLowerCase() : ""
}

export function getVncDisplayMetadata(config: Record<string, any> | null | undefined): VncDisplayMetadata {
  const vga = typeof config?.vga === "string" && config.vga.trim() ? config.vga.trim() : null
  const serial0 = typeof config?.serial0 === "string" && config.serial0.trim() ? config.serial0.trim() : null
  return {
    vga,
    serial0,
    compatible: GRAPHICAL_VGA_TYPES.has(normalizeVga(vga)),
  }
}

export function isVncDisplayCompatible(vga: unknown) {
  return GRAPHICAL_VGA_TYPES.has(normalizeVga(vga))
}
