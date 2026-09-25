"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import {
  Activity,
  ArrowLeft,
  Camera,
  ClipboardPaste,
  Copy,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Keyboard,
  Maximize2,
  Minimize2,
  Monitor,
  Network,
  OctagonX,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Send,
  Server,
  Settings2,
  Terminal as TerminalIcon,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readJsonResponse } from "@/lib/client/safe-json"
import {
  classifyConsoleFailure,
  consoleFailureLabel,
  CONSOLE_STAGE_COPY,
  CONSOLE_STAGE_ORDER,
  type ConsoleConnectionStage,
  type ConsoleFailureCode,
  type ConsoleOverview,
} from "@/lib/console-contract"
import { cn } from "@/lib/utils"

type ConsoleMode = "vnc" | "serial"
type ScaleMode = "fit" | "local" | "none"
type ConnectOptions = { auto?: boolean; forceRenew?: boolean }

const CONSOLE_MODE_PREFERENCE_KEY = "myrdphub.console.preferredMode"

type ConsoleResponse = {
  success?: boolean
  error?: string
  message?: string
  code?: string
  mode?: ConsoleMode
  defaultMode?: ConsoleMode
  availableModes?: ConsoleMode[]
  consoleType?: "novnc" | "xtermjs"
  state?: string
  target?: { kind?: "qemu" | "lxc"; node?: string; vmid?: number }
  diagnostics?: Record<string, any>
  session?: { id?: string; expiresAt?: string; renewAfterAt?: string; ttlSeconds?: number }
  vnc?: { websocketUrl: string; password?: string }
  serial?: { websocketUrl: string; resizeToken?: string }
  vm?: { name?: string; status?: string }
}

type ConsoleCredentials = {
  success?: boolean
  ip?: string | null
  username?: string | null
  password?: string | null
  passwordAvailable?: boolean
  hostname?: string | null
  verification?: { status?: string | null; label?: string | null; checkedAt?: string | null; verifiedAt?: string | null }
  recovery?: { status?: string; message?: string; guidance?: string[] }
  message?: string
  error?: string
}

function resizeControlFrame(cols: number, rows: number) {
  const payload = new TextEncoder().encode(`ZWS_RESIZE:${Math.max(20, Math.floor(cols))}:${Math.max(5, Math.floor(rows))}`)
  const frame = new Uint8Array(payload.length + 1)
  frame[0] = 0
  frame.set(payload, 1)
  return frame
}

function sampleVisibleCanvas(container: HTMLDivElement | null) {
  const canvas = container?.querySelector("canvas")
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null
  const context = canvas.getContext("2d")
  if (!context) return null
  const width = canvas.width
  const height = canvas.height
  const sampleWidth = Math.max(1, Math.min(96, width))
  const sampleHeight = Math.max(1, Math.min(96, height))
  const stepX = Math.max(1, Math.floor(width / sampleWidth))
  const stepY = Math.max(1, Math.floor(height / sampleHeight))
  let nonBlack = 0
  let samples = 0
  try {
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const data = context.getImageData(x, y, 1, 1).data
        samples += 1
        if (data[3] > 0 && (data[0] > 8 || data[1] > 8 || data[2] > 8)) nonBlack += 1
        if (nonBlack >= 8) return { width, height, nonBlack, samples }
      }
    }
  } catch {
    return null
  }
  return { width, height, nonBlack, samples }
}

function labelForMode(mode: ConsoleMode | null) {
  if (mode === "vnc") return "noVNC graphical console"
  if (mode === "serial") return "xterm.js serial console"
  return "Automatic console"
}

function storedConsoleMode() {
  if (typeof window === "undefined") return null
  const value = window.localStorage.getItem(CONSOLE_MODE_PREFERENCE_KEY)
  return value === "vnc" || value === "serial" ? value : null
}

function rememberConsoleMode(mode: ConsoleMode, availableModes: ConsoleMode[]) {
  if (typeof window === "undefined" || availableModes.length < 2) return
  window.localStorage.setItem(CONSOLE_MODE_PREFERENCE_KEY, mode)
}

function summarizeDiagnostics(diagnostics?: Record<string, any> | null) {
  if (!diagnostics) return ""
  const targetKind = diagnostics.detection?.targetKind
  const runtimeStatus = diagnostics.detection?.runtimeStatus
  const display = diagnostics.detection?.display
  const bits = [
    targetKind ? `target=${targetKind}` : "",
    runtimeStatus ? `status=${runtimeStatus}` : "",
    display?.vga ? `vga=${display.vga}` : "",
    display?.serial0 ? `serial0=${display.serial0}` : "",
    display?.spice ? "spice=true" : "",
  ].filter(Boolean)
  return bits.join(" · ")
}

const KEYSYM_CONTROL_L = 0xffe3
const KEYSYM_C = 0x0063
const KEYSYM_V = 0x0076
const consoleActionButtonClass = "h-9 rounded-md px-3 text-sm gap-2"

function isPasteShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
  const key = event.key.toLowerCase()
  return ((event.ctrlKey || event.metaKey) && key === "v") || (event.shiftKey && event.key === "Insert")
}

