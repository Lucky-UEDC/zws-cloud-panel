import "dotenv/config"
import { prisma } from "@/lib/db"
import { buildProxmoxAuthorizationHeader, createProxmoxClient } from "@/lib/proxmox"
import { buildProxmoxConsoleWebSocketUrl, createProxmoxTermProxy } from "@/lib/proxmox-vnc"
import WebSocket from "ws"

function pickSerial(config: Record<string, any>) {
  for (const key of ["serial0", "serial1", "serial2", "serial3"] as const) {
    if (typeof config[key] === "string" && config[key].trim()) return key
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

function testWebSocket(args: { url: string; authorization: string; allowInsecureTls: boolean; termUser: string; termTicket: string }) {
  return new Promise<{ opened: boolean; authenticated: boolean; firstFrameLength?: number }>((resolve, reject) => {
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
      resolve({ opened, authenticated, firstFrameLength })
    }, 5000)

    ws.on("open", () => {
      opened = true
      try {
        ws.send(`${args.termUser}:${args.termTicket}\n`)
      } catch {
        // The error handler below will report failed writes.
      }
    })
    ws.on("message", (data) => {
      const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as any)
      if (firstFrameLength === undefined) firstFrameLength = frame.length
      if (!authenticated) {
        if (frame[0] !== 79 || frame[1] !== 75) {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          ws.close()
          reject(new Error(`Proxmox serial websocket auth failed: ${frame.toString("utf8").slice(0, 120)}`))
          return
        }
        authenticated = true
        ws.send(frameXtermInput("\r"))
      }
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ws.close()
      resolve({ opened: true, authenticated, firstFrameLength })
    })
    ws.on("unexpected-response", (_request, response) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(new Error(`Proxmox serial websocket rejected with HTTP ${response.statusCode}`))
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
      reject(new Error(`Proxmox serial websocket closed before open/read: ${code} ${reason.toString()}`.trim()))
    })
  })
}

async function main() {
  const vmid = Number(process.argv[2])
  const node = String(process.argv[3] || "")
  if (!Number.isInteger(vmid) || !node.trim()) {
    console.error("Usage: pnpm tsx scripts/test-serial-flow.ts <vmid> <node>")
    process.exitCode = 2
    return
  }

  const nodeConfig = await prisma.proxmoxNode.findFirst({
    where: { OR: [{ nodeName: node }, { id: node }, { name: node }] },
  })
  if (!nodeConfig) throw new Error("Proxmox node config not found")
  console.log("OK load_node")

  const proxmox = createProxmoxClient(nodeConfig.host, nodeConfig.tokenId, nodeConfig.tokenSecret, {
    allowInsecureTls: nodeConfig.allowInsecureTls,
  })
  const runtime = await proxmox.getVMStatus(nodeConfig.nodeName, vmid)
  console.log(`OK vm_status status=${runtime?.status || "unknown"}`)
  const config = await proxmox.getVMConfig(nodeConfig.nodeName, vmid)
  const serial = pickSerial(config)
  console.log(`OK serial_config device=${serial} value=${config?.[serial] || "missing"}`)

  const termTicket = await createProxmoxTermProxy({
    host: nodeConfig.host,
    node: nodeConfig.nodeName,
    vmid,
    tokenId: nodeConfig.tokenId,
    tokenSecret: nodeConfig.tokenSecret,
    serial,
    allowInsecureTls: nodeConfig.allowInsecureTls,
  })
  console.log(`OK termproxy port=${termTicket.port} hasTicket=${Boolean(termTicket.ticket)}`)

  const wsUrl = buildProxmoxConsoleWebSocketUrl({
    host: nodeConfig.host,
    node: nodeConfig.nodeName,
    vmid,
    port: termTicket.port,
    vncTicket: termTicket.ticket,
  })
  const ws = await testWebSocket({
    url: wsUrl,
    authorization: buildProxmoxAuthorizationHeader(nodeConfig.tokenId, nodeConfig.tokenSecret),
    allowInsecureTls: nodeConfig.allowInsecureTls,
    termUser: termTicket.user || consoleUserFromToken(nodeConfig.tokenId),
    termTicket: termTicket.ticket,
  })
  console.log(`OK serial_websocket_connect opened=${ws.opened} authenticated=${ws.authenticated}${ws.firstFrameLength !== undefined ? ` firstFrameLength=${ws.firstFrameLength}` : ""}`)
}

main()
  .catch((error) => {
    console.error(`FATAL ${error?.message || error}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect?.().catch(() => undefined)
  })
