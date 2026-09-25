import http from "node:http"
import https from "node:https"
import { buildProxmoxAuthorizationHeader, normalizeProxmoxHost, type ProxmoxVNCTicket } from "@/lib/proxmox"

export type ProxmoxConsoleTargetKind = "qemu" | "lxc"

type ProxmoxPasswordTicket = {
  ticket: string
  csrf: string
}

export type ProxmoxTermProxyTicket = {
  port: number
  ticket: string
  upid?: string
  user?: string
}

type RequestOptions = {
  allowInsecureTls?: boolean
  headers?: Record<string, string>
  method?: "POST" | "PUT"
  timeoutMs?: number
}

type ProxmoxConsoleAuth = {
  pveTicket?: string
  csrf?: string
  tokenId?: string
  tokenSecret?: string
}

function encodeForm(body: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

function safeErrorMessage(status: number, fallback?: string) {
  if (status === 401 || status === 403) return "Console API token was rejected by the virtualization platform"
  if (status === 404) return "Proxmox VNC endpoint not found"
  return fallback || "Proxmox VNC request failed"
}

function safeResponseDetail(value: unknown) {
  const text = typeof value === "string" ? value : value ? JSON.stringify(value) : ""
  return text
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/PVEAuthCookie=[^;\s"'<>]+/gi, "PVEAuthCookie=[redacted]")
    .replace(/PVEVNC:[^&\s"'<>]+/gi, "PVEVNC:[redacted]")
    .replace(/ticket["':=\s]+[^"',\s}]+/gi, "ticket=[redacted]")
    .replace(/\btoken(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
    .replace(/password["':=\s]+[^"',\s}]+/gi, "password=[redacted]")
    .slice(0, 500)
}

function authHeaders(auth: ProxmoxConsoleAuth): Record<string, string> {
  if (auth.tokenId && auth.tokenSecret) {
    return { Authorization: buildProxmoxAuthorizationHeader(auth.tokenId, auth.tokenSecret) }
  }
  if (auth.pveTicket) {
    const headers: Record<string, string> = { Cookie: `PVEAuthCookie=${auth.pveTicket}` }
    if (auth.csrf) headers.CSRFPreventionToken = auth.csrf
    return headers
  }
  throw new Error("Console API token is not configured for this node")
}

function consolePath(kind: ProxmoxConsoleTargetKind | undefined, node: string, vmid: number, endpoint: "vncproxy" | "vncwebsocket" | "termproxy" | "sendkey") {
  const targetKind = kind || "qemu"
  if (targetKind === "lxc" && (endpoint === "vncproxy" || endpoint === "sendkey")) {
    throw new Error(`Proxmox ${endpoint} is only supported for QEMU guests`)
  }
  return `/api2/json/nodes/${encodeURIComponent(node)}/${targetKind}/${vmid}/${endpoint}`
}

async function requestProxmoxForm<T>(
  host: string,
  path: string,
  body: Record<string, string | number | boolean | undefined>,
  options: RequestOptions = {}
): Promise<T> {
  const base = normalizeProxmoxHost(host)
  const url = new URL(path, `${base}/`)
  const payload = encodeForm(body)
  const isHttps = url.protocol === "https:"
  const transport = isHttps ? https : http

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: options.method || "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload),
          ...options.headers,
        },
        rejectUnauthorized: isHttps ? !options.allowInsecureTls : undefined,
        timeout: options.timeoutMs || 10000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const status = res.statusCode || 0
          const raw = Buffer.concat(chunks).toString("utf8")
          let parsed: any = {}
          try {
            parsed = raw ? JSON.parse(raw) : {}
          } catch {
            parsed = {}
          }

          if (status < 200 || status >= 300) {
            const detail = safeResponseDetail(parsed?.errors || parsed?.error || raw)
            const baseMessage = safeErrorMessage(status)
            reject(new Error(detail ? `${baseMessage} (${status}: ${detail})` : `${baseMessage} (${status})`))
            return
          }

          resolve((parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed) as T)
        })
      }
    )

    req.on("timeout", () => req.destroy(new Error("Proxmox VNC request timed out")))
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

export async function getProxmoxPasswordTicket(args: {
  host: string
  username: string
  password: string
  allowInsecureTls?: boolean
}): Promise<ProxmoxPasswordTicket> {
  const data = await requestProxmoxForm<{ ticket?: string; CSRFPreventionToken?: string }>(
    args.host,
    "/api2/json/access/ticket",
    {
      username: args.username,
      password: args.password,
    },
    { allowInsecureTls: args.allowInsecureTls }
  )

  if (!data?.ticket || !data?.CSRFPreventionToken) {
    throw new Error("Proxmox VNC authentication did not return a usable ticket")
  }

  return { ticket: data.ticket, csrf: data.CSRFPreventionToken }
}

export async function createProxmoxVncProxy(args: {
  host: string
  node: string
  vmid: number
  targetKind?: ProxmoxConsoleTargetKind
  pveTicket?: string
  csrf?: string
  tokenId?: string
  tokenSecret?: string
  allowInsecureTls?: boolean
}): Promise<ProxmoxVNCTicket> {
  const ticket = await requestProxmoxForm<ProxmoxVNCTicket>(
    args.host,
    consolePath(args.targetKind || "qemu", args.node, args.vmid, "vncproxy"),
    { websocket: 1 },
    {
      allowInsecureTls: args.allowInsecureTls,
      headers: authHeaders(args),
    }
  )

  if (!ticket?.port || !ticket?.ticket) {
    throw new Error("Proxmox did not return a usable VNC websocket ticket")
  }

  return ticket
}

export async function createProxmoxTermProxy(args: {
  host: string
  node: string
  vmid: number
  targetKind?: ProxmoxConsoleTargetKind
  pveTicket?: string
  csrf?: string
  tokenId?: string
  tokenSecret?: string
  serial?: "serial0" | "serial1" | "serial2" | "serial3"
  allowInsecureTls?: boolean
}): Promise<ProxmoxTermProxyTicket> {
  const ticket = await requestProxmoxForm<ProxmoxTermProxyTicket>(
    args.host,
    consolePath(args.targetKind, args.node, args.vmid, "termproxy"),
    args.targetKind === "lxc" ? {} : { serial: args.serial },
    {
      allowInsecureTls: args.allowInsecureTls,
      headers: authHeaders(args),
    }
  )

  if (!ticket?.port || !ticket?.ticket) {
    throw new Error("Proxmox did not return a usable serial terminal ticket")
  }

  return ticket
}

export async function resizeProxmoxTermProxy(args: {
  host: string
  node: string
  vmid: number
  targetKind?: ProxmoxConsoleTargetKind
  pveTicket?: string
  csrf?: string
  tokenId?: string
  tokenSecret?: string
  port: number
  width: number
  height: number
  allowInsecureTls?: boolean
}): Promise<any> {
  return requestProxmoxForm<any>(
    args.host,
    consolePath(args.targetKind, args.node, args.vmid, "termproxy"),
    {
      port: args.port,
      width: Math.max(20, Math.min(300, Math.floor(args.width))),
      height: Math.max(5, Math.min(120, Math.floor(args.height))),
    },
    {
      allowInsecureTls: args.allowInsecureTls,
      headers: authHeaders(args),
      method: "PUT",
    }
  )
}

export async function sendProxmoxCtrlAltDel(args: {
  host: string
  node: string
  vmid: number
  targetKind?: ProxmoxConsoleTargetKind
  pveTicket?: string
  csrf?: string
  tokenId?: string
  tokenSecret?: string
  allowInsecureTls?: boolean
}): Promise<any> {
  return requestProxmoxForm<any>(
    args.host,
    consolePath(args.targetKind || "qemu", args.node, args.vmid, "sendkey"),
    { key: "ctrl-alt-delete" },
    {
      allowInsecureTls: args.allowInsecureTls,
      headers: authHeaders(args),
    }
  )
}

export function buildProxmoxVncWebSocketUrl(args: {
  host: string
  node: string
  vmid: number
  targetKind?: ProxmoxConsoleTargetKind
  port: number
  vncTicket: string
}) {
  const base = new URL(normalizeProxmoxHost(args.host))
  base.protocol = base.protocol === "http:" ? "ws:" : "wss:"
  const root = base.toString().replace(/\/+$/, "")
  return `${root}${consolePath(args.targetKind, args.node, args.vmid, "vncwebsocket")}?port=${encodeURIComponent(String(args.port))}&vncticket=${encodeURIComponent(args.vncTicket)}`
}

export const buildProxmoxConsoleWebSocketUrl = buildProxmoxVncWebSocketUrl
