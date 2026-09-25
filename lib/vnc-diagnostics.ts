import { prisma } from "@/lib/db"
import { buildProxmoxAuthorizationHeader, createProxmoxClient } from "@/lib/proxmox"
import {
  buildProxmoxVncWebSocketUrl,
  createProxmoxVncProxy,
} from "@/lib/proxmox-vnc"
import { computeConsoleMode } from "@/lib/console-mode"
import WebSocket from "ws"

export type VncDiagnosticStep = {
  step: string
  ok: boolean
  status?: string
  port?: number
  hasTicket?: boolean
  length?: number
  compatible?: boolean
  skipped?: boolean
  message?: string
}

export type VncDiagnosticResult = {
  success: boolean
  steps: VncDiagnosticStep[]
  env: VncEnvDebug
  error?: string
}

export type VncEnvDebug = {
  tokenConfigured: boolean
}

export function getVncEnvDebug(): VncEnvDebug {
  return { tokenConfigured: true }
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown error")
  return message
    .replace(/PVE:[^'"\s]+/g, "PVE:<redacted>")
    .replace(/PVEAuthCookie=[^;'\s]+/g, "PVEAuthCookie=<redacted>")
}

function fail(steps: VncDiagnosticStep[], step: string, error: unknown): VncDiagnosticResult {
  const message = safeMessage(error)
  steps.push({ step, ok: false, message })
  return { success: false, steps, env: getVncEnvDebug(), error: message }
}

function firstFrameFromProxmox(args: {
  websocketUrl: string
  authorization: string
  allowInsecureTls: boolean
  timeoutMs?: number
}): Promise<{
  opened: boolean
  firstFrameLength?: number
  handshakeOk?: boolean
  firstFrameText?: string
  clientVersionSent?: boolean
  securityTypes?: number[]
  hasVncAuth?: boolean
}> {
  return new Promise((resolve, reject) => {
    let settled = false
    let opened = false
    let firstFrameLength = 0
    let handshakeOk = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      reject(new Error(opened ? "Timed out waiting for RFB security types" : "Timed out connecting to Proxmox VNC websocket"))
    }, args.timeoutMs || 8000)

    const ws = new WebSocket(args.websocketUrl, {
      headers: { Authorization: args.authorization },
      rejectUnauthorized: !args.allowInsecureTls,
    })

    ws.on("open", () => {
      opened = true
    })
    ws.on("message", (data) => {
      if (settled) return
      const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any)
      if (!firstFrameLength) {
        firstFrameLength = frame.length
        const text = frame.subarray(0, 12).toString("ascii")
        handshakeOk = text.startsWith("RFB")
        if (!handshakeOk) {
          settled = true
          clearTimeout(timeout)
          ws.close()
          resolve({ opened, firstFrameLength, handshakeOk: false })
          return
        }
        ws.send(frame, { binary: true })
        return
      }

      const securityTypes = frame.length > 0 ? Array.from(frame.subarray(1, 1 + frame[0])) : []
      settled = true
      clearTimeout(timeout)
      ws.close()
      resolve({
        opened,
        firstFrameLength,
        handshakeOk,
        clientVersionSent: true,
        securityTypes,
        hasVncAuth: securityTypes.includes(2),
      })
    })
    ws.on("unexpected-response", (_request, response) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Proxmox VNC websocket rejected with HTTP ${response.statusCode}`))
    })
    ws.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    ws.on("close", (code, reason) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Proxmox VNC websocket closed before handshake: ${code} ${reason.toString()}`.trim()))
    })
  })
}

