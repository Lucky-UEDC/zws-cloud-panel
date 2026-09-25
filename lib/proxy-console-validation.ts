import crypto from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"
import { buildProxmoxAuthorizationHeader, createProxmoxClient } from "@/lib/proxmox"
import {
  buildProxmoxConsoleWebSocketUrl,
  createProxmoxTermProxy,
  createProxmoxVncProxy,
  sendProxmoxCtrlAltDel,
} from "@/lib/proxmox-vnc"
import { getRedisClient } from "@/lib/redis"
import WebSocket from "ws"

type ProxmoxNodeForConsole = {
  id: string
  host: string
  nodeName: string
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
}

type VpsForConsole = {
  id: string
  customerId: string
  vmid: number
  proxmoxNodeId: string | null
}

export type VncPanelValidationResult = {
  success: boolean
  opened: boolean
  authenticated: boolean
  width?: number
  height?: number
  firstFrameVisible: boolean
  firstNonZeroSampleBytes?: number
  mouseChangedFrame: boolean
  keyboardChangedFrame: boolean
  inputChangedFrame: boolean
  ctrlAltDelSent: boolean
  resizeRequestSent: boolean
  comparedDirect?: VncPanelValidationResult
  message?: string
}

export type SerialPanelValidationResult = {
  success: boolean
  opened: boolean
  authenticated: boolean
  outputReceived: boolean
  echoReturned: boolean
  unameReturned: boolean
  transcript: string
  message?: string
}

