import { NextRequest, NextResponse } from "next/server"
import { computeConsoleMode } from "@/lib/console-mode"
import { prisma } from "@/lib/db"
import { buildProxmoxAuthorizationHeader, createProxmoxClient } from "@/lib/proxmox"
import { buildProxmoxConsoleWebSocketUrl, createProxmoxTermProxy } from "@/lib/proxmox-vnc"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getVncEnvDebug, runVncDiagnostics } from "@/lib/vnc-diagnostics"
import WebSocket from "ws"

function pickSerial(config: Record<string, any> | null | undefined) {
  for (const key of ["serial0", "serial1", "serial2", "serial3"] as const) {
    if (typeof config?.[key] === "string" && config[key].trim()) return key
  }
  return "serial0"
}

function consoleUserFromToken(tokenId: string) {
  const owner = String(tokenId || "").split("!")[0]?.trim()
  return owner || "root@pam"
}

function frameXtermInput(input: string) {
  return `0:${Buffer.byteLength(input, "utf8")}:${input}`
}

function websocketProbe(args: { url: string; authorization: string; allowInsecureTls: boolean; termUser: string; termTicket: string }) {
  return new Promise<{ ok: boolean; authenticated?: boolean; firstFrameLength?: number; message?: string }>((resolve) => {
    let settled = false
    let opened = false
    let authenticated = false
    let firstFrameLength: number | undefined
    const ws = new WebSocket(args.url, {
      headers: { Authorization: args.authorization },
      rejectUnauthorized: !args.allowInsecureTls,
    })
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      resolve({ ok: opened, firstFrameLength, message: "Timed out waiting for serial output" })
    }, 5000)
    ws.on("open", () => {
      opened = true
      try {
        ws.send(`${args.termUser}:${args.termTicket}\n`)
      } catch {
        // The websocket error handler reports failed writes.
      }
    })
    ws.on("message", (data) => {
      const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any)
      firstFrameLength = frame.length
      if (!authenticated) {
        if (frame[0] !== 79 || frame[1] !== 75) {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          ws.close()
          resolve({ ok: false, authenticated, firstFrameLength, message: `Serial websocket authentication failed: ${frame.toString("utf8").slice(0, 120)}` })
          return
        }
        authenticated = true
        ws.send(frameXtermInput("\r"))
      }
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ws.close()
      resolve({ ok: true, authenticated, firstFrameLength })
    })
    ws.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ ok: false, message: error.message })
    })
    ws.on("unexpected-response", (_request, response) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ ok: false, message: `HTTP ${response.statusCode}` })
    })
    ws.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ ok: false, message: `closed ${code}` })
    })
  })
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const vmid = Number(request.nextUrl.searchParams.get("vmid"))
  const node = String(request.nextUrl.searchParams.get("node") || "")
  const env = getVncEnvDebug()
  if (!Number.isInteger(vmid) || !node.trim()) {
    return NextResponse.json({ success: false, error: "vmid and node are required", env }, { status: 400 })
  }

  const nodeConfig = await prisma.proxmoxNode.findFirst({
    where: { OR: [{ nodeName: node }, { id: node }, { name: node }] },
  })
  if (!nodeConfig) return NextResponse.json({ success: false, error: "Compute node config not found", env }, { status: 404 })

  const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
    allowInsecureTls: nodeConfig.allowInsecureTls,
  })
  const vmConfig = await proxmox.getVMConfig(nodeConfig.nodeName, vmid).catch(() => null)
  const consoleMode = computeConsoleMode({ vmConfig })
  const vnc = await runVncDiagnostics({ vmid, node }).catch((error) => ({ success: false, error: error?.message || "VNC diagnostic failed" }))

  let serial: any = { success: false, skipped: true, message: "Serial console is not available for this VM console mode" }
  if (consoleMode.switches.canUseSerial) {
    try {
      const term = await createProxmoxTermProxy({
        host: nodeConfig.host,
        node: nodeConfig.nodeName,
        vmid,
        tokenId: nodeConfig.tokenId,
        tokenSecret: nodeConfig.tokenSecret,
        serial: pickSerial(vmConfig),
        allowInsecureTls: nodeConfig.allowInsecureTls,
      })
      const url = buildProxmoxConsoleWebSocketUrl({
        host: nodeConfig.host,
        node: nodeConfig.nodeName,
        vmid,
        port: term.port,
        vncTicket: term.ticket,
      })
      const ws = await websocketProbe({
        url,
        authorization: buildProxmoxAuthorizationHeader(nodeConfig.tokenId, nodeConfig.tokenSecret),
        allowInsecureTls: nodeConfig.allowInsecureTls,
        termUser: term.user || consoleUserFromToken(nodeConfig.tokenId),
        termTicket: term.ticket,
      })
      serial = { success: ws.ok, termproxy: { port: term.port, hasTicket: Boolean(term.ticket) }, websocket: ws }
    } catch (error: any) {
      serial = { success: false, error: error?.message || "Serial diagnostic failed" }
    }
  }

  return NextResponse.json({
    success: true,
    env,
    display_config: consoleMode.display,
    console_mode: {
      mode: consoleMode.mode,
      defaultMode: consoleMode.defaultMode,
      reason: consoleMode.reason,
      switches: consoleMode.switches,
    },
    vnc,
    serial,
  })
}