export function SmartConsole({
  title,
  sessionEndpoint,
  overviewEndpoint,
  resizeEndpoint,
  ctrlAltDelEndpoint,
  powerEndpoint,
  credentialsEndpoint,
  serverName = "Cloud server",
  backHref,
  monitoringHref,
  className,
}: {
  title: string
  sessionEndpoint: string
  overviewEndpoint: string
  resizeEndpoint?: string
  ctrlAltDelEndpoint?: string
  powerEndpoint?: string
  credentialsEndpoint?: string
  serverName?: string
  backHref?: string
  monitoringHref?: string
  className?: string
}) {
  const consoleShellRef = useRef<HTMLDivElement | null>(null)
  const screenRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<any>(null)
  const fitRef = useRef<any>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const rfbRef = useRef<any>(null)
  const remoteClipboardRef = useRef("")
  const pendingClipboardRef = useRef<((text: string) => void) | null>(null)
  const resizeTokenRef = useRef<string | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const displayWatchRef = useRef<{ interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout>; heartbeat?: ReturnType<typeof setInterval> }>({})
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRenewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const connectionIdRef = useRef(0)
  const connectRef = useRef<((nextMode?: ConsoleMode | null, options?: ConnectOptions) => Promise<void>) | null>(null)
  const busyRef = useRef(false)
  const [status, setStatus] = useState("Idle")
  const [mode, setMode] = useState<ConsoleMode | null>(null)
  const [requestedMode, setRequestedMode] = useState<ConsoleMode | null>(null)
  const [availableModes, setAvailableModes] = useState<ConsoleMode[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Record<string, any> | null>(null)
  const [displayReady, setDisplayReady] = useState(false)
  const [scaleMode, setScaleMode] = useState<ScaleMode>("fit")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showDisplaySettings, setShowDisplaySettings] = useState(false)
  const [showPowerMenu, setShowPowerMenu] = useState(false)
  const [credentials, setCredentials] = useState<ConsoleCredentials | null>(null)
  const [credentialsBusy, setCredentialsBusy] = useState(false)
  const [passwordRevealed, setPasswordRevealed] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [overview, setOverview] = useState<ConsoleOverview | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [stage, setStage] = useState<ConsoleConnectionStage>("connecting_node")
  const [failureCode, setFailureCode] = useState<ConsoleFailureCode | null>(null)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)

  const passwordEndpoint = useMemo(() => credentialsEndpoint?.replace(/\/credentials\/?$/, "/password"), [credentialsEndpoint])

  const loadOverview = useCallback(async () => {
    try {
      const response = await fetch(overviewEndpoint, { cache: "no-store" })
      const data = await readJsonResponse<ConsoleOverview & { error?: string }>(response)
      if (!response.ok || !data || data.success !== true) throw new Error(data?.error || "Unable to refresh server status")
      setOverview(data)
      setOverviewError(null)
      setAvailableModes(data.availableModes)
      if (!requestedMode && data.defaultMode) setRequestedMode(data.defaultMode)
    } catch (overviewLoadError: any) {
      setOverviewError(overviewLoadError?.message || "Status temporarily unavailable")
    }
  }, [overviewEndpoint, requestedMode])

  const refreshFullscreenState = useCallback(() => {
    const fullscreenElement = document.fullscreenElement
    setIsFullscreen(Boolean(fullscreenElement && fullscreenElement === consoleShellRef.current))
  }, [])

  const focusConsole = useCallback(() => {
    const target = screenRef.current
    if (!target) return
    target.focus({ preventScroll: true })
    const canvas = target.querySelector("canvas") as HTMLCanvasElement | null
    if (canvas) {
      canvas.tabIndex = 0
      canvas.style.outline = "none"
      canvas.focus({ preventScroll: true })
    }
    try {
      rfbRef.current?.focus?.({ preventScroll: true })
    } catch {}
    try {
      terminalRef.current?.focus?.()
    } catch {}
  }, [])

  const applyVncScale = useCallback(() => {
    const rfb = rfbRef.current
    if (!rfb) return
    try {
      rfb.clipViewport = false
      rfb.scaleViewport = scaleMode === "fit"
      rfb.resizeSession = scaleMode !== "none"
      if (scaleMode !== "none") rfb._requestRemoteResize?.()
    } catch {}
  }, [scaleMode])

  const resizeTerminal = useCallback(async () => {
    if (!resizeEndpoint || !resizeTokenRef.current || !fitRef.current || !terminalRef.current) return
    try {
      fitRef.current.fit()
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(resizeControlFrame(terminalRef.current.cols, terminalRef.current.rows))
        return
      }
      await fetch(resizeEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resizeToken: resizeTokenRef.current,
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }),
      })
    } catch {
      // Resize is best-effort; the websocket remains useful if it fails.
    }
  }, [resizeEndpoint])

  const resizeConsole = useCallback(() => {
    applyVncScale()
    void resizeTerminal()
  }, [applyVncScale, resizeTerminal])

  const sendVncKeyChord = useCallback((keySym: number, code: string) => {
    const rfb = rfbRef.current
    if (!rfb || typeof rfb.sendKey !== "function") return false
    focusConsole()
    rfb.sendKey(KEYSYM_CONTROL_L, "ControlLeft", true)
    rfb.sendKey(keySym, code, true)
    rfb.sendKey(keySym, code, false)
    rfb.sendKey(KEYSYM_CONTROL_L, "ControlLeft", false)
    return true
  }, [focusConsole])

  const stopDisplayWatch = useCallback(() => {
    if (displayWatchRef.current.interval) clearInterval(displayWatchRef.current.interval)
    if (displayWatchRef.current.timeout) clearTimeout(displayWatchRef.current.timeout)
    if (displayWatchRef.current.heartbeat) clearInterval(displayWatchRef.current.heartbeat)
    displayWatchRef.current = {}
  }, [])

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
  }, [])

  const clearSessionRenewTimer = useCallback(() => {
    if (sessionRenewTimerRef.current) clearTimeout(sessionRenewTimerRef.current)
    sessionRenewTimerRef.current = null
  }, [])

  const scheduleSessionRenewal = useCallback((session: ConsoleResponse["session"] | undefined, nextMode: ConsoleMode | null) => {
    clearSessionRenewTimer()
    if (!session?.renewAfterAt || !nextMode) return
    const renewAt = new Date(session.renewAfterAt).getTime()
    if (!Number.isFinite(renewAt)) return
    const delayMs = Math.max(5_000, renewAt - Date.now())
    sessionRenewTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(sessionEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: nextMode, renew: true }),
        })
        const data: ConsoleResponse = (await readJsonResponse<ConsoleResponse>(res).catch(() => null)) || {}
        if (res.ok && data.success !== false) {
          scheduleSessionRenewal(data.session, nextMode)
          setStatus((current) => current === "Connection failed" ? current : "Console ticket renewed")
        } else {
          scheduleSessionRenewal({ renewAfterAt: new Date(Date.now() + 30_000).toISOString() }, nextMode)
        }
      } catch {
        scheduleSessionRenewal({ renewAfterAt: new Date(Date.now() + 30_000).toISOString() }, nextMode)
      }
    }, delayMs)
  }, [clearSessionRenewTimer, sessionEndpoint])

  const scheduleReconnect = useCallback((reason: string, nextMode: ConsoleMode | null, connectionId: number) => {
    if (connectionId !== connectionIdRef.current) return
    stopDisplayWatch()
    if (reconnectTimerRef.current) return
    const nextAttempt = reconnectAttemptsRef.current + 1
    if (nextAttempt > 3) {
      setStatus("Connection failed")
      setFailureCode(classifyConsoleFailure(null, reason))
      setError(`${reason}. Automatic reconnect failed; use Retry to mint a fresh console ticket.`)
      return
    }
    reconnectAttemptsRef.current = nextAttempt
    const delayMs = Math.min(1000 * 2 ** (nextAttempt - 1), 8000)
    setStatus("Reconnecting...")
    setFailureCode(classifyConsoleFailure(null, reason))
    setError(`${reason}. Reconnecting with a fresh console ticket...`)
    clearReconnectTimer()
    reconnectTimerRef.current = setTimeout(() => {
      void connectRef.current?.(nextMode, { auto: true })
    }, delayMs)
  }, [clearReconnectTimer, stopDisplayWatch])

  const watchForVncDisplay = useCallback((onTimeout?: () => void) => {
    stopDisplayWatch()
    setDisplayReady(false)
    displayWatchRef.current.interval = setInterval(() => {
      const sample = sampleVisibleCanvas(screenRef.current)
      if (sample && sample.nonBlack > 0) {
        stopDisplayWatch()
        setDisplayReady(true)
        setStage("ready")
        setFailureCode(null)
        setError(null)
        setStatus("Console Ready")
        focusConsole()
        applyVncScale()
      }
    }, 500)
    displayWatchRef.current.timeout = setTimeout(() => {
      const sample = sampleVisibleCanvas(screenRef.current)
      if (sample && sample.nonBlack > 0) return
      setDisplayReady(false)
      setFailureCode("framebuffer_timeout")
      setError("VNC framebuffer timeout: transport is connected, but no visible display was sampled yet.")
      setStatus("Awaiting visible framebuffer")
      onTimeout?.()
    }, 30000)
    displayWatchRef.current.heartbeat = setInterval(() => {
      focusConsole()
      applyVncScale()
    }, 15000)
  }, [applyVncScale, focusConsole, stopDisplayWatch])

  const cleanup = useCallback(() => {
    clearReconnectTimer()
    clearSessionRenewTimer()
    stopDisplayWatch()
    try {
      socketRef.current?.close()
    } catch {}
    try {
      rfbRef.current?.disconnect()
    } catch {}
    try {
      terminalRef.current?.dispose()
    } catch {}
    try {
      resizeObserverRef.current?.disconnect()
    } catch {}
    socketRef.current = null
    rfbRef.current = null
    terminalRef.current = null
    fitRef.current = null
    resizeTokenRef.current = null
    resizeObserverRef.current = null
    setDisplayReady(false)
  }, [clearReconnectTimer, clearSessionRenewTimer, stopDisplayWatch])

  const installResizeObserver = useCallback(() => {
    resizeObserverRef.current?.disconnect()
    if (!screenRef.current || typeof ResizeObserver === "undefined") return
    resizeObserverRef.current = new ResizeObserver(() => resizeConsole())
    resizeObserverRef.current.observe(screenRef.current)
  }, [resizeConsole])

  const connect = useCallback(async (nextMode = requestedMode, options: ConnectOptions = {}) => {
    if (!screenRef.current || busyRef.current) return
    const storedMode = storedConsoleMode()
    const preferredMode = nextMode
      || (storedMode && overview?.availableModes.includes(storedMode) ? storedMode : null)
      || overview?.defaultMode
      || null
    const connectionId = connectionIdRef.current + 1
    connectionIdRef.current = connectionId
    if (!options.auto) reconnectAttemptsRef.current = 0
    busyRef.current = true
    setBusy(true)
    setError(null)
    setFailureCode(null)
    setDiagnostics(null)
    setStage("connecting_node")
    setStatus("Connecting to node...")
    if (options.auto) {
      clearReconnectTimer()
      clearSessionRenewTimer()
      stopDisplayWatch()
      try {
        socketRef.current?.close()
      } catch {}
      try {
        rfbRef.current?.disconnect()
      } catch {}
      socketRef.current = null
      rfbRef.current = null
    } else {
      cleanup()
      screenRef.current.innerHTML = ""
    }
    screenRef.current.tabIndex = 0

    try {
      const res = await fetch(sessionEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(preferredMode ? { mode: preferredMode } : {}),
          ...((options.auto || options.forceRenew) ? { forceRenew: true } : {}),
        }),
      })
      setStage("authenticating_session")
      setStatus("Authenticating...")
      const data: ConsoleResponse = (await readJsonResponse<ConsoleResponse>(res).catch(() => null)) || {}
      setDiagnostics(data.diagnostics || null)
      if (!res.ok || data.success === false) {
        const message = data.error || data.message || data.code || "Could not create console session"
        const nextError = new Error(message) as Error & { code?: string }
        nextError.code = data.code
        throw nextError
      }
      const nextAvailableModes = Array.isArray(data.availableModes) ? data.availableModes : data.defaultMode ? [data.defaultMode] : []
      setAvailableModes(nextAvailableModes)
      setStage("preparing_display")
      setStatus("Preparing console...")

      if (data.vnc?.websocketUrl) {
        screenRef.current.innerHTML = ""
        setMode("vnc")
        setRequestedMode("vnc")
        rememberConsoleMode("vnc", nextAvailableModes)
        scheduleSessionRenewal(data.session, "vnc")
        setDisplayReady(false)
        setStatus("Preparing display...")
        const mod = await import("@novnc/novnc")
        const RFB = (mod as any).default || mod
        setStage("fetching_framebuffer")
        setStatus("Fetching framebuffer...")
        const rfb = new RFB(screenRef.current, data.vnc.websocketUrl, data.vnc.password ? { credentials: { password: data.vnc.password } } : undefined)
        rfb.focusOnClick = true
        rfb.clipViewport = false
        rfb.scaleViewport = scaleMode === "fit"
        rfb.resizeSession = scaleMode !== "none"
        rfb.viewOnly = false
        rfb.addEventListener("connect", () => {
          reconnectAttemptsRef.current = 0
          setError(null)
          setFailureCode(null)
          setStage("fetching_framebuffer")
          setStatus("VNC transport connected")
          window.setTimeout(() => setStatus("Awaiting framebuffer"), 50)
          setStatus("Awaiting framebuffer")
          focusConsole()
          applyVncScale()
          watchForVncDisplay(() => scheduleReconnect("VNC framebuffer timeout", nextMode || "vnc", connectionId))
        })
        rfb.addEventListener("desktopname", () => {
          setStatus((current) => current.startsWith("Framebuffer received") ? current : "Awaiting framebuffer")
        })
        rfb.addEventListener("securityfailure", (event: any) => {
          stopDisplayWatch()
          scheduleReconnect(`VNC authentication failed${event?.detail?.reason ? `: ${event.detail.reason}` : ""}`, nextMode || "vnc", connectionId)
        })
        rfb.addEventListener("disconnect", (event: any) => {
          stopDisplayWatch()
          const clean = Boolean(event?.detail?.clean)
          scheduleReconnect(clean ? "Console websocket closed" : "Console websocket disconnected", nextMode || "vnc", connectionId)
        })
        rfb.addEventListener("clipboard", (event: any) => {
          const text = String(event?.detail?.text || "")
          remoteClipboardRef.current = text
          pendingClipboardRef.current?.(text)
          pendingClipboardRef.current = null
          if (text) void navigator.clipboard.writeText(text).catch(() => undefined)
        })
        rfbRef.current = rfb
        installResizeObserver()
      } else if (data.serial?.websocketUrl) {
        screenRef.current.innerHTML = ""
        setMode("serial")
        setRequestedMode("serial")
        rememberConsoleMode("serial", nextAvailableModes)
        scheduleSessionRenewal(data.session, "serial")
        setDisplayReady(false)
        setStatus("Preparing display...")
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ])
        const term = new Terminal({
          cursorBlink: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          theme: { background: "#050807", foreground: "#d7f7ef" },
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(screenRef.current)
        fit.fit()
        term.focus()
        terminalRef.current = term
        fitRef.current = fit
        resizeTokenRef.current = data.serial.resizeToken || null
        installResizeObserver()

        const ws = new WebSocket(data.serial.websocketUrl)
        socketRef.current = ws
        ws.binaryType = "arraybuffer"
        ws.onopen = () => {
          setStage("fetching_framebuffer")
          setStatus("Waiting for terminal output...")
          term.focus()
          void resizeTerminal()
          displayWatchRef.current.heartbeat = setInterval(() => void resizeTerminal(), 15000)
        }
        ws.onmessage = (event) => {
          reconnectAttemptsRef.current = 0
          setError(null)
          setFailureCode(null)
          setDisplayReady(true)
          setStage("ready")
          setStatus("Console Ready")
          if (event.data instanceof ArrayBuffer) term.write(new TextDecoder().decode(event.data))
          else term.write(String(event.data || ""))
        }
        ws.onclose = () => {
          stopDisplayWatch()
          scheduleReconnect("Serial console websocket closed", nextMode || "serial", connectionId)
        }
        ws.onerror = () => scheduleReconnect("Serial console websocket error", nextMode || "serial", connectionId)
        term.onData((chunk) => {
          setStatus("Keyboard active")
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
        })
      } else {
        throw new Error("No supported console transport was returned.")
      }
    } catch (connectError: any) {
      const message = connectError?.message || "Console connection failed"
      setFailureCode(classifyConsoleFailure(connectError?.code, message))
      setError(message)
      setStatus("Connection failed")
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [applyVncScale, cleanup, clearReconnectTimer, clearSessionRenewTimer, focusConsole, installResizeObserver, overview, requestedMode, resizeTerminal, scaleMode, scheduleReconnect, scheduleSessionRenewal, sessionEndpoint, stopDisplayWatch, watchForVncDisplay])

  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    void loadOverview()
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOverview()
    }, 5_000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadOverview()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [loadOverview])

  useEffect(() => {
    void connect()
    return () => {
      connectionIdRef.current += 1
      cleanup()
    }
    // The initial connection must not re-run when reconnect/mode state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    resizeConsole()
  }, [resizeConsole, scaleMode])

  useEffect(() => {
    const onResize = () => {
      refreshFullscreenState()
      resizeConsole()
      window.setTimeout(() => {
        focusConsole()
        resizeConsole()
      }, 80)
    }
    window.addEventListener("resize", onResize)
    document.addEventListener("fullscreenchange", onResize)
    refreshFullscreenState()
    return () => {
      window.removeEventListener("resize", onResize)
      document.removeEventListener("fullscreenchange", onResize)
    }
  }, [focusConsole, refreshFullscreenState, resizeConsole])

  async function fetchCredentials(reveal = false) {
    if (!credentialsEndpoint) return
    const url = reveal ? `${credentialsEndpoint}${credentialsEndpoint.includes("?") ? "&" : "?"}reveal=1` : credentialsEndpoint
    const res = await fetch(url, { cache: "no-store" })
    const data = (await readJsonResponse<ConsoleCredentials>(res).catch(() => null)) || {}
    if (!res.ok || data.success === false) throw new Error(data.error || "Unable to load credentials")
    return data
  }

  async function loadCredentials(reveal = false) {
    if (!credentialsEndpoint) return
    setCredentialsBusy(true)
    try {
      const data = await fetchCredentials(reveal)
      if (data) {
        if (!reveal) data.password = null
        setCredentials(data)
        setPasswordRevealed(Boolean(reveal && data.password))
      }
    } catch (err: any) {
      setCredentials((current) => ({ ...(current || {}), password: null, error: err?.message || "Unable to load credentials" }))
      setPasswordRevealed(false)
    } finally {
      setCredentialsBusy(false)
    }
  }

  useEffect(() => {
    void loadCredentials(false)
    // The footer should refresh when the endpoint changes, not on every local credential state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialsEndpoint])

  async function pasteClipboard() {
    const text = await navigator.clipboard?.readText?.().catch(() => "")
    if (!text) {
      toast.error("Clipboard is empty or unavailable")
      return
    }
    if (mode === "serial" && terminalRef.current) {
      focusConsole()
      terminalRef.current.paste(text)
      setStatus("Clipboard pasted into terminal")
      toast.success("Pasted into terminal")
      return
    }
    if (mode === "vnc" && rfbRef.current) {
      focusConsole()
      if (typeof rfbRef.current.clipboardPasteFrom === "function") rfbRef.current.clipboardPasteFrom(text)
      window.setTimeout(() => sendVncKeyChord(KEYSYM_V, "KeyV"), 80)
      setStatus("Clipboard pasted into VM")
      toast.success("Pasted into VM")
      return
    }
    toast.error("Console is not ready for paste")
  }

  async function copyMarkedText() {
    if (mode === "serial" && terminalRef.current) {
      const text = terminalRef.current.getSelection?.() || ""
      if (!text) {
        toast.error("No terminal text selected")
        return
      }
      await navigator.clipboard.writeText(text)
      setStatus("Terminal selection copied")
      toast.success("Selection copied")
      return
    }
    if (mode === "vnc" && rfbRef.current) {
      const before = remoteClipboardRef.current
      const text = await new Promise<string>((resolve) => {
        const timeout = window.setTimeout(() => {
          pendingClipboardRef.current = null
          resolve(remoteClipboardRef.current || before)
        }, 900)
        pendingClipboardRef.current = (nextText) => {
          window.clearTimeout(timeout)
          resolve(nextText)
        }
        sendVncKeyChord(KEYSYM_C, "KeyC")
      })
      if (!text) {
        toast.error("No VM text copied")
        return
      }
      await navigator.clipboard.writeText(text)
      setStatus("VM clipboard copied")
      toast.success("Selection copied")
      return
    }
    toast.error("Console is not ready for copy")
  }

  async function copyText(value?: string | null) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    toast.success("Copied")
  }

  async function copyPasswordText() {
    if (!credentialsEndpoint) return
    setCredentialsBusy(true)
    try {
      const data = passwordRevealed && credentials?.password ? credentials : await fetchCredentials(true)
      if (!data) {
        toast.error("Password is not available")
        return
      }
      const password = String(data?.password || "")
      if (!password) {
        toast.error("Password is not available")
        return
      }
      await navigator.clipboard.writeText(password)
      toast.success("Password copied")
      if (passwordRevealed) {
        setCredentials(data)
      } else {
        setCredentials((current) => ({
          ...(current || {}),
          ...data,
          password: null,
          passwordAvailable: data?.passwordAvailable ?? Boolean(password),
        }))
      }
    } catch (err: any) {
      toast.error(err?.message || "Unable to copy password")
    } finally {
      setCredentialsBusy(false)
    }
  }

  async function sendCtrlAltDel() {
    if (!ctrlAltDelEndpoint) return
    setStatus("Sending Ctrl+Alt+Del")
    if (mode === "vnc" && typeof rfbRef.current?.sendCtrlAltDel === "function") {
      focusConsole()
      rfbRef.current.sendCtrlAltDel()
      setStatus(displayReady ? "Ctrl+Alt+Del sent" : "Ctrl+Alt+Del sent; waiting for display")
      return
    }
    const response = await fetch(ctrlAltDelEndpoint, { method: "POST" }).catch(() => null)
    const data = response ? await readJsonResponse<any>(response).catch(() => null) : null
    if (!response || !response.ok || data?.success === false) {
      const message = data?.error || data?.message || "Could not send Ctrl+Alt+Del"
      setError(message)
      setStatus("Ctrl+Alt+Del failed")
      return
    }
    setStatus(displayReady ? "Ctrl+Alt+Del sent" : "Ctrl+Alt+Del sent; waiting for display")
  }

  async function toggleFullscreen() {
    const shell = consoleShellRef.current
    if (!shell) return
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen?.().catch(() => null)
    } else {
      await shell.requestFullscreen?.().catch(() => null)
    }
    refreshFullscreenState()
    focusConsole()
    resizeConsole()
    window.setTimeout(resizeConsole, 120)
  }

  function togglePasswordReveal() {
    if (passwordRevealed) {
      setPasswordRevealed(false)
      setCredentials((current) => current ? { ...current, password: null } : current)
      return
    }
    void loadCredentials(true)
  }

  async function captureScreenshot() {
    const canvas = screenRef.current?.querySelector("canvas") as HTMLCanvasElement | null
    if (!canvas) return setStatus("Screenshot unavailable")
    const url = canvas.toDataURL("image/png")
    setScreenshotUrl(url)
    setStatus("Screenshot captured")
    toast.success("Screenshot captured")
  }

  function downloadScreenshot() {
    if (!screenshotUrl) return
    const link = document.createElement("a")
    link.href = screenshotUrl
    link.download = `console-${Date.now()}.png`
    link.click()
    setStatus("Screenshot downloaded")
  }

  function resetConsole() {
    cleanup()
    setMode(null)
    setRequestedMode(overview?.defaultMode || null)
    setStage("connecting_node")
    setError(null)
    setFailureCode(null)
    if (screenRef.current) screenRef.current.innerHTML = ""
    window.setTimeout(() => void connect(overview?.defaultMode || null, { forceRenew: true }), 0)
  }

  async function powerAction(action: "start" | "stop" | "reboot" | "forceStop") {
    if (!powerEndpoint) return
    setShowPowerMenu(false)
    setStatus(`${action} requested`)
    const response = await fetch(powerEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null)
    const data = response ? await readJsonResponse<any>(response).catch(() => null) : null
    if (!response || !response.ok || data?.success === false) {
      setError(data?.error || data?.message || "Power action failed")
      setStatus("Power action failed")
      return
    }
    setStatus(`${action} accepted`)
    window.setTimeout(() => void loadOverview(), 750)
  }

  async function updatePassword(action: "reset" | "update_stored") {
    if (!passwordEndpoint) return
    if (newPassword.length < 12) {
      setCredentials((current) => ({ ...(current || {}), recovery: { status: "validation_failed", message: "Password must be at least 12 characters." } }))
      return
    }
    setCredentialsBusy(true)
    const response = await fetch(passwordEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, password: newPassword, confirmPassword: newPassword }),
    }).catch(() => null)
    const data = response ? await readJsonResponse<ConsoleCredentials>(response).catch(() => null) : null
    setCredentialsBusy(false)
    if (!response || !response.ok || data?.success === false) {
      setCredentials((current) => ({ ...(current || {}), recovery: { status: "failed", message: data?.error || data?.message || "Password action failed." } }))
      return
    }
    setNewPassword("")
    setPasswordRevealed(false)
    await loadCredentials(false)
    setCredentials((current) => ({ ...(current || {}), recovery: data?.recovery || { status: "ok", message: data?.message || "Password action completed." } }))
  }

  const modeButtons = availableModes.length > 1 ? availableModes : []
  const fullscreenTitle = isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2
  const resolvedServerName = overview?.serverName || credentials?.hostname || serverName || "Cloud server"

  return (
    <div className={cn("flex min-h-[calc(100vh-7rem)] min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-3 border-b border-border/50 pb-3">
        <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground" aria-label="Console breadcrumb">
          <Link href="/client-area/vps" className="rounded-sm underline-offset-4 hover:text-foreground hover:underline">Cloud Servers</Link>
          <span aria-hidden="true">/</span>
          {backHref ? <Link href={backHref} className="max-w-[14rem] truncate rounded-sm underline-offset-4 hover:text-foreground hover:underline">{resolvedServerName}</Link> : <span className="max-w-[14rem] truncate">{resolvedServerName}</span>}
          <span aria-hidden="true">/</span>
          <span className="text-foreground">Console</span>
        </nav>
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{labelForMode(mode)} · {status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {backHref ? <Button asChild type="button" variant="outline" size="sm" className={consoleActionButtonClass}><Link href={backHref}><ArrowLeft className="h-4 w-4" />Back to VM</Link></Button> : null}
            {monitoringHref ? <Button asChild type="button" variant="outline" size="sm" className={consoleActionButtonClass}><Link href={monitoringHref}>Back to Monitoring</Link></Button> : null}
          </div>
        </div>
        {modeButtons.length ? (
          <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-md border border-border/60 p-1">
            {modeButtons.map((item) => (
              <Button key={item} type="button" variant={requestedMode === item ? "default" : "ghost"} size="sm" onClick={() => { setRequestedMode(item); void connect(item) }} disabled={busy} className="gap-2">
                {item === "vnc" ? <Monitor className="h-4 w-4" /> : <TerminalIcon className="h-4 w-4" />}
                {item === "vnc" ? "Graphical" : "Serial"}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <AnimatePresence mode="wait">
        {overview ? (
          <motion.section
            key="console-overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-3 xl:grid-cols-[1.1fr_2fr]"
            aria-label="Server console status"
          >
            <div className="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Server</p>
                  <h2 className="mt-1 truncate text-lg font-semibold">{overview.serverName}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{overview.os} · {overview.datacenter || "Datacenter unavailable"}</p>
                </div>
                <StatusPill status={overview.status} freshness={overview.freshness} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                {overview.node ? <SummaryValue label="Node" value={overview.node} /> : null}
                {overview.vmid ? <SummaryValue label="VMID" value={String(overview.vmid)} /> : null}
                <SummaryValue label="IP address" value={overview.ipAddress} />
                <SummaryValue label="Uptime" value={formatDuration(overview.uptimeSeconds)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard icon={Activity} label="CPU" value={`${overview.metrics.cpuPercent.toFixed(1)}%`} percent={overview.metrics.cpuPercent} />
              <MetricCard icon={Server} label="RAM" value={`${overview.metrics.ramPercent.toFixed(1)}%`} percent={overview.metrics.ramPercent} />
              <MetricCard icon={HardDrive} label="Disk" value={`${overview.metrics.diskPercent.toFixed(1)}%`} percent={overview.metrics.diskPercent} />
              <MetricCard icon={Network} label="Network" value={formatBytes(overview.metrics.networkInBytes + overview.metrics.networkOutBytes)} detail="total transferred" />
            </div>
          </motion.section>
        ) : (
          <motion.div key="console-overview-skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl border border-border/50 bg-muted/40" />)}
          </motion.div>
        )}
      </AnimatePresence>
      {overviewError ? <p className="text-xs text-amber-600 dark:text-amber-300">{overviewError}; showing the most recent server data.</p> : null}

      {error ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="font-semibold">{consoleFailureLabel(failureCode || "unknown")}</div>
            <div className="mt-0.5">{error}</div>
            {summarizeDiagnostics(diagnostics) ? <div className="mt-1 break-words font-mono text-xs opacity-80">{summarizeDiagnostics(diagnostics)}</div> : null}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void connect(requestedMode, { forceRenew: true })} disabled={busy} className="shrink-0 gap-2">
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            Retry
          </Button>
        </div>
      ) : null}

      <div
        ref={consoleShellRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-black",
          isFullscreen && "h-[100dvh] w-[100dvw] rounded-none border-0"
        )}
        onClick={focusConsole}
        onPointerDown={focusConsole}
        onKeyDown={(event) => {
          if (isPasteShortcut(event)) {
            event.preventDefault()
            event.stopPropagation()
            void pasteClipboard()
          }
        }}
      >
        <div className={cn(
          "relative h-[clamp(320px,72dvh,760px)] min-h-[320px] w-full overflow-hidden bg-black sm:min-h-[360px] lg:min-h-[520px]",
          isFullscreen && "h-[100dvh] min-h-0"
        )}>
          <div
            ref={screenRef}
            tabIndex={0}
            className="absolute inset-0 h-full min-h-0 w-full overflow-hidden outline-none [&_.rfb-canvas]:outline-none [&_.rfb-desktop]:h-full [&_.rfb-desktop]:w-full"
            onKeyDown={() => setStatus("Keyboard active")}
          />
          <AnimatePresence>
            {!displayReady && !error ? (
              <ConsoleLoader key="console-loader" stage={stage} mode={mode} serverName={resolvedServerName} diagnostics={summarizeDiagnostics(diagnostics)} />
            ) : null}
          </AnimatePresence>

          <div
            className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/90 p-1.5 text-white shadow-2xl backdrop-blur"
          >
            <ToolButton title="Focus keyboard" onClick={focusConsole} icon={Keyboard} />
            <ToolButton title="Copy selected text" onClick={() => void copyMarkedText()} icon={Copy} disabled={!mode} tone="copy" />
            <ToolButton title="Paste clipboard into VM" onClick={() => void pasteClipboard()} icon={ClipboardPaste} disabled={!mode} tone="paste" />
            <ToolButton title="Ctrl+Alt+Del" onClick={() => void sendCtrlAltDel()} icon={Send} disabled={mode !== "vnc" || !ctrlAltDelEndpoint} />
            <ToolButton title={fullscreenTitle} onClick={() => void toggleFullscreen()} icon={FullscreenIcon} />
            <ToolButton title="Scale display" onClick={() => setShowDisplaySettings((value) => !value)} icon={Settings2} />
            <ToolButton title="Reset console" onClick={resetConsole} icon={RotateCcw} />
            <ToolButton title="Reconnect" onClick={() => void connect(requestedMode, { forceRenew: true })} icon={RefreshCw} busy={busy} />
            <ToolButton title="Capture screenshot" onClick={() => void captureScreenshot()} icon={Camera} disabled={mode !== "vnc"} />
            <ToolButton title="Download screenshot" onClick={downloadScreenshot} icon={Download} disabled={!screenshotUrl} />
            {powerEndpoint ? <ToolButton title="Power menu" onClick={() => setShowPowerMenu((value) => !value)} icon={Power} /> : null}
          </div>

          {showDisplaySettings ? (
            <div className="absolute bottom-16 left-1/2 z-20 w-[min(15rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-white/10 bg-zinc-950/95 p-3 text-sm text-white shadow-xl">
              <div className="mb-2 font-medium">Scaling</div>
              <div className="grid gap-1">
                {(["fit", "local", "none"] as ScaleMode[]).map((item) => (
                  <Button key={item} type="button" size="sm" variant={scaleMode === item ? "default" : "ghost"} className="justify-start" onClick={() => setScaleMode(item)}>
                    {item === "fit" ? "Fit viewport" : item === "local" ? "Remote resize" : "No scaling"}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {showPowerMenu ? (
            <div className="absolute bottom-16 right-3 z-20 w-[min(13rem,calc(100%-2rem))] rounded-xl border border-white/10 bg-zinc-950/95 p-2 text-sm text-white shadow-xl">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => void powerAction("start")}><Power className="h-4 w-4" />Start</Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => void powerAction("reboot")}><RotateCw className="h-4 w-4" />Reboot</Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={() => void powerAction("stop")}><PowerOff className="h-4 w-4" />Shutdown</Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start gap-2 text-red-200" onClick={() => void powerAction("forceStop")}><OctagonX className="h-4 w-4" />Force stop</Button>
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-md border border-white/10 bg-black/70 px-2.5 py-1.5 text-xs text-white/80">
            {mode === "serial" ? <TerminalIcon className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
            {mode || "auto"} {displayReady ? "· visible" : ""}
          </div>
        </div>
      </div>

      {credentialsEndpoint ? (
        <div className="min-w-0 rounded-md border border-border/50 bg-background/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Console credentials</div>
              <div className="text-xs text-muted-foreground">{credentials?.recovery?.message || "Password stays masked until you reveal or copy it."}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadCredentials(false)} disabled={credentialsBusy} className={consoleActionButtonClass}><RefreshCw className={cn("h-4 w-4", credentialsBusy && "animate-spin")} />Refresh</Button>
              <Button type="button" variant="outline" size="sm" onClick={togglePasswordReveal} disabled={credentialsBusy} title={passwordRevealed ? "Hide Password" : "Reveal Password"} aria-label={passwordRevealed ? "Hide Password" : "Reveal Password"} className={consoleActionButtonClass}>{passwordRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{passwordRevealed ? "Hide" : "Reveal"}</Button>
            </div>
          </div>
          <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-3">
            <CredentialValue label="IP" value={credentials?.ip} onCopy={copyText} />
            <CredentialValue label="Username" value={credentials?.username} onCopy={copyText} />
            <CredentialValue label="Password" value={passwordRevealed ? credentials?.password : credentials?.passwordAvailable ? "************" : null} copyValue={passwordRevealed ? credentials?.password : null} onCopy={() => void copyPasswordText()} secret revealed={passwordRevealed} alwaysAllowCopy />
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input type="password" placeholder="New password, 12+ characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="sm:max-w-sm" />
            <Button type="button" variant="outline" onClick={() => void updatePassword("reset")} disabled={credentialsBusy || !newPassword} className={consoleActionButtonClass}>Reset Password</Button>
            <Button type="button" variant="outline" onClick={() => void updatePassword("update_stored")} disabled={credentialsBusy || !newPassword} className={consoleActionButtonClass}>Update Stored</Button>
          </div>
          {credentials?.recovery?.guidance?.length ? (
            <div className="mt-3 rounded-md border border-border/50 p-3 text-xs text-muted-foreground">
              {credentials.recovery.guidance.join(" ")}
            </div>
          ) : null}
          {credentials?.error ? <div className="mt-2 text-sm text-destructive">{credentials.error}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function ConsoleLoader({
  stage,
  mode,
  serverName,
  diagnostics,
}: {
  stage: ConsoleConnectionStage
  mode: ConsoleMode | null
  serverName: string
  diagnostics?: string
}) {
  const activeIndex = CONSOLE_STAGE_ORDER.indexOf(stage)
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.14),transparent_48%),#030706] px-4 text-white"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.045] p-5 shadow-2xl backdrop-blur sm:p-7">
        <div className="flex items-center gap-4">
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200 shadow-[0_0_35px_rgba(52,211,153,0.16)]"
          >
            {mode === "serial" ? <TerminalIcon className="h-6 w-6" /> : <Monitor className="h-6 w-6" />}
          </motion.div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{serverName}</p>
            <p className="mt-0.5 text-sm text-white/60">Secure console session</p>
          </div>
        </div>
        <div className="mt-6 space-y-3">
          {CONSOLE_STAGE_ORDER.map((item, index) => {
            const complete = index < activeIndex || stage === "ready"
            const active = index === activeIndex && stage !== "ready"
            return (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: complete || active ? 1 : 0.45, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-3"
              >
                <span className={cn(
                  "relative flex h-2.5 w-2.5 shrink-0 rounded-full",
                  complete ? "bg-emerald-400" : active ? "bg-sky-400" : "bg-white/20"
                )}>
                  {active ? <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/70" /> : null}
                </span>
                <span className={cn("text-sm", complete || active ? "text-white" : "text-white/45")}>{CONSOLE_STAGE_COPY[item]}</span>
                {complete ? <span className="ml-auto text-xs text-emerald-300">Complete</span> : null}
                {active ? <span className="ml-auto text-xs text-sky-300">In progress</span> : null}
              </motion.div>
            )
          })}
        </div>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-sky-400 to-emerald-300 shadow-[0_0_18px_rgba(56,189,248,0.7)]"
            animate={{ width: `${Math.max(12, ((activeIndex + 1) / CONSOLE_STAGE_ORDER.length) * 100)}%` }}
          />
        </div>
        {diagnostics ? <p className="mt-4 break-words font-mono text-[11px] text-white/40">{diagnostics}</p> : null}
      </div>
    </motion.div>
  )
}

function StatusPill({ status, freshness }: { status: string; freshness: ConsoleOverview["freshness"] }) {
  const running = status === "running" || status === "active"
  const starting = status.includes("start") || status.includes("provision")
  const label = running ? "Running" : starting ? "Starting" : status === "stopped" || status === "offline" ? "Stopped" : status || "Unknown"
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
      running ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : starting ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300"
    )}>
      <span className={cn("h-2 w-2 rounded-full", running ? "animate-pulse bg-emerald-500" : starting ? "animate-pulse bg-amber-500" : "bg-zinc-500")} />
      {label} · {freshness}
    </span>
  )
}

function SummaryValue({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm">{value || "-"}</p>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, percent, detail }: { icon: any; label: string; value: string; percent?: number; detail?: string }) {
  return (
    <motion.div whileHover={{ y: -2 }} className="rounded-xl border border-border/60 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-emerald-500" />
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      {typeof percent === "number" ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, percent))}%` }} className="h-full rounded-full bg-emerald-500" />
        </div>
      ) : <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>}
    </motion.div>
  )
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)))
  if (!total) return "-"
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function ToolButton({
  title,
  label,
  icon: Icon,
  onClick,
  disabled,
  busy,
  tone,
}: {
  title: string
  label?: string
  icon: any
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  tone?: "copy" | "paste"
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={label ? "sm" : "icon"}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-9 shrink-0 text-white hover:bg-white/10 hover:text-white",
        label ? "w-[4.75rem] justify-start gap-1.5 px-2 text-xs" : "w-9",
        tone === "copy" && "border border-sky-300/25 bg-sky-500/10 text-sky-50 hover:bg-sky-500/20",
        tone === "paste" && "border border-emerald-300/25 bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/25"
      )}
    >
      <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      {label ? <span className="truncate">{label}</span> : null}
    </Button>
  )
}

function CredentialValue({
  label,
  value,
  copyValue,
  onCopy,
  secret,
  revealed,
  alwaysAllowCopy,
}: {
  label: string
  value?: string | null
  copyValue?: string | null
  onCopy: (value?: string | null) => void
  secret?: boolean
  revealed?: boolean
  alwaysAllowCopy?: boolean
}) {
  return (
    <div className="min-w-0 rounded-md border border-border/40 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 flex min-h-8 items-center justify-between gap-2">
        {secret ? (
          <Input readOnly type={revealed ? "text" : "password"} value={value || ""} placeholder="-" className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0" />
        ) : (
          <span className="min-w-0 break-all font-mono text-sm">{value || "-"}</span>
        )}
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void onCopy(copyValue ?? value)} disabled={!alwaysAllowCopy && !(copyValue ?? value)} title={`Copy ${label}`} aria-label={`Copy ${label}`} className="h-8 w-8 rounded-md">
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