function redactConsoleSecret(input: unknown) {
  return String(input || "Unknown error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/PVEAuthCookie=[^;\s"'<>]+/gi, "PVEAuthCookie=[redacted]")
    .replace(/PVEVNC:[^&\s"'<>]+/gi, "PVEVNC:[redacted]")
    .replace(/ticket["':=\s]+[^"',\s}]+/gi, "ticket=[redacted]")
    .replace(/\btoken(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
    .replace(/password["':=\s]+[^"',\s}]+/gi, "password=[redacted]")
}

function wsBuffer(data: WebSocket.RawData) {
  if (Array.isArray(data)) return Buffer.concat(data.map((item) => Buffer.from(item as any)))
  return Buffer.from(data as any)
}

async function readyRedis() {
  const redis = getRedisClient()
  if (!redis) throw new Error("Redis is not configured")
  await redis.connect().catch(() => undefined)
  if (redis.status !== "ready") throw new Error("Redis is unavailable")
  return redis
}

function proxyBaseUrl() {
  const host = process.env.VNC_PROXY_HOST || "127.0.0.1"
  const port = Number(process.env.VNC_PROXY_PORT || 3001)
  return `ws://${host}:${port}`
}

function consoleUserFromToken(tokenId: string) {
  const owner = String(tokenId || "").split("!")[0]?.trim()
  return owner || "root@pam"
}

function pickSerial(config: Record<string, any> | null | undefined): "serial0" | "serial1" | "serial2" | "serial3" {
  for (const key of ["serial0", "serial1", "serial2", "serial3"] as const) {
    if (typeof config?.[key] === "string" && config[key].trim()) return key
  }
  return "serial0"
}

async function vncDesResponse(password: string, challenge: Buffer) {
  const desPath = pathToFileURL(path.join(process.cwd(), "node_modules/@novnc/novnc/core/crypto/des.js")).href
  const mod = await import(desPath)
  const key = password.split("").map((char) => char.charCodeAt(0))
  const cipher = (mod.DESECBCipher as any).importKey(key, { name: "DES-ECB" }, false, ["encrypt"])
  return Buffer.from(cipher.encrypt({ name: "DES-ECB" }, challenge))
}

function rfbPointerEvent(x: number, y: number, buttonMask = 0) {
  const event = Buffer.alloc(6)
  event[0] = 5
  event[1] = buttonMask
  event.writeUInt16BE(Math.max(0, Math.min(65535, x)), 2)
  event.writeUInt16BE(Math.max(0, Math.min(65535, y)), 4)
  return event
}

function rfbKeyEvent(keysym: number, down: boolean) {
  const event = Buffer.alloc(8)
  event[0] = 4
  event[1] = down ? 1 : 0
  event.writeUInt32BE(keysym, 4)
  return event
}

function sendRfbCtrlAltDelete(send: (bytes: Buffer) => void) {
  send(rfbKeyEvent(0xffe3, true))
  send(rfbKeyEvent(0xffe9, true))
  send(rfbKeyEvent(0xffff, true))
  send(rfbKeyEvent(0xffff, false))
  send(rfbKeyEvent(0xffe9, false))
  send(rfbKeyEvent(0xffe3, false))
}

function sendRfbTextProbe(send: (bytes: Buffer) => void) {
  for (const keysym of [0x54, 0x45, 0x53, 0x54, 0x31, 0x32, 0x33, 0xff08, 0xff09, 0xff0d]) {
    send(rfbKeyEvent(keysym, true))
    send(rfbKeyEvent(keysym, false))
  }
}

function rfbSetDesktopSize(width: number, height: number) {
  const request = Buffer.alloc(20)
  request[0] = 251
  request.writeUInt16BE(Math.max(1, Math.min(8192, Math.floor(width))), 2)
  request.writeUInt16BE(Math.max(1, Math.min(8192, Math.floor(height))), 4)
  request[6] = 1
  request.writeUInt16BE(Math.max(1, Math.min(8192, Math.floor(width))), 14)
  request.writeUInt16BE(Math.max(1, Math.min(8192, Math.floor(height))), 16)
  return request
}

function framebufferRequest(width: number, height: number, incremental: boolean) {
  const request = Buffer.alloc(10)
  request[0] = 3
  request[1] = incremental ? 1 : 0
  request.writeUInt16BE(0, 2)
  request.writeUInt16BE(0, 4)
  request.writeUInt16BE(width, 6)
  request.writeUInt16BE(height, 8)
  return request
}

function setEncodingsRaw() {
  const enc = Buffer.alloc(8)
  enc[0] = 2
  enc.writeUInt16BE(1, 2)
  enc.writeInt32BE(0, 4)
  return enc
}

function sampleFrame(frame: Buffer) {
  const step = Math.max(1, Math.floor(frame.length / 65536))
  let nonZero = 0
  let hash = 2166136261
  for (let index = 0; index < frame.length; index += step) {
    const value = frame[index]
    if (value !== 0) nonZero += 1
    hash ^= value
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return { nonZero, hash }
}

async function createVncProxySession(node: ProxmoxNodeForConsole, vps: VpsForConsole) {
  const redis = await readyRedis()
  const ticket = await createProxmoxVncProxy({
    host: node.host,
    node: node.nodeName,
    vmid: vps.vmid,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    allowInsecureTls: node.allowInsecureTls,
  })
  const token = crypto.randomBytes(32).toString("base64url")
  await redis.set(`console:vnc:${token}`, JSON.stringify({
    actorType: "admin",
    customerId: vps.customerId,
    vpsId: vps.id,
    proxmoxNodeId: node.id,
    nodeName: node.nodeName,
    vmid: vps.vmid,
    mode: "vnc",
    vncTicket: ticket.ticket,
    vncPort: ticket.port,
    createdAt: new Date().toISOString(),
  }), "EX", 60)
  return { token, ticket: ticket.ticket, url: `${proxyBaseUrl()}/console/proxy/vnc/${encodeURIComponent(token)}` }
}

async function createSerialProxySession(node: ProxmoxNodeForConsole, vps: VpsForConsole, serial: "serial0" | "serial1" | "serial2" | "serial3") {
  const redis = await readyRedis()
  const ticket = await createProxmoxTermProxy({
    host: node.host,
    node: node.nodeName,
    vmid: vps.vmid,
    tokenId: node.tokenId,
    tokenSecret: node.tokenSecret,
    serial,
    allowInsecureTls: node.allowInsecureTls,
  })
  const token = crypto.randomBytes(32).toString("base64url")
  await redis.set(`console:serial:${token}`, JSON.stringify({
    actorType: "admin",
    customerId: vps.customerId,
    vpsId: vps.id,
    proxmoxNodeId: node.id,
    nodeName: node.nodeName,
    vmid: vps.vmid,
    mode: "serial",
    termTicket: ticket.ticket,
    termPort: ticket.port,
    termUser: ticket.user || consoleUserFromToken(node.tokenId),
    serial,
    createdAt: new Date().toISOString(),
  }), "EX", 60)
  return { token, url: `${proxyBaseUrl()}/console/proxy/serial/${encodeURIComponent(token)}` }
}

export function vncPanelProbe(args: {
  url: string
  password: string
  timeoutMs: number
  sendCtrlAltDel?: () => Promise<unknown>
  headers?: Record<string, string>
  rejectUnauthorized?: boolean
}): Promise<VncPanelValidationResult> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0)
    let state: "protocol" | "security_types" | "challenge" | "security_result" | "server_init" | "framebuffer" = "protocol"
    let opened = false
    let authenticated = false
    let width = 0
    let height = 0
    let bpp = 4
    let firstHash: number | null = null
    let lastHash = 0
    let lastNonZero = 0
    let firstNonZeroSampleBytes = 0
    let firstFrameVisible = false
    let mouseProbeStarted = false
    let mouseChangedFrame = false
    let keyboardProbeStarted = false
    let keyboardChangedFrame = false
    let inputChangedFrame = false
    let ctrlAltDelSent = false
    let resizeRequestSent = false
    let ctrlAltDelBackendError = ""
    let blackFrameCount = 0
    let postInputRequestTimer: ReturnType<typeof setInterval> | null = null
    let settled = false
    const ws = new WebSocket(args.url, { headers: args.headers, rejectUnauthorized: args.rejectUnauthorized })
    const finish = (success: boolean, message?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (postInputRequestTimer) clearInterval(postInputRequestTimer)
      try {
        ws.close()
      } catch {}
      resolve({
        success,
        opened,
        authenticated,
        width,
        height,
        firstFrameVisible,
        firstNonZeroSampleBytes,
        mouseChangedFrame,
        keyboardChangedFrame,
        inputChangedFrame,
        ctrlAltDelSent,
        resizeRequestSent,
        message,
      })
    }
    const timeout = setTimeout(() => finish(false, "Timed out waiting for VNC framebuffer through MyRDPHub proxy"), args.timeoutMs)
    const send = (bytes: Buffer) => ws.send(bytes, { binary: true })

    const pump = async () => {
      try {
        while (!settled) {
          if (state === "protocol") {
            if (buffer.length < 12) return
            const version = buffer.subarray(0, 12)
            buffer = buffer.subarray(12)
            if (!version.toString("ascii").startsWith("RFB")) return finish(false, "RFB protocol header missing")
            send(version)
            state = "security_types"
          } else if (state === "security_types") {
            if (buffer.length < 1) return
            const count = buffer[0]
            if (buffer.length < 1 + count) return
            const types = Array.from(buffer.subarray(1, 1 + count))
            buffer = buffer.subarray(1 + count)
            if (!types.includes(2)) return finish(false, `VNC auth security type missing (${types.join(",") || "none"})`)
            send(Buffer.from([2]))
            state = "challenge"
          } else if (state === "challenge") {
            if (buffer.length < 16) return
            const challenge = buffer.subarray(0, 16)
            buffer = buffer.subarray(16)
            send(await vncDesResponse(args.password, challenge))
            state = "security_result"
          } else if (state === "security_result") {
            if (buffer.length < 4) return
            const status = buffer.readUInt32BE(0)
            buffer = buffer.subarray(4)
            if (status !== 0) return finish(false, `VNC authentication failed (${status})`)
            authenticated = true
            send(Buffer.from([1]))
            state = "server_init"
          } else if (state === "server_init") {
            if (buffer.length < 24) return
            width = buffer.readUInt16BE(0)
            height = buffer.readUInt16BE(2)
            bpp = Math.max(1, Math.floor(buffer[4] / 8))
            const nameLength = buffer.readUInt32BE(20)
            if (buffer.length < 24 + nameLength) return
            buffer = buffer.subarray(24 + nameLength)
            send(setEncodingsRaw())
            send(rfbPointerEvent(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))))
            send(framebufferRequest(width, height, false))
            state = "framebuffer"
          } else if (state === "framebuffer") {
            if (buffer.length < 4) return
            if (buffer[0] !== 0) {
              buffer = buffer.subarray(1)
              continue
            }
            const rects = buffer.readUInt16BE(2)
            let offset = 4
            let nonZero = 0
            let hash = 0
            for (let index = 0; index < rects; index += 1) {
              if (buffer.length < offset + 12) return
              const rectWidth = buffer.readUInt16BE(offset + 4)
              const rectHeight = buffer.readUInt16BE(offset + 6)
              const encoding = buffer.readInt32BE(offset + 8)
              offset += 12
              if (encoding === -223) {
                width = rectWidth || width
                height = rectHeight || height
                continue
              }
              if (encoding === -308) {
                if (buffer.length < offset + 4) return
                const screens = buffer[offset]
                const length = 4 + screens * 16
                if (buffer.length < offset + length) return
                width = rectWidth || width
                height = rectHeight || height
                offset += length
                continue
              }
              if (encoding !== 0) return finish(false, `Unsupported framebuffer encoding ${encoding}`)
              const length = rectWidth * rectHeight * bpp
              if (buffer.length < offset + length) return
              const sample = sampleFrame(buffer.subarray(offset, offset + length))
              nonZero += sample.nonZero
              hash ^= sample.hash
              offset += length
            }
            buffer = buffer.subarray(offset)
            if (firstHash === null) {
              if (nonZero <= 0) {
                blackFrameCount += 1
                const centerX = Math.max(1, Math.floor(width / 2))
                const centerY = Math.max(1, Math.floor(height / 2))
                send(rfbPointerEvent(centerX, centerY))
                send(rfbKeyEvent(0xff0d, true))
                send(rfbKeyEvent(0xff0d, false))
                setTimeout(() => {
                  if (!settled && ws.readyState === WebSocket.OPEN) send(framebufferRequest(width, height, false))
                }, Math.min(1500, 250 * blackFrameCount))
                continue
              }
              firstHash = hash
              lastHash = hash
              lastNonZero = nonZero
              firstNonZeroSampleBytes = nonZero
              firstFrameVisible = width > 0 && height > 0
              const centerX = Math.max(1, Math.floor(width / 2))
              const centerY = Math.max(1, Math.floor(height / 2))
              mouseProbeStarted = true
              send(rfbPointerEvent(centerX, centerY))
              send(rfbPointerEvent(centerX, centerY, 1))
              send(rfbPointerEvent(centerX, centerY, 0))
              setTimeout(async () => {
                if (settled || ws.readyState !== WebSocket.OPEN) return
                if (args.sendCtrlAltDel) {
                  try {
                    await args.sendCtrlAltDel()
                    ctrlAltDelSent = true
                  } catch (error) {
                    ctrlAltDelBackendError = redactConsoleSecret((error as any)?.message || error)
                  }
                }
                if (!ctrlAltDelSent) {
                  sendRfbCtrlAltDelete(send)
                  ctrlAltDelSent = true
                }
                keyboardProbeStarted = true
                sendRfbTextProbe(send)
                resizeRequestSent = true
                send(rfbSetDesktopSize(Math.min(1366, Math.max(800, width)), Math.min(768, Math.max(600, height))))
                send(framebufferRequest(width, height, false))
              }, 1200)
              send(framebufferRequest(width, height, false))
              postInputRequestTimer = setInterval(() => {
                if (!settled && ws.readyState === WebSocket.OPEN) send(framebufferRequest(width, height, false))
              }, 750)
              continue
            }
            const changedSinceLast = hash !== lastHash || nonZero !== lastNonZero
            if (changedSinceLast && mouseProbeStarted && !keyboardProbeStarted) mouseChangedFrame = true
            if (changedSinceLast && keyboardProbeStarted) {
              keyboardChangedFrame = true
              inputChangedFrame = true
              return finish(true, `Framebuffer visible and changed after keyboard input${mouseChangedFrame ? " and mouse click" : ""}${resizeRequestSent ? "; resize requested" : ""}${ctrlAltDelBackendError ? `; backend sendkey failed: ${ctrlAltDelBackendError}` : ""}`)
            }
            lastHash = hash
            lastNonZero = nonZero
          }
        }
      } catch (error) {
        finish(false, redactConsoleSecret((error as any)?.message || error))
      }
    }

    ws.on("open", () => {
      opened = true
    })
    ws.on("message", (data) => {
      buffer = Buffer.concat([buffer, wsBuffer(data)])
      void pump()
    })
    ws.on("unexpected-response", (_request, response) => finish(false, `Proxy websocket rejected with HTTP ${response.statusCode}`))
    ws.on("error", (error) => finish(false, redactConsoleSecret(error.message)))
    ws.on("close", (code) => {
      if (!settled) finish(false, `Proxy websocket closed before validation completed (${code})`)
    })
  })
}

export function serialPanelProbe(args: { url: string; timeoutMs: number; username?: string | null; password?: string | null }): Promise<SerialPanelValidationResult> {
  return new Promise((resolve) => {
    let transcript = ""
    let opened = false
    let authenticated = false
    let outputReceived = false
    let echoReturned = false
    let unameReturned = false
    let probeSent = false
    let unameSent = false
    let unameTranscriptOffset = 0
    let settled = false
    let loginState: "none" | "await_login" | "await_password" | "await_shell" | "ready" = args.username && args.password ? "await_login" : "none"
    let loginSent = false
    let passwordSent = false
    const ws = new WebSocket(args.url)
    const sendProbe = () => {
      if (probeSent || ws.readyState !== WebSocket.OPEN) return
      probeSent = true
      ws.send("echo TEST123\r")
      setTimeout(() => {
        if (!settled && !unameSent && ws.readyState === WebSocket.OPEN) {
          unameSent = true
          unameTranscriptOffset = transcript.length
          ws.send("uname -a\r")
        }
      }, 700)
    }
    const finish = (success: boolean, message?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(tickle)
      try {
        ws.close()
      } catch {}
      resolve({
        success,
        opened,
        authenticated,
        outputReceived,
        echoReturned,
        unameReturned,
        transcript: redactConsoleSecret(transcript.slice(-3000)),
        message,
      })
    }
    const timeout = setTimeout(() => finish(false, "Timed out waiting for serial command output through MyRDPHub proxy"), args.timeoutMs)
    const tickle = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && (loginState === "none" || loginState === "ready")) ws.send("\r")
    }, 2500)

    ws.on("open", () => {
      opened = true
      ws.send("\r")
    })
    ws.on("message", (data) => {
      authenticated = true
      outputReceived = true
      const chunk = data instanceof Buffer ? data.toString("utf8") : wsBuffer(data).toString("utf8")
      transcript += chunk
      if (/starting serial terminal on interface serial0/i.test(transcript) && transcript.length < 120) {
        ws.send("\r")
      }

      const shellPromptVisible = /(?:^|\r?\n)[^\r\n]*(?:#|\$)\s*$/m.test(transcript)
      if ((loginState === "await_login" || loginState === "await_shell") && shellPromptVisible) {
        loginState = "ready"
        sendProbe()
      }
      if (loginState === "await_login" && /(?:^|\r?\n)[^\r\n]*login:\s*$/i.test(transcript) && !loginSent && ws.readyState === WebSocket.OPEN) {
        loginSent = true
        ws.send(`${args.username}\r`)
        loginState = "await_password"
        return
      }
      if (loginState === "await_password" && /password:\s*$/i.test(transcript) && !passwordSent && ws.readyState === WebSocket.OPEN) {
        passwordSent = true
        ws.send(`${args.password}\r`)
        loginState = "await_shell"
        return
      }
      if (loginState === "await_shell" && /login incorrect|authentication failure|maximum number of tries exceeded/i.test(transcript)) {
        return finish(false, "Serial login failed with stored panel credentials")
      }
      if (loginState === "await_shell" && shellPromptVisible) {
        loginState = "ready"
        sendProbe()
      }
      if (loginState === "none") sendProbe()

      const markerCount = (transcript.match(/TEST123/g) || []).length
      if (markerCount >= 2) {
        echoReturned = true
      }
      if (echoReturned && !unameSent && ws.readyState === WebSocket.OPEN) {
        unameSent = true
        unameTranscriptOffset = transcript.length
        ws.send("uname -a\r")
      }
      const unameTail = unameSent ? transcript.slice(unameTranscriptOffset) : ""
      if (unameSent && (/uname -a[\s\S]*Linux\s+\S+/i.test(unameTail) || /uname -a[\s\S]*\bGNU\/Linux\b/i.test(unameTail))) unameReturned = true
      if (echoReturned && unameSent && unameReturned) finish(true, "Serial console returned TEST123 and uname output")
    })
    ws.on("unexpected-response", (_request, response) => finish(false, `Proxy websocket rejected with HTTP ${response.statusCode}`))
    ws.on("error", (error) => finish(false, redactConsoleSecret(error.message)))
    ws.on("close", (code) => {
      if (!settled) finish(false, `Proxy websocket closed before serial validation completed (${code})`)
    })
  })
}

export async function validateDirectVnc(args: { node: ProxmoxNodeForConsole; vps: VpsForConsole; timeoutMs?: number; sendCtrlAltDel?: boolean }) {
  const ticket = await createProxmoxVncProxy({
    host: args.node.host,
    node: args.node.nodeName,
    vmid: args.vps.vmid,
    tokenId: args.node.tokenId,
    tokenSecret: args.node.tokenSecret,
    allowInsecureTls: args.node.allowInsecureTls,
  })
  const url = buildProxmoxConsoleWebSocketUrl({
    host: args.node.host,
    node: args.node.nodeName,
    vmid: args.vps.vmid,
    port: ticket.port,
    vncTicket: ticket.ticket,
  })
  return vncPanelProbe({
    url,
    password: ticket.ticket,
    timeoutMs: args.timeoutMs || 30000,
    headers: { Authorization: buildProxmoxAuthorizationHeader(args.node.tokenId, args.node.tokenSecret) },
    rejectUnauthorized: !args.node.allowInsecureTls,
    sendCtrlAltDel: args.sendCtrlAltDel
      ? () => sendProxmoxCtrlAltDel({
        host: args.node.host,
        node: args.node.nodeName,
        vmid: args.vps.vmid,
        tokenId: args.node.tokenId,
        tokenSecret: args.node.tokenSecret,
        allowInsecureTls: args.node.allowInsecureTls,
      })
      : undefined,
  })
}

export async function validatePanelVnc(args: { node: ProxmoxNodeForConsole; vps: VpsForConsole; timeoutMs?: number; sendCtrlAltDel?: boolean; compareDirect?: boolean }) {
  const session = await createVncProxySession(args.node, args.vps)
  const panel = await vncPanelProbe({
    url: session.url,
    password: session.ticket,
    timeoutMs: args.timeoutMs || 30000,
    sendCtrlAltDel: args.sendCtrlAltDel
      ? () => sendProxmoxCtrlAltDel({
        host: args.node.host,
        node: args.node.nodeName,
        vmid: args.vps.vmid,
        tokenId: args.node.tokenId,
        tokenSecret: args.node.tokenSecret,
        allowInsecureTls: args.node.allowInsecureTls,
      })
      : undefined,
  })
  if (args.compareDirect) {
    panel.comparedDirect = await validateDirectVnc(args).catch((error) => ({
      success: false,
      opened: false,
      authenticated: false,
      firstFrameVisible: false,
      mouseChangedFrame: false,
      keyboardChangedFrame: false,
      inputChangedFrame: false,
      ctrlAltDelSent: false,
      resizeRequestSent: false,
      message: redactConsoleSecret((error as any)?.message || error),
    }))
  }
  return panel
}

export async function validatePanelSerial(args: { node: ProxmoxNodeForConsole; vps: VpsForConsole; timeoutMs?: number; username?: string | null; password?: string | null }) {
  const client = createProxmoxClient(args.node.host, args.node.tokenId, args.node.tokenSecret, { allowInsecureTls: args.node.allowInsecureTls })
  const config = await client.getVMConfig(args.node.nodeName, args.vps.vmid).catch(() => null)
  const session = await createSerialProxySession(args.node, args.vps, pickSerial(config))
  return serialPanelProbe({ url: session.url, timeoutMs: args.timeoutMs || 30000, username: args.username, password: args.password })
}

export async function smokeDirectProxmoxWebSocket(args: { node: ProxmoxNodeForConsole; vmid: number; timeoutMs?: number }) {
  const ticket = await createProxmoxVncProxy({
    host: args.node.host,
    node: args.node.nodeName,
    vmid: args.vmid,
    tokenId: args.node.tokenId,
    tokenSecret: args.node.tokenSecret,
    allowInsecureTls: args.node.allowInsecureTls,
  })
  const url = buildProxmoxConsoleWebSocketUrl({
    host: args.node.host,
    node: args.node.nodeName,
    vmid: args.vmid,
    port: ticket.port,
    vncTicket: ticket.ticket,
  })
  return new Promise<{ opened: boolean; message?: string }>((resolve) => {
    let settled = false
    const ws = new WebSocket(url, {
      headers: { Authorization: buildProxmoxAuthorizationHeader(args.node.tokenId, args.node.tokenSecret) },
      rejectUnauthorized: !args.node.allowInsecureTls,
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      resolve({ opened: false, message: "Timed out connecting to direct Proxmox websocket" })
    }, args.timeoutMs || 8000)
    ws.on("open", () => {
      settled = true
      clearTimeout(timeout)
      ws.close()
      resolve({ opened: true })
    })
    ws.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ opened: false, message: redactConsoleSecret(error.message) })
    })
  })
}
