import { isWindowsTemplateName } from "@/lib/os-template-normalization"

export const FALLBACK_OS_ICON = "/os-icons/linux.svg"

type OperatingSystemIconInput = {
  name?: string | null
  slug?: string | null
  osFamily?: string | null
  family?: string | null
  familyLabel?: string | null
  category?: string | null
  proxmoxTemplateName?: string | null
  iconUrl?: string | null
}

const OS_ICON_PATHS = {
  ubuntu: "/os-icons/ubuntu.svg",
  debian: "/os-icons/debian.svg",
  centos: "/os-icons/centos.svg",
  almalinux: "/os-icons/almalinux.svg",
  rocky: "/os-icons/rocky.svg",
  arch: "/os-icons/arch.svg",
  windows: "/os-icons/windows.svg",
  linux: FALLBACK_OS_ICON,
} as const

export function getOsFamily(input: string | OperatingSystemIconInput | null | undefined) {
  const value = osIconSearchText(input)
  if (isWindowsTemplateName(value)) return "windows"
  if (value.includes("ubuntu")) return "ubuntu"
  if (value.includes("debian")) return "debian"
  if (value.includes("centos")) return "centos"
  if (value.includes("alma")) return "almalinux"
  if (value.includes("rocky")) return "rocky"
  if (value.includes("arch")) return "arch"
  return "linux"
}

export function getOsIcon(input: string | OperatingSystemIconInput | null | undefined) {
  const family = getOsFamily(input)
  return OS_ICON_PATHS[family as keyof typeof OS_ICON_PATHS] || OS_ICON_PATHS.linux
}

export function getOsDescription(input: string | OperatingSystemIconInput | null | undefined) {
  const family = getOsFamily(input)
  if (family === "ubuntu") return "Popular server Linux"
  if (family === "debian") return "Stable server Linux"
  if (family === "almalinux") return "Enterprise Linux compatible"
  if (family === "rocky") return "Enterprise Linux compatible"
  if (family === "centos") return "Community enterprise Linux"
  if (family === "arch") return "Rolling-release Linux"
  if (family === "windows") return "Windows Server Image"
  return "Linux server image"
}

export function getResolvedOsIcon(input: string | OperatingSystemIconInput | null | undefined) {
  if (input && typeof input !== "string") {
    const customIcon = input.iconUrl?.trim()
    if (customIcon) return customIcon
  }
  return getOsIcon(input)
}

export function handleOsIconError(event: { currentTarget: HTMLImageElement }) {
  const image = event.currentTarget
  if (image.src.endsWith(FALLBACK_OS_ICON)) return
  image.src = FALLBACK_OS_ICON
}

function osIconSearchText(input: string | OperatingSystemIconInput | null | undefined) {
  if (!input) return ""
  if (typeof input === "string") return input.toLowerCase()
  return [
    input.name,
    input.slug,
    input.osFamily,
    input.family,
    input.familyLabel,
    input.category,
    input.proxmoxTemplateName,
  ].filter(Boolean).join(" ").toLowerCase()
}
