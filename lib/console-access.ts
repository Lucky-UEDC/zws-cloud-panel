import { getSetting, type ConsoleSettings } from "@/lib/settings"

export const CONSOLE_DISABLED_MESSAGE = "Console access is currently disabled by administrator."

type ConsoleModeData = {
  mode?: string
  defaultMode?: string
  switches?: { canUseSerial?: boolean; canUseVnc?: boolean }
}

type VpsConsoleInput = {
  status?: string | null
  consoleEnabled?: boolean | null
  product?: { metadata?: unknown } | null
}

function productAllowsConsole(product?: VpsConsoleInput["product"]) {
  const metadata = product?.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return true
  const value = (metadata as Record<string, unknown>).consoleEnabled
  return typeof value === "boolean" ? value : true
}

export async function getConsoleSettings() {
  return getSetting<ConsoleSettings>("console_settings")
}

export function evaluateConsoleAccess(
  settings: ConsoleSettings,
  vps: VpsConsoleInput,
  modeData?: ConsoleModeData | null,
) {
  const suspended = ["TERMINATED", "DELETED", "CANCELLED", "EXPIRED"].includes(String(vps.status || "").toUpperCase())
  const vpsEnabled = vps.consoleEnabled !== false && productAllowsConsole(vps.product)
  const globalAllowed = settings.globalConsoleEnabled && vpsEnabled && (!suspended || settings.allowSuspendedConsole)
  const terminal = Boolean(globalAllowed && settings.linuxTerminalEnabled && modeData?.switches?.canUseSerial)
  const graphical = Boolean(globalAllowed && settings.graphicalConsoleEnabled && modeData?.switches?.canUseVnc)
  const reason = globalAllowed ? null : CONSOLE_DISABLED_MESSAGE

  return {
    enabled: Boolean(globalAllowed && (terminal || graphical)),
    terminal,
    graphical,
    reason: reason || (!terminal && !graphical ? "Console is temporarily unavailable. Please try again shortly." : null),
    settings: {
      globalConsoleEnabled: settings.globalConsoleEnabled,
      linuxTerminalEnabled: settings.linuxTerminalEnabled,
      graphicalConsoleEnabled: settings.graphicalConsoleEnabled,
      allowSuspendedConsole: settings.allowSuspendedConsole,
    },
    vpsConsoleEnabled: vpsEnabled,
  }
}

export async function getConsoleAccess(vps: VpsConsoleInput, modeData?: ConsoleModeData | null) {
  return evaluateConsoleAccess(await getConsoleSettings(), vps, modeData)
}
