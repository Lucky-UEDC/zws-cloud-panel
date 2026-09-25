import "dotenv/config"
import http from "node:http"
import { prisma } from "@/lib/db"
import { buildProxmoxAuthorizationHeader, createProxmoxClient } from "@/lib/proxmox"
import { buildProxmoxConsoleWebSocketUrl } from "@/lib/proxmox-vnc"
import { getVncEnvDebug } from "@/lib/vnc-diagnostics"
import { getRedisClient } from "@/lib/redis"
import { RfbStageTracker } from "@/lib/rfb-stage-tracker"
import { classifyRfbClientFrame } from "@/lib/rfb-client-messages"
import WebSocket, { WebSocketServer, type RawData } from "ws"

type ConsoleProxyMode = "vnc" | "serial"

type ConsoleSession = {
  actorType?: "client" | "admin"
  adminEmail?: string
  customerId: string
  vpsId: string
  proxmoxNodeId: string
  nodeName: string
  vmid: number
  targetKind?: "qemu" | "lxc"
  mode?: ConsoleProxyMode
  vncTicket?: string
  vncPort?: number | string
  termTicket?: string
  termPort?: number | string
  termUser?: string
  serial?: string
  createdAt: string
}

const port = Number(process.env.VNC_PROXY_PORT || 3001)
const host = process.env.VNC_PROXY_HOST || "127.0.0.1"

function log(level: "info" | "warn" | "error", message: string, meta: Record<string, unknown> = {}) {
  const safeMeta = Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined))
  console[level](`[console] ${message}`, safeMeta)
}

function errorAt(layer: string, error: any, meta: Record<string, unknown> = {}) {
  log("error", "error", { layer, message: error?.message || String(error || "Unknown error"), ...meta })
}

function closeReason(reason: Buffer) {
  const message = reason.toString()
  if (/PVE|ticket|cookie|password/i.test(message)) return "<redacted>"
  return message
}

function rawLength(data: RawData) {
  if (Array.isArray(data)) return data.reduce((total, chunk) => total + chunk.length, 0)
  return Buffer.byteLength(data as any)
}

function rawBuffer(data: RawData) {
  if (Array.isArray(data)) return Buffer.concat(data.map((chunk) => Buffer.from(chunk as any)))
  return Buffer.from(data as any)
}

export function consoleUserFromToken(tokenId: string) {
  return String(tokenId || "").trim() || "root@pam"
}

export function frameXtermInput(data: RawData) {
  const input = Array.isArray(data)
    ? Buffer.concat(data.map((chunk) => Buffer.from(chunk as any))).toString("utf8")
    : typeof data === "string"
      ? data
      : Buffer.from(data as any).toString("utf8")
  return `0:${Buffer.byteLength(input, "utf8")}:${input}`
}

export function frameXtermResize(cols: number, rows: number) {
  return `1:${Math.max(20, Math.min(300, Math.floor(cols)))}:${Math.max(5, Math.min(120, Math.floor(rows)))}:`
}

function parseResizeControl(data: RawData, isBinary: boolean) {
  if (!isBinary) return null
  const buffer = rawBuffer(data)
  if (buffer[0] !== 0) return null
  const match = buffer.subarray(1).toString("utf8").match(/^ZWS_RESIZE:(\d+):(\d+)$/)
  if (!match) return null
  return { cols: Number(match[1]), rows: Number(match[2]) }
}

function closeCode(code: number) {
  if (code >= 3000 && code <= 4999) return code
  if (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) return code
  return 1011
}

async function getRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis is not configured")
  await redis.connect().catch(() => undefined)
  if (redis.status !== "ready") throw new Error("Redis is unavailable")
  return redis
}

async function loadSession(mode: ConsoleProxyMode, token: string, legacy = false): Promise<ConsoleSession | null> {
  const redis = await getRedis()
  const key = legacy ? `vnc:${token}` : `console:${mode}:${token}`
  const raw = await redis.get(key)

  if (!raw || typeof raw !== "string") return null
  try {
    return JSON.parse(raw) as ConsoleSession
  } catch {
    return null
  }
}