export async function runVncDiagnostics(args: { vmid: number; node: string }): Promise<VncDiagnosticResult> {
  const steps: VncDiagnosticStep[] = []
  const nodeName = String(args.node || "").trim()
  const vmid = Number(args.vmid)

  if (!nodeName || !Number.isInteger(vmid)) {
    return fail(steps, "input", "vmid and node are required")
  }

  const nodeConfig = await prisma.proxmoxNode.findFirst({
    where: { OR: [{ nodeName }, { id: nodeName }, { name: nodeName }] },
  })
  if (!nodeConfig) {
    return fail(steps, "load_node", "Proxmox node config not found")
  }
  steps.push({ step: "load_node", ok: true })

  const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
    allowInsecureTls: nodeConfig.allowInsecureTls,
  })

  let runtime: any
  try {
    runtime = await proxmox.getVMStatus(nodeConfig.nodeName, vmid)
  } catch (error) {
    return fail(steps, "vm_status", error)
  }
  steps.push({ step: "vm_status", ok: true, status: String(runtime?.status || "unknown") })

  let modeData: ReturnType<typeof computeConsoleMode>
  try {
    const vmConfig = await proxmox.getVMConfig(nodeConfig.nodeName, vmid)
    modeData = computeConsoleMode({ vmConfig })
    steps.push({
      step: "display_config",
      ok: true,
      status: `vga=${modeData.display.vga || "missing"} serial0=${modeData.display.serial0 || "none"}`,
      compatible: modeData.display.graphicalCompatible,
    })
    steps.push({
      step: "console_mode",
      ok: true,
      status: `${modeData.mode} default=${modeData.defaultMode}`,
      message: modeData.reason,
    })
  } catch (error) {
    return fail(steps, "display_config", error)
  }

  if (!modeData.switches.canUseVnc) {
    steps.push({
      step: "vnc_expected",
      ok: true,
      skipped: true,
      status: "skipped",
      message: "Graphical VNC is not available for this VM console mode",
    })
    return { success: true, steps, env: getVncEnvDebug() }
  }

  if (String(runtime?.status || "").toLowerCase() !== "running") {
    return {
      success: false,
      steps,
      env: getVncEnvDebug(),
      error: "VM is not running",
    }
  }

  steps.push({ step: "token_auth", ok: true })

  let vncTicket: { port: number; ticket: string; cert: string }
  try {
    vncTicket = await createProxmoxVncProxy({
      host: nodeConfig.host,
      node: nodeConfig.nodeName,
      vmid,
      tokenId: nodeConfig.tokenId,
      tokenSecret: nodeConfig.tokenSecret,
      allowInsecureTls: nodeConfig.allowInsecureTls,
    })
  } catch (error) {
    return fail(steps, "vncproxy", error)
  }
  steps.push({ step: "vncproxy", ok: true, port: vncTicket.port, hasTicket: Boolean(vncTicket.ticket) })

  const websocketUrl = buildProxmoxVncWebSocketUrl({
    host: nodeConfig.host,
    node: nodeConfig.nodeName,
    vmid,
    port: vncTicket.port,
    vncTicket: vncTicket.ticket,
  })

  let frame: Awaited<ReturnType<typeof firstFrameFromProxmox>>
  try {
    frame = await firstFrameFromProxmox({
      websocketUrl,
      authorization: buildProxmoxAuthorizationHeader(nodeConfig.tokenId, nodeConfig.tokenSecret),
      allowInsecureTls: nodeConfig.allowInsecureTls,
    })
  } catch (error) {
    return fail(steps, "vnc_websocket_connect", error)
  }

  steps.push({ step: "vnc_websocket_connect", ok: Boolean(frame.opened) })
  steps.push({ step: "rfb_handshake", ok: Boolean(frame.handshakeOk), length: frame.firstFrameLength })
  steps.push({ step: "rfb_client_version", ok: Boolean(frame.clientVersionSent) })
  steps.push({ step: "rfb_security_types", ok: Boolean(frame.hasVncAuth), status: frame.securityTypes?.join(",") || "none" })

  const success = Boolean(frame.handshakeOk && frame.clientVersionSent && frame.hasVncAuth && steps.every((step) => step.ok))
  return {
    success,
    steps,
    env: getVncEnvDebug(),
    ...(success ? {} : { error: "Proxmox VNC handshake or display validation failed" }),
  }
}