function sessionTokenFromUrl(rawUrl?: string) {
  if (!rawUrl) return null
  const url = new URL(rawUrl, "http://127.0.0.1")
  const consoleMatch = url.pathname.match(/^\/console\/proxy\/(vnc|serial)\/([^/]+)$/)
  if (consoleMatch) {
    return { mode: consoleMatch[1] as ConsoleProxyMode, token: decodeURIComponent(consoleMatch[2]), legacy: false }
  }
  const legacyMatch = url.pathname.match(/^\/vnc\/proxy\/([^/]+)$/)
  if (legacyMatch) {
    return { mode: "vnc" as ConsoleProxyMode, token: decodeURIComponent(legacyMatch[1]), legacy: true }
  }
  return null
}

function closeQuietly(socket: WebSocket | null | undefined, code = 1000, reason = "closed") {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return
  try {
    socket.close(closeCode(code), reason)
  } catch {
    try {
      socket.terminate()
    } catch {
      // Ignore best-effort close failures.
    }
  }
}

function forwardMessage(target: WebSocket | null, data: RawData, isBinary: boolean) {
  if (!target) return
  if (target.readyState !== WebSocket.OPEN) return
  target.send(data as any, { binary: isBinary })
}

async function connectConsole(clientSocket: WebSocket, mode: ConsoleProxyMode, token: string, legacy = false) {
  const tokenTag = token.slice(0, 8)
  let upstream: WebSocket | null = null
  let proxmoxFrameCount = 0
  let clientFrameCount = 0
  let clientKeyFrameCount = 0
  let clientPointerFrameCount = 0
  let clientFramebufferRequestCount = 0
  let clientResizeFrameCount = 0
  let serialInputFrameCount = 0
  let serialResizeFrameCount = 0
  let serialOutputFrameCount = 0
  let firstCloseSide: "browser" | "proxmox" | null = null
  let serialAuthenticated = mode !== "serial"
  let pendingSerialInput: string[] = []
  let serialPing: NodeJS.Timeout | null = null
  let vncFramebufferTimer: NodeJS.Timeout | null = null
  let proxyHeartbeat: NodeJS.Timeout | null = null
  const rfbTracker = mode === "vnc" ? new RfbStageTracker() : null

  log("info", "browser_connected", { token: tokenTag, mode, protocol: clientSocket.protocol || "" })

  try {
    const session = await loadSession(mode, token, legacy)
    if (!session) {
      closeQuietly(clientSocket, 4401, "Console session expired")
      log("warn", "error", { layer: "session_loaded", token: tokenTag, mode, message: "Console session expired" })
      return
    }
    log("info", "session_loaded", { token: tokenTag, mode, vmid: session.vmid, node: session.nodeName, retained: true })

    const upstreamTicket = mode === "serial" ? session.termTicket : session.vncTicket
    const upstreamPort = mode === "serial" ? session.termPort : session.vncPort
    if (!upstreamTicket || !upstreamPort) {
      closeQuietly(clientSocket, 1011, "Console session is incomplete")
      log("warn", "error", { layer: "session_loaded", token: tokenTag, mode, vmid: session.vmid, node: session.nodeName, message: "Console session is incomplete" })
      return
    }

    const adminActor = session.actorType === "admin"
    const vps = await prisma.vpsInstance.findFirst({
      where: {
        id: session.vpsId,
        ...(adminActor ? {} : { customerId: session.customerId }),
        deletedAt: null,
        status: { notIn: ["DELETED", "SUSPENDED"] },
        order: { deletedAt: null, status: { not: "DELETED" } },
      },
      include: { proxmoxNode: true, order: { select: { status: true, deletedAt: true } } },
    })

    if (!vps?.proxmoxNode || !vps.vmid || vps.proxmoxNodeId !== session.proxmoxNodeId) {
      closeQuietly(clientSocket, 4404, "VPS unavailable")
      log("warn", "error", { layer: "load_vps", token: tokenTag, mode, vpsId: session.vpsId, message: "VPS unavailable" })
      return
    }

    const overdueRenewal = adminActor ? null : await prisma.invoice.findFirst({
      where: {
        customerId: session.customerId,
        OR: [
          { status: "overdue" },
          { status: "pending", dueDate: { lt: new Date() } },
        ],
        metadata: { path: ["vpsInstanceId"], equals: vps.id },
      },
      select: { id: true },
    }).catch(() => null)

    if (overdueRenewal) {
      closeQuietly(clientSocket, 4402, "Renewal required")
      log("warn", "error", { layer: "billing", token: tokenTag, mode, vpsId: vps.id, vmid: vps.vmid, message: "Renewal required" })
      return
    }

    const nodeConfig = vps.proxmoxNode
    const targetKind = session.targetKind || "qemu"
    const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
      allowInsecureTls: nodeConfig.allowInsecureTls,
    })
    const runtime = targetKind === "lxc"
      ? await proxmox.getLxcStatus(nodeConfig.nodeName, vps.vmid).catch(() => null)
      : await proxmox.getVMStatus(nodeConfig.nodeName, vps.vmid).catch(() => null)
    log("info", "vm_status", { token: tokenTag, mode, targetKind, vmid: vps.vmid, node: nodeConfig.nodeName, status: runtime?.status || "unknown" })
    if (mode === "serial" && String(runtime?.status || "").toLowerCase() !== "running") {
      closeQuietly(clientSocket, 4409, "VM is not running")
      log("warn", "error", { layer: "vm_status", token: tokenTag, mode, targetKind, vpsId: vps.id, vmid: vps.vmid, node: nodeConfig.nodeName, message: "VM is not running" })
      return
    }

    log("info", "upstream session ok", { token: tokenTag, mode, targetKind, port: upstreamPort, vmid: vps.vmid, node: nodeConfig.nodeName })

    const upstreamUrl = buildProxmoxConsoleWebSocketUrl({
      host: nodeConfig.host,
      node: nodeConfig.nodeName,
      vmid: vps.vmid,
      targetKind,
      port: Number(upstreamPort),
      vncTicket: upstreamTicket,
    })

    log("info", "connecting websocket", { token: tokenTag, mode, targetKind, vmid: vps.vmid, node: nodeConfig.nodeName })
    upstream = new WebSocket(upstreamUrl, {
      headers: {
        Authorization: buildProxmoxAuthorizationHeader(nodeConfig.tokenId, nodeConfig.tokenSecret),
      },
      rejectUnauthorized: !nodeConfig.allowInsecureTls,
    })

    upstream.on("open", () => {
      log("info", "websocket open", { token: tokenTag, mode, vpsId: vps.id, vmid: vps.vmid, node: nodeConfig.nodeName })
      proxyHeartbeat = setInterval(() => {
        try {
          if (clientSocket.readyState === WebSocket.OPEN) clientSocket.ping()
        } catch {}
        try {
          if (upstream?.readyState === WebSocket.OPEN) upstream.ping()
        } catch {}
      }, Number(process.env.CONSOLE_PROXY_HEARTBEAT_MS || 15000))
      if (mode === "serial") {
        const termUser = session.termUser || consoleUserFromToken(nodeConfig.tokenId)
        upstream?.send(`${termUser}:${upstreamTicket}\n`)
        serialPing = setInterval(() => {
          if (upstream?.readyState === WebSocket.OPEN && serialAuthenticated) upstream.send("2")
        }, 30000)
      } else {
        vncFramebufferTimer = setTimeout(() => {
          const snapshot = rfbTracker?.snapshot()
          log("warn", "error", {
            layer: "vnc_framebuffer_timeout",
            token: tokenTag,
            mode,
            vmid: vps.vmid,
            node: nodeConfig.nodeName,
            stage: snapshot?.stage,
            width: snapshot?.width,
            height: snapshot?.height,
            firstFramebuffer: snapshot?.firstFramebuffer,
            firstNonEmptyFramebuffer: snapshot?.firstNonEmptyFramebuffer,
            message: "Timed out waiting for visible framebuffer",
          })
          vncFramebufferTimer = null
        }, Number(process.env.VNC_FRAMEBUFFER_TIMEOUT_MS || 25000))
      }
    })
    upstream.on("message", (data, isBinary) => {
      proxmoxFrameCount += 1
      if (proxmoxFrameCount <= 5) {
        log("info", "proxmox_frame", { token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName, index: proxmoxFrameCount, length: rawLength(data), isBinary })
      }
      if (mode === "vnc" && rfbTracker) {
        for (const event of rfbTracker.push(rawBuffer(data))) {
          log("info", "rfb_stage", { token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName, ...event })
          if (event.stage === "first_non_empty_framebuffer" && vncFramebufferTimer) {
            clearTimeout(vncFramebufferTimer)
            vncFramebufferTimer = null
          }
        }
      }
      if (mode === "serial" && !serialAuthenticated) {
        const frame = rawBuffer(data)
        if (frame[0] !== 79 || frame[1] !== 75) {
          log("warn", "error", { layer: "termproxy_auth", token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName, message: "Terminal authentication failed" })
          closeQuietly(clientSocket, 1011, "Terminal authentication failed")
          closeQuietly(upstream, 1011, "Terminal authentication failed")
          return
        }
        serialAuthenticated = true
        log("info", "terminal_authenticated", { token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName })
        const initialOutput = frame.subarray(2)
        if (initialOutput.length) forwardMessage(clientSocket, initialOutput, true)
        for (const pending of pendingSerialInput) {
          if (upstream?.readyState === WebSocket.OPEN) upstream.send(pending)
        }
        pendingSerialInput = []
        return
      }
      if (mode === "serial") {
        serialOutputFrameCount += 1
        if (serialOutputFrameCount <= 5 || serialOutputFrameCount % 25 === 0) {
          log("info", "serial_output_forwarded", {
            token: tokenTag,
            mode,
            vmid: vps.vmid,
            node: nodeConfig.nodeName,
            count: serialOutputFrameCount,
            bytes: rawLength(data),
          })
        }
      }
      forwardMessage(clientSocket, data, isBinary)
    })
    upstream.on("unexpected-response", (_request, response) => {
      log("warn", "error", { layer: "proxmox_websocket_connect", token: tokenTag, mode, statusCode: response.statusCode, vmid: vps.vmid, node: nodeConfig.nodeName, message: "Upstream rejected websocket" })
      closeQuietly(clientSocket, 1011, "Console upstream rejected connection")
    })
    upstream.on("close", (code, reason) => {
      if (serialPing) clearInterval(serialPing)
      if (vncFramebufferTimer) clearTimeout(vncFramebufferTimer)
      if (proxyHeartbeat) clearInterval(proxyHeartbeat)
      const safeReason = closeReason(reason)
      if (!firstCloseSide) firstCloseSide = "proxmox"
      log("info", "close proxmox", { token: tokenTag, mode, code, reason: safeReason, firstCloseSide, vmid: vps.vmid, node: nodeConfig.nodeName })
      closeQuietly(clientSocket, code || 1000, safeReason || "Console upstream closed")
    })
    upstream.on("error", (error: any) => {
      if (serialPing) clearInterval(serialPing)
      if (vncFramebufferTimer) clearTimeout(vncFramebufferTimer)
      if (proxyHeartbeat) clearInterval(proxyHeartbeat)
      errorAt("proxmox_websocket_connect", error, { token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName })
      closeQuietly(clientSocket, 1011, "Console upstream error")
    })

    clientSocket.on("message", (data, isBinary) => {
      clientFrameCount += 1
      if (clientFrameCount <= 5) {
          log("info", "client_frame", { token: tokenTag, mode, vmid: vps.vmid, node: nodeConfig.nodeName, index: clientFrameCount, length: rawLength(data), isBinary })
      }
      if (mode === "serial") {
        const resize = parseResizeControl(data, isBinary)
        if (resize) {
          serialResizeFrameCount += 1
          log("info", "serial_resize_forwarded", {
            token: tokenTag,
            mode,
            vmid: vps.vmid,
            node: nodeConfig.nodeName,
            count: serialResizeFrameCount,
            cols: resize.cols,
            rows: resize.rows,
            authenticated: serialAuthenticated,
          })
          if (upstream?.readyState === WebSocket.OPEN && serialAuthenticated) upstream.send(frameXtermResize(resize.cols, resize.rows))
          return
        }
        const framed = frameXtermInput(data)
        serialInputFrameCount += 1
        if (serialInputFrameCount <= 10 || serialInputFrameCount % 25 === 0) {
          log("info", "serial_input_forwarded", {
            token: tokenTag,
            mode,
            vmid: vps.vmid,
            node: nodeConfig.nodeName,
            count: serialInputFrameCount,
            bytes: rawLength(data),
            authenticated: serialAuthenticated,
          })
        }
        if (!serialAuthenticated) {
          if (pendingSerialInput.length < 128) pendingSerialInput.push(framed)
          return
        }
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(framed)
        return
      }
      const classification = classifyRfbClientFrame(rawBuffer(data))
      if (classification.kind === "key_event") clientKeyFrameCount += 1
      if (classification.kind === "pointer_event") clientPointerFrameCount += 1
      if (classification.kind === "framebuffer_request") clientFramebufferRequestCount += 1
      if (classification.kind === "set_desktop_size") clientResizeFrameCount += 1
      if (
        clientFrameCount <= 20 ||
        classification.kind === "set_desktop_size" ||
        (classification.kind === "key_event" && clientKeyFrameCount <= 20) ||
        (classification.kind === "pointer_event" && clientPointerFrameCount <= 20)
      ) {
        log("info", "vnc_client_input", {
          token: tokenTag,
          mode,
          vmid: vps.vmid,
          node: nodeConfig.nodeName,
          kind: classification.kind,
          length: classification.length,
          keyFrames: clientKeyFrameCount,
          pointerFrames: clientPointerFrameCount,
          framebufferRequests: clientFramebufferRequestCount,
          resizeFrames: clientResizeFrameCount,
          keyDown: classification.keyDown,
          buttonMask: classification.buttonMask,
          width: classification.width,
          height: classification.height,
        })
      }
      forwardMessage(upstream, data, isBinary)
    })
    clientSocket.on("close", (code, reason) => {
      if (serialPing) clearInterval(serialPing)
      if (vncFramebufferTimer) clearTimeout(vncFramebufferTimer)
      if (proxyHeartbeat) clearInterval(proxyHeartbeat)
      const safeReason = closeReason(reason)
      if (!firstCloseSide) firstCloseSide = "browser"
      log("info", "close client", { token: tokenTag, mode, code, reason: safeReason, firstCloseSide, vmid: vps.vmid, node: nodeConfig.nodeName })
      closeQuietly(upstream, code || 1000, safeReason || "Client closed")
    })
    clientSocket.on("error", (error: any) => {
      if (serialPing) clearInterval(serialPing)
      if (vncFramebufferTimer) clearTimeout(vncFramebufferTimer)
      if (proxyHeartbeat) clearInterval(proxyHeartbeat)
      log("warn", "error", { layer: "browser_ws", token: tokenTag, mode, message: error?.message, vmid: vps.vmid, node: nodeConfig.nodeName })
      closeQuietly(upstream, 1011, "Client socket error")
    })
  } catch (error: any) {
    if (serialPing) clearInterval(serialPing)
    if (vncFramebufferTimer) clearTimeout(vncFramebufferTimer)
    if (proxyHeartbeat) clearInterval(proxyHeartbeat)
    errorAt("session", error, { token: tokenTag })
    closeQuietly(upstream, 1011, "Console session failed")
    closeQuietly(clientSocket, 1011, "Console session failed")
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "Not found" }))
})

const wss = new WebSocketServer({ noServer: true })

server.on("upgrade", (req, socket, head) => {
  const sessionRef = sessionTokenFromUrl(req.url)
  if (!sessionRef) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    void connectConsole(ws, sessionRef.mode, sessionRef.token, sessionRef.legacy)
  })
})

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    log("error", "listen_failed", {
      host,
      port,
      code: error.code,
      message: `VNC proxy port ${host}:${port} is already in use`,
    })
    process.exit(98)
  }
  errorAt("listen", error, { host, port, code: error.code })
  process.exit(1)
})

server.listen(port, host, () => {
  log("info", "env ok", getVncEnvDebug())
  log("info", "listening", { host, port })
})

async function shutdown() {
  log("info", "shutting down")
  wss.clients.forEach((client) => closeQuietly(client, 1001, "Server shutting down"))
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await prisma.$disconnect?.().catch(() => undefined)
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)))
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)))
