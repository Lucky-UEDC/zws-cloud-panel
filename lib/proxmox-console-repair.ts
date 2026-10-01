import "dotenv/config"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import { Client as SshClient } from "ssh2"
import WebSocket from "ws"
import { prisma } from "@/lib/db"
import { decryptSecretValue } from "@/lib/secret-crypto"
import { buildProxmoxAuthorizationHeader, createProxmoxClient, normalizeProxmoxHost } from "@/lib/proxmox"
import {
  buildProxmoxConsoleWebSocketUrl,
  createProxmoxTermProxy,
  createProxmoxVncProxy,
  type ProxmoxTermProxyTicket,
} from "@/lib/proxmox-vnc"

type SerialDevice = "serial0" | "serial1" | "serial2" | "serial3"
type GuestFamily = "linux" | "windows" | "unknown"

export type ConsoleRepairOptions = {
  apply?: boolean
  vmid?: number
  nodeId?: string
  json?: boolean
  validateGuest?: boolean
  timeoutMs?: number
}

export type ConsoleCheck = {
  name: string
  ok: boolean
  status?: string
  message?: string
  skipped?: boolean
  evidence?: Record<string, unknown>
}

export type ConsoleVmReport = {
  vpsId: string
  vmid: number
  name: string
  managed: boolean
  nodeId: string
  nodeName: string
  family: GuestFamily
  panelStatus: string
  runtimeStatus: string
  config: Record<string, unknown>
  repairs: string[]
  checks: ConsoleCheck[]
  success: boolean
  error?: string
}

export type ConsoleNodeReport = {
  node: {
    id: string
    name: string
    nodeName: string
    host: string
    status: string
  }
  checks: ConsoleCheck[]
  vms: ConsoleVmReport[]
  success: boolean
}

export type ConsoleAuditReport = {
  generatedAt: string
  apply: boolean
  nodes: ConsoleNodeReport[]
  success: boolean
}

type ProxmoxNodeRow = Awaited<ReturnType<typeof prisma.proxmoxNode.findFirst>>
type VpsRow = any

const WINDOWS_VGA_DEFAULT = "std,clipboard=vnc"
const SERIAL_CONSOLE_ARG = "console=ttyS0,115200n8"
const LOGIN_PROMPT_RE = /(?:ubuntu|debian|linux|[\w.-]+)\s+login:\s*$/i
const PASSWORD_PROMPT_RE = /password:\s*$/i
const TEST_MARKER = "TEST123"
const execFileAsync = promisify(execFile)

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function addCheck(checks: ConsoleCheck[], name: string, ok: boolean, message?: string, extra: Partial<ConsoleCheck> = {}) {
  checks.push({ name, ok, ...(message ? { message } : {}), ...extra })
  return ok
}

export function redactConsoleSecret(input: unknown) {
  return String(input || "Unknown error")
    .replace(/PVEAPIToken=[^\s"'<>]+/gi, "PVEAPIToken=[redacted]")
    .replace(/PVEAuthCookie=[^;\s"'<>]+/gi, "PVEAuthCookie=[redacted]")
    .replace(/PVEVNC:[^&\s"'<>]+/gi, "PVEVNC:[redacted]")
    .replace(/ticket["':=\s]+[^"',\s}]+/gi, "ticket=[redacted]")
    .replace(/\btoken(secret)?["':=\s]+[^"',\s}]+/gi, "token=[redacted]")
    .replace(/password["':=\s]+[^"',\s}]+/gi, "password=[redacted]")
}

function safeError(error: unknown) {
  return redactConsoleSecret((error as any)?.message || error)
}

export function classifyGuestFamily(input: {
  osName?: unknown
  osFamily?: unknown
  consoleType?: unknown
  vmOsFamily?: unknown
  config?: Record<string, any> | null
}): GuestFamily {
  const haystack = [
    input.osName,
    input.osFamily,
    input.consoleType,
    input.vmOsFamily,
    input.config?.ostype,
    input.config?.name,
  ].map((value) => String(value || "").toLowerCase()).join(" ")
  if (/\bwin|windows|win11|win10|w2k|wxp/.test(haystack)) return "windows"
  if (/ubuntu|debian|linux|centos|rocky|alma|arch|fedora|l26|xterm|serial/.test(haystack)) return "linux"
  return "unknown"
}

export function isMalformedWindowsVga(value: unknown) {
  const raw = text(value).toLowerCase()
  if (!raw) return true
  const base = raw.split(",")[0]?.trim()
  return !["std", "virtio", "qxl", "vmware", "cirrus"].includes(base)
}

export function linuxSerialPatch(config: Record<string, any> | null | undefined) {
  const patch: Record<string, string> = {}
  if (text(config?.serial0) !== "socket") patch.serial0 = "socket"
  if (text(config?.vga) !== "serial0") patch.vga = "serial0"
  return patch
}

export function windowsDisplayPatch(config: Record<string, any> | null | undefined) {
  return isMalformedWindowsVga(config?.vga) ? { vga: WINDOWS_VGA_DEFAULT } : {}
}

function pickSerial(config: Record<string, any> | null | undefined): SerialDevice {
  for (const key of ["serial0", "serial1", "serial2", "serial3"] as const) {
    if (text(config?.[key])) return key
  }
  return "serial0"
}

export function buildLinuxSerialRepairScript() {
  return String.raw`set -e
changed=0
if [ -f /etc/default/grub ]; then
  cp -n /etc/default/grub /etc/default/grub.zws-console.bak 2>/dev/null || true
  if grep -Eq '(^|[[:space:]])console=ttyS0,115200n8([[:space:]]|$)' /etc/default/grub; then
    :
  elif grep -Eq '^GRUB_CMDLINE_LINUX=' /etc/default/grub; then
    sed -i -E 's/^(GRUB_CMDLINE_LINUX="[^"]*)"/\1 console=ttyS0,115200n8"/' /etc/default/grub
    changed=1
  else
    printf '%s\n' 'GRUB_CMDLINE_LINUX="console=ttyS0,115200n8"' >> /etc/default/grub
    changed=1
  fi
  if [ "$changed" = "1" ]; then
    update-grub || grub2-mkconfig -o /boot/grub2/grub.cfg
  fi
else
  printf '%s\n' 'missing_grub_config'
fi
systemctl enable --now serial-getty@ttyS0.service
systemctl is-enabled serial-getty@ttyS0.service
systemctl is-active serial-getty@ttyS0.service
printf 'zws_serial_changed=%s\n' "$changed"`
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function loadVpsRows(options: ConsoleRepairOptions) {
  return prisma.vpsInstance.findMany({
    where: {
      deletedAt: null,
      proxmoxNodeId: options.nodeId ? options.nodeId : { not: null },
      vmid: options.vmid ? options.vmid : { gt: 0 },
    },
    include: {
      proxmoxNode: true,
      operatingSystem: { select: { name: true, osFamily: true, consoleType: true } },
      order: { select: { osName: true, status: true, adminUsername: true, passwordEncrypted: true } },
    },
    orderBy: [{ proxmoxNodeId: "asc" }, { vmid: "asc" }],
  })
}

async function loadProxmoxNodes(options: ConsoleRepairOptions) {
  return prisma.proxmoxNode.findMany({
    where: {
      isActive: true,
      ...(options.nodeId ? { id: options.nodeId } : {}),
    },
    orderBy: [{ name: "asc" }, { nodeName: "asc" }],
  })
}

function syntheticVpsForQemu(node: NonNullable<ProxmoxNodeRow>, vm: Record<string, any>): VpsRow {
  const vmid = Number(vm.vmid)
  return {
    id: `unmanaged:${node.id}:${vmid}`,
    vmid,
    name: text(vm.name) || `VM ${vmid}`,
    status: "UNMANAGED",
    managed: false,
    proxmoxNodeId: node.id,
    proxmoxNode: node,
    operatingSystem: null,
    order: null,
    consoleType: "auto",
    vmOsFamily: null,
    adminUsername: null,
    username: null,
    passwordEncrypted: null,
    ipAddress: "",
  }
}

function credentialFor(vps: VpsRow) {
  const username = text(vps.adminUsername) || text(vps.username) || text(vps.order?.adminUsername) || "root"
  const encrypted = text(vps.passwordEncrypted) || text(vps.order?.passwordEncrypted)
  const password = encrypted ? decryptSecretValue(encrypted) : ""
  return { username, password, host: text(vps.ipAddress) }
}

function sshExec(args: {
  host: string
  username: string
  password: string
  command: string
  timeoutMs: number
}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const conn = new SshClient()
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      conn.end()
      reject(new Error("SSH command timed out"))
    }, args.timeoutMs)

    conn.on("ready", () => {
      conn.exec(args.command, { pty: true }, (error, stream) => {
        if (error) {
          clearTimeout(timer)
          conn.end()
          reject(error)
          return
        }
        stream.on("close", (code: number | null) => {
          clearTimeout(timer)
          conn.end()
          if (code && code !== 0) reject(new Error(`SSH command exited ${code}: ${stderr || stdout}`))
          else resolve({ stdout, stderr })
        })
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8")
        })
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8")
        })
        if (args.command.includes("sudo -S")) stream.write(`${args.password}\n`)
      })
    })
    conn.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    conn.connect({
      host: args.host,
      port: 22,
      username: args.username,
      password: args.password,
      readyTimeout: Math.min(args.timeoutMs, 15000),
      tryKeyboard: true,
    })
  })
}

async function repairLinuxGuestViaSsh(vps: VpsRow, checks: ConsoleCheck[], timeoutMs: number) {
  const credential = credentialFor(vps)
  if (!credential.host || !credential.password) {
    addCheck(checks, "linux_guest_ssh", false, "Stored guest IP/password is unavailable", { skipped: true })
    return { ok: false, changed: false, rebootNeeded: false }
  }
  const script = buildLinuxSerialRepairScript()
  const root = credential.username === "root"
  const command = root ? `bash -lc ${shellQuote(script)}` : `sudo -S -p '' bash -lc ${shellQuote(script)}`
  try {
    const result = await sshExec({
      host: credential.host,
      username: credential.username,
      password: credential.password,
      command,
      timeoutMs,
    })
    const changed = /zws_serial_changed=1/.test(result.stdout)
    addCheck(checks, "linux_guest_ssh", true, "GRUB and serial getty verified", {
      evidence: {
        host: credential.host,
        username: credential.username,
        changed,
        serviceActive: /(^|\n)active(\r?\n|$)/.test(result.stdout),
      },
    })
    return { ok: true, changed, rebootNeeded: changed }
  } catch (error) {
    addCheck(checks, "linux_guest_ssh", false, safeError(error), {
      evidence: { host: credential.host, username: credential.username },
    })
    return { ok: false, changed: false, rebootNeeded: false }
  }
}

async function repairLinuxGuestViaAgent(
  node: NonNullable<ProxmoxNodeRow>,
  vps: VpsRow,
  client: ReturnType<typeof createProxmoxClient>,
  checks: ConsoleCheck[],
  timeoutMs: number,
) {
  const script = buildLinuxSerialRepairScript()
  const encodedScript = Buffer.from(script, "utf8").toString("base64")
  const commandScript = `printf %s ${shellQuote(encodedScript)} | base64 -d | bash`
  try {
    const started = await client.execVMGuestCommand(node.nodeName, vps.vmid, ["/bin/bash", "-lc", commandScript])
    const pid = Number(started?.pid)
    if (!Number.isInteger(pid)) throw new Error("Guest agent did not return an exec pid")
    const deadline = Date.now() + timeoutMs
    let status: any = null
    while (Date.now() < deadline) {
      status = await client.getVMGuestExecStatus(node.nodeName, vps.vmid, pid)
      if (status?.exited) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!status?.exited) throw new Error("Guest agent command timed out")
    const stdout = status["out-data"] ? Buffer.from(String(status["out-data"]), "base64").toString("utf8") : ""
    const stderr = status["err-data"] ? Buffer.from(String(status["err-data"]), "base64").toString("utf8") : ""
    if (Number(status.exitcode || 0) !== 0) throw new Error(`Guest agent command exited ${status.exitcode}: ${stderr || stdout}`)
    const hasCapturedOutput = Boolean(stdout || stderr || status["out-data"] || status["err-data"])
    const changed = hasCapturedOutput ? /zws_serial_changed=1/.test(stdout) : true
    addCheck(checks, "linux_guest_agent", true, "GRUB and serial getty verified through QEMU guest agent", {
      evidence: {
        pid,
        changed,
        outputCaptured: hasCapturedOutput,
        serviceActive: hasCapturedOutput ? /(^|\n)active(\r?\n|$)/.test(stdout) : null,
      },
    })
    return { ok: true, changed, rebootNeeded: changed }
  } catch (error) {
    addCheck(checks, "linux_guest_agent", false, safeError(error))
    return { ok: false, changed: false, rebootNeeded: false }
  }
}

function buildSerialCloudInit() {
  const script = buildLinuxSerialRepairScript()
  return [
    "#cloud-config",
    "bootcmd:",
    "  - |",
    ...script.split("\n").map((line) => `    ${line}`),
    "runcmd:",
    "  - systemctl enable --now serial-getty@ttyS0.service || true",
    "",
  ].join("\n")
}

function uploadSnippet(args: {
  host: string
  node: string
  storage: string
  filename: string
  content: string
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
  timeoutMs: number
}) {
  const base = normalizeProxmoxHost(args.host)
  const url = new URL(`/api2/json/nodes/${encodeURIComponent(args.node)}/storage/${encodeURIComponent(args.storage)}/upload`, `${base}/`)
  const boundary = `zws-console-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\nsnippets\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${args.filename.replace(/"/g, "")}"\r\nContent-Type: text/yaml\r\n\r\n`),
    Buffer.from(args.content, "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const transport = url.protocol === "https:" ? https : http
  return new Promise<void>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: buildProxmoxAuthorizationHeader(args.tokenId, args.tokenSecret),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payload.length,
          Accept: "application/json",
        },
        ...(url.protocol === "https:" ? { rejectUnauthorized: !args.allowInsecureTls } : {}),
        timeout: args.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) resolve()
          else reject(new Error(`Snippet upload failed (${res.statusCode}): ${raw.slice(0, 300)}`))
        })
      },
    )
    req.on("timeout", () => req.destroy(new Error("Snippet upload timed out")))
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

function uploadStorageFile(args: {
  host: string
  node: string
  storage: string
  filename: string
  contentType: "iso" | "vztmpl" | "backup" | "import"
  data: Buffer
  tokenId: string
  tokenSecret: string
  allowInsecureTls: boolean
  timeoutMs: number
}) {
  const base = normalizeProxmoxHost(args.host)
  const url = new URL(`/api2/json/nodes/${encodeURIComponent(args.node)}/storage/${encodeURIComponent(args.storage)}/upload`, `${base}/`)
  const boundary = `zws-console-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${args.contentType}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${args.filename.replace(/"/g, "")}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    args.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const transport = url.protocol === "https:" ? https : http
  return new Promise<void>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: buildProxmoxAuthorizationHeader(args.tokenId, args.tokenSecret),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": payload.length,
          Accept: "application/json",
        },
        ...(url.protocol === "https:" ? { rejectUnauthorized: !args.allowInsecureTls } : {}),
        timeout: args.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) resolve()
          else reject(new Error(`Storage upload failed (${res.statusCode}): ${raw.slice(0, 300)}`))
        })
      },
    )
    req.on("timeout", () => req.destroy(new Error("Storage upload timed out")))
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

function pickCloudInitDrive(config: Record<string, any>) {
  const entry = Object.entries(config).find(([key, value]) => /^(ide|sata|scsi|virtio)\d+$/.test(key) && /cloudinit|media=cdrom/i.test(String(value || "")))
  return entry?.[0] || "ide2"
}

export function pickSeedIsoDrive(config: Record<string, any>) {
  for (const prefix of ["ide", "sata", "scsi"] as const) {
    for (let index = 0; index <= 5; index += 1) {
      const key = `${prefix}${index}`
      if (!text(config[key])) return key
    }
  }
  return null
}

function nextCicustomValue(existing: unknown, userSnippet: string) {
  const parts = String(existing || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith("user="))
  return [`user=${userSnippet}`, ...parts].join(",")
}

/**
 * The cloud-init snippet path is gone.
 *
 * It uploaded a `#cloud-config` snippet, attached it via `cicustom` and ran
 * `qm cloudinit update`. That made console repair depend on Cloud-Init being
 * present and working, which is exactly the dependency this change removes — and
 * it ran only when both SSH and the guest agent had already failed, so it was
 * repairing a guest the platform could otherwise not reach at all.
 *
 * There is now nothing to do here beyond recording why the path is unavailable.
 * A guest with no agent cannot be repaired by guest automation, and the seed ISO
 * fallback below is the last remaining option.
 */
function reportCloudInitPathUnavailable(checks: ConsoleCheck[]) {
  addCheck(checks, "linux_guest_cloudinit", false, "Console repair via cloud-init has been removed: guest automation uses the QEMU guest agent only", {
    evidence: { removedAt: "guest-automation-v2", replacement: "linux_guest_agent" },
  })
}

/**
 * The NoCloud seed-ISO repair is gone.
 *
 * It built a `user-data`/`meta-data` pair, burned it into a `CIDATA` ISO and
 * attached it to a customer's VM. That is cloud-init — a different mechanism from
 * the one this platform now uses, reached only when both SSH and the guest agent
 * had already failed.
 *
 * It is removed rather than kept as a last resort because it is exactly the
 * dependency this work exists to eliminate: a guest that has been left with a
 * Cloud-Init ISO attached, on a platform that does not configure guests that way,
 * is a guest whose real state nobody can reason about. A guest the guest agent
 * cannot reach is reported as such, which is an honest answer; a silent
 * Cloud-Init injection is not.
 */
function reportSeedIsoPathUnavailable(checks: ConsoleCheck[]) {
  addCheck(checks, "linux_guest_seed_iso", false, "Console repair via a Cloud-Init seed ISO has been removed: guest automation uses the QEMU guest agent only", {
    evidence: { removedAt: "guest-automation-v2", replacement: "linux_guest_agent" },
  })
}

function wsBuffer(data: WebSocket.RawData) {
  if (Array.isArray(data)) return Buffer.concat(data.map((item) => Buffer.from(item as any)))
  return Buffer.from(data as any)
}

function frameXtermInputText(input: string) {
  return `0:${Buffer.byteLength(input, "utf8")}:${input}`
}

function consoleUserFromToken(tokenId: string) {
  return String(tokenId || "").trim() || "root@pam"
}

function serialValidation(args: {
  url: string
  authorization: string
  allowInsecureTls: boolean
  termUser: string
  termTicket: string
  username?: string
  password?: string
  timeoutMs: number
}) {
  return new Promise<{ ok: boolean; loginPrompt: boolean; inputAccepted: boolean; outputReturned: boolean; transcript: string; message?: string }>((resolve) => {
    let transcript = ""
    let state: "wait_login" | "wait_password" | "wait_shell" | "wait_echo" = "wait_login"
    let authOk = false
    let settled = false
    let blindLoginTimer: NodeJS.Timeout | null = null
    const ws = new WebSocket(args.url, {
      headers: { Authorization: args.authorization },
      rejectUnauthorized: !args.allowInsecureTls,
    })
    const finish = (result: { ok: boolean; message?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(tickle)
      if (blindLoginTimer) clearTimeout(blindLoginTimer)
      try {
        ws.close()
      } catch {}
      resolve({
        ok: result.ok,
        loginPrompt: LOGIN_PROMPT_RE.test(transcript),
        inputAccepted: transcript.includes(args.username || "root") || transcript.includes(TEST_MARKER),
        outputReturned: transcript.includes(TEST_MARKER),
        transcript: transcript.slice(-2000),
        message: result.message,
      })
    }
    const timeout = setTimeout(() => finish({ ok: false, message: "Timed out waiting for serial login/output" }), args.timeoutMs)
    const tickle = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && authOk) ws.send(frameXtermInputText("\r"))
    }, 2500)

    ws.on("open", () => ws.send(`${args.termUser}:${args.termTicket}\n`))
    ws.on("message", (data) => {
      let chunk = wsBuffer(data)
      if (!authOk) {
        if (chunk[0] === 79 && chunk[1] === 75) {
          authOk = true
          chunk = chunk.subarray(2)
          ws.send(frameXtermInputText("\r"))
          if (args.username && args.password) {
            blindLoginTimer = setTimeout(() => {
              if (settled || state !== "wait_login" || ws.readyState !== WebSocket.OPEN) return
              ws.send(frameXtermInputText(`\r${args.username}\r`))
              setTimeout(() => {
                if (settled || state !== "wait_login" || ws.readyState !== WebSocket.OPEN) return
                ws.send(frameXtermInputText(`${args.password}\r`))
              }, 1000)
              setTimeout(() => {
                if (settled || state !== "wait_login" || ws.readyState !== WebSocket.OPEN) return
                ws.send(frameXtermInputText(`echo ${TEST_MARKER}\r`))
              }, 3000)
            }, 7000)
          }
        } else {
          finish({ ok: false, message: `Serial websocket authentication failed: ${redactConsoleSecret(chunk.toString("utf8")).slice(0, 200)}` })
          return
        }
      }
      transcript += chunk.toString("utf8")
      const tail = transcript.slice(-1200)
      if (state === "wait_login" && LOGIN_PROMPT_RE.test(tail)) {
        if (!args.username || !args.password) {
          finish({ ok: true, message: "Login prompt visible; no stored credentials for command echo validation" })
          return
        }
        ws.send(frameXtermInputText(`${args.username}\r`))
        state = "wait_password"
        return
      }
      if (state === "wait_password" && PASSWORD_PROMPT_RE.test(tail)) {
        ws.send(frameXtermInputText(`${args.password}\r`))
        state = "wait_shell"
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN && state === "wait_shell") {
            ws.send(frameXtermInputText(`echo ${TEST_MARKER}\r`))
            state = "wait_echo"
          }
        }, 1500)
        return
      }
      if ((state === "wait_shell" || state === "wait_echo") && transcript.includes(TEST_MARKER)) {
        finish({ ok: true })
      }
    })
    ws.on("unexpected-response", (_request, response) => finish({ ok: false, message: `HTTP ${response.statusCode}` }))
    ws.on("error", (error) => finish({ ok: false, message: safeError(error) }))
    ws.on("close", (code) => {
      if (!settled) finish({ ok: false, message: `Serial websocket closed ${code}` })
    })
  })
}

async function validateSerial(node: NonNullable<ProxmoxNodeRow>, vps: VpsRow, vmConfig: Record<string, any>, checks: ConsoleCheck[], timeoutMs: number) {
  let ticket: ProxmoxTermProxyTicket
  try {
    ticket = await createProxmoxTermProxy({
      host: node.host,
      node: node.nodeName,
      vmid: vps.vmid,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      serial: pickSerial(vmConfig),
      allowInsecureTls: node.allowInsecureTls,
    })
    addCheck(checks, "termproxy", true, "termproxy returned a ticket", { evidence: { port: ticket.port, hasTicket: Boolean(ticket.ticket), user: ticket.user || null } })
    addCheck(checks, "VM.Console", true, "Serial console ticket created")
  } catch (error) {
    addCheck(checks, "termproxy", false, safeError(error))
    return false
  }

  const credential = credentialFor(vps)
  const url = buildProxmoxConsoleWebSocketUrl({
    host: node.host,
    node: node.nodeName,
    vmid: vps.vmid,
    port: ticket.port,
    vncTicket: ticket.ticket,
  })
  const result = await serialValidation({
    url,
    authorization: buildProxmoxAuthorizationHeader(node.tokenId, node.tokenSecret),
    allowInsecureTls: node.allowInsecureTls,
    termUser: ticket.user || consoleUserFromToken(node.tokenId),
    termTicket: ticket.ticket,
    username: credential.username,
    password: credential.password,
    timeoutMs,
  })
  const ok = result.ok && result.outputReturned
  addCheck(checks, "serial_end_to_end", ok, result.message || "Serial login and echo validated", {
    evidence: {
      loginPrompt: result.loginPrompt,
      inputAccepted: result.inputAccepted,
      outputReturned: result.outputReturned,
      transcript: redactConsoleSecret(result.transcript),
    },
  })
  return ok
}

async function vncDesResponse(password: string, challenge: Buffer) {
  const desPath = pathToFileURL(path.join(process.cwd(), "node_modules/@novnc/novnc/core/crypto/des.js")).href
  const mod = await import(desPath)
  const key = password.split("").map((char) => char.charCodeAt(0))
  const cipher = (mod.DESECBCipher as any).importKey(key, { name: "DES-ECB" }, false, ["encrypt"])
  return Buffer.from(cipher.encrypt({ name: "DES-ECB" }, challenge))
}

function readU16(buffer: Buffer, offset: number) {
  return buffer.readUInt16BE(offset)
}

function readS32(buffer: Buffer, offset: number) {
  return buffer.readInt32BE(offset)
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

function countNonZeroFrameBytes(frame: Buffer) {
  const step = Math.max(1, Math.floor(frame.length / 65536))
  let nonZero = 0
  for (let index = 0; index < frame.length; index += step) {
    if (frame[index] !== 0) nonZero += 1
  }
  return nonZero
}

function vncFramebufferProbe(args: {
  url: string
  authorization: string
  allowInsecureTls: boolean
  ticket: string
  timeoutMs: number
}) {
  return new Promise<{ ok: boolean; visible: boolean; width?: number; height?: number; nonZeroSampleBytes?: number; message?: string }>((resolve) => {
    let buffer = Buffer.alloc(0)
    let state: "protocol" | "security_types" | "challenge" | "security_result" | "server_init" | "framebuffer" = "protocol"
    let width = 0
    let height = 0
    let bpp = 4
    let settled = false
    const ws = new WebSocket(args.url, {
      headers: { Authorization: args.authorization },
      rejectUnauthorized: !args.allowInsecureTls,
    })
    const finish = (result: { ok: boolean; visible: boolean; message?: string; nonZeroSampleBytes?: number }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        ws.close()
      } catch {}
      resolve({ width, height, ...result })
    }
    const timeout = setTimeout(() => finish({ ok: false, visible: false, message: "Timed out waiting for VNC framebuffer" }), args.timeoutMs)
    const send = (bytes: Buffer) => ws.send(bytes, { binary: true })

    const pump = async () => {
      try {
        while (!settled) {
          if (state === "protocol") {
            if (buffer.length < 12) return
            const version = buffer.subarray(0, 12)
            buffer = buffer.subarray(12)
            if (!version.toString("ascii").startsWith("RFB")) {
              finish({ ok: false, visible: false, message: "RFB protocol header missing" })
              return
            }
            send(version)
            state = "security_types"
          } else if (state === "security_types") {
            if (buffer.length < 1) return
            const count = buffer[0]
            if (buffer.length < 1 + count) return
            const types = Array.from(buffer.subarray(1, 1 + count))
            buffer = buffer.subarray(1 + count)
            if (!types.includes(2)) {
              finish({ ok: false, visible: false, message: `VNC auth security type missing (${types.join(",") || "none"})` })
              return
            }
            send(Buffer.from([2]))
            state = "challenge"
          } else if (state === "challenge") {
            if (buffer.length < 16) return
            const challenge = buffer.subarray(0, 16)
            buffer = buffer.subarray(16)
            send(await vncDesResponse(args.ticket, challenge))
            state = "security_result"
          } else if (state === "security_result") {
            if (buffer.length < 4) return
            const status = buffer.readUInt32BE(0)
            buffer = buffer.subarray(4)
            if (status !== 0) {
              finish({ ok: false, visible: false, message: `VNC authentication failed (${status})` })
              return
            }
            send(Buffer.from([1]))
            state = "server_init"
          } else if (state === "server_init") {
            if (buffer.length < 24) return
            width = readU16(buffer, 0)
            height = readU16(buffer, 2)
            bpp = Math.max(1, Math.floor(buffer[4] / 8))
            const nameLength = buffer.readUInt32BE(20)
            if (buffer.length < 24 + nameLength) return
            buffer = buffer.subarray(24 + nameLength)
            const enc = Buffer.alloc(8)
            enc[0] = 2
            enc.writeUInt16BE(1, 2)
            enc.writeInt32BE(0, 4)
            send(enc)
            const centerX = Math.max(1, Math.floor(width / 2))
            const centerY = Math.max(1, Math.floor(height / 2))
            send(rfbPointerEvent(centerX, centerY))
            send(rfbPointerEvent(centerX + 8, centerY + 8))
            send(rfbKeyEvent(0xff0d, true))
            send(rfbKeyEvent(0xff0d, false))
            const req = Buffer.alloc(10)
            req[0] = 3
            req[1] = 0
            req.writeUInt16BE(0, 2)
            req.writeUInt16BE(0, 4)
            req.writeUInt16BE(width, 6)
            req.writeUInt16BE(height, 8)
            send(req)
            state = "framebuffer"
          } else if (state === "framebuffer") {
            if (buffer.length < 4) return
            if (buffer[0] !== 0) {
              buffer = buffer.subarray(1)
              continue
            }
            const rects = readU16(buffer, 2)
            let offset = 4
            let nonZero = 0
            for (let i = 0; i < rects; i += 1) {
              if (buffer.length < offset + 12) return
              const rectWidth = readU16(buffer, offset + 4)
              const rectHeight = readU16(buffer, offset + 6)
              const encoding = readS32(buffer, offset + 8)
              offset += 12
              if (encoding !== 0) {
                finish({ ok: true, visible: false, message: `Unsupported framebuffer encoding ${encoding}` })
                return
              }
              const length = rectWidth * rectHeight * bpp
              if (buffer.length < offset + length) return
              nonZero += countNonZeroFrameBytes(buffer.subarray(offset, offset + length))
              offset += length
            }
            finish({
              ok: true,
              visible: nonZero > 0,
              nonZeroSampleBytes: nonZero,
              message: nonZero > 0 ? "Framebuffer returned non-black sample bytes" : "Framebuffer sample was all zero/black",
            })
          }
        }
      } catch (error) {
        finish({ ok: false, visible: false, message: safeError(error) })
      }
    }
    ws.on("message", (data) => {
      buffer = Buffer.concat([buffer, wsBuffer(data)])
      void pump()
    })
    ws.on("unexpected-response", (_request, response) => finish({ ok: false, visible: false, message: `HTTP ${response.statusCode}` }))
    ws.on("error", (error) => finish({ ok: false, visible: false, message: safeError(error) }))
    ws.on("close", (code) => {
      if (!settled) finish({ ok: false, visible: false, message: `VNC websocket closed ${code}` })
    })
  })
}

async function validateVnc(node: NonNullable<ProxmoxNodeRow>, vps: VpsRow, checks: ConsoleCheck[], timeoutMs: number) {
  try {
    const ticket = await createProxmoxVncProxy({
      host: node.host,
      node: node.nodeName,
      vmid: vps.vmid,
      tokenId: node.tokenId,
      tokenSecret: node.tokenSecret,
      allowInsecureTls: node.allowInsecureTls,
    })
    addCheck(checks, "vncproxy", true, "vncproxy returned a ticket", { evidence: { port: ticket.port, hasTicket: Boolean(ticket.ticket) } })
    addCheck(checks, "VM.Console", true, "VNC console ticket created")
    const url = buildProxmoxConsoleWebSocketUrl({
      host: node.host,
      node: node.nodeName,
      vmid: vps.vmid,
      port: ticket.port,
      vncTicket: ticket.ticket,
    })
    const frame = await vncFramebufferProbe({
      url,
      ticket: ticket.ticket,
      authorization: buildProxmoxAuthorizationHeader(node.tokenId, node.tokenSecret),
      allowInsecureTls: node.allowInsecureTls,
      timeoutMs,
    })
    addCheck(checks, "vnc_framebuffer", Boolean(frame.ok && frame.visible), frame.message, {
      evidence: {
        width: frame.width,
        height: frame.height,
        nonZeroSampleBytes: frame.nonZeroSampleBytes,
        visible: frame.visible,
      },
    })
  } catch (error) {
    addCheck(checks, "vncproxy", false, safeError(error))
  }
}

async function auditNodePermissions(node: NonNullable<ProxmoxNodeRow>, client: ReturnType<typeof createProxmoxClient>, checks: ConsoleCheck[]) {
  await Promise.all([
    client.getVMList(node.nodeName).then(
      (rows) => addCheck(checks, "VM.Audit", true, "VM inventory readable", { evidence: { count: rows.length } }),
      (error) => addCheck(checks, "VM.Audit", false, safeError(error)),
    ),
    client.getNodeStats(node.nodeName).then(
      () => addCheck(checks, "Node.Audit", true, "Node status readable"),
      (error) => addCheck(checks, "Node.Audit", false, safeError(error)),
    ),
    client.getNodeStorage(node.nodeName).then(
      () => addCheck(checks, "Datastore.Audit", true, "Node storage readable"),
      (error) => addCheck(checks, "Datastore.Audit", false, safeError(error)),
    ),
    client.getClusterLog(80).then(
      (rows) => {
        const messages = rows.map((row: any) => text(row?.msg || row?.message)).filter(Boolean)
        const consoleMessages = messages.filter((message) => /vncproxy|termproxy|vncwebsocket|pvedaemon|pveproxy|failed reading ticket|console/i.test(message)).slice(0, 10)
        addCheck(checks, "Sys.Audit", true, "Cluster log readable", { evidence: { recent: messages.slice(0, 3).map((message) => message.slice(0, 160)), console: consoleMessages.map((message) => message.slice(0, 220)) } })
      },
      (error) => addCheck(checks, "Sys.Audit", false, safeError(error)),
    ),
    client.getNodeTasks(node.nodeName, 80).then(
      (rows) => {
        const recent = rows.slice(0, 8).map((row: any) => ({ id: row?.upid || row?.id || null, status: row?.status || null, type: row?.type || null }))
        const consoleTasks = rows
          .filter((row: any) => /vncproxy|termproxy|vncshell|console/i.test(String(row?.type || row?.upid || row?.id || "")))
          .slice(0, 10)
          .map((row: any) => ({ id: row?.upid || row?.id || null, status: row?.status || null, type: row?.type || null }))
        addCheck(checks, "task_logs", true, "Recent node tasks readable", { evidence: { recent, console: consoleTasks } })
      },
      (error) => addCheck(checks, "task_logs", false, safeError(error)),
    ),
  ])
}

async function waitForVmRunning(client: ReturnType<typeof createProxmoxClient>, nodeName: string, vmid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const runtime = await client.getVMStatus(nodeName, vmid).catch(() => null)
    if (String(runtime?.status || "").toLowerCase() === "running") return runtime
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  return null
}

async function auditVm(node: NonNullable<ProxmoxNodeRow>, vps: VpsRow, options: ConsoleRepairOptions): Promise<ConsoleVmReport> {
  const checks: ConsoleCheck[] = []
  const repairs: string[] = []
  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
  const timeoutMs = options.timeoutMs || 25000
  const managed = vps.managed !== false && !String(vps.id || "").startsWith("unmanaged:")
  const canRepair = Boolean(options.apply && managed)
  let runtime: any = null
  let vmConfig: Record<string, any> = {}
  let family: GuestFamily = "unknown"

  try {
    runtime = await client.getVMStatus(node.nodeName, vps.vmid)
    addCheck(checks, "VM.Monitor", true, "VM runtime status readable", { evidence: { status: runtime?.status || "unknown" } })
  } catch (error) {
    addCheck(checks, "VM.Monitor", false, safeError(error))
  }

  try {
    vmConfig = await client.getVMConfig(node.nodeName, vps.vmid)
    family = classifyGuestFamily({
      osName: vps.operatingSystem?.name || vps.order?.osName,
      osFamily: vps.operatingSystem?.osFamily,
      consoleType: vps.consoleType,
      vmOsFamily: vps.vmOsFamily,
      config: vmConfig,
    })
    addCheck(checks, "qm_config", true, "VM config readable", {
      evidence: {
        serial0: vmConfig.serial0 || null,
        vga: vmConfig.vga || null,
        agent: vmConfig.agent || null,
        machine: vmConfig.machine || null,
        bios: vmConfig.bios || null,
        sockets: vmConfig.sockets || null,
        cores: vmConfig.cores || null,
        memory: vmConfig.memory || null,
      },
    })
  } catch (error) {
    addCheck(checks, "qm_config", false, safeError(error))
  }

  let running = String(runtime?.status || "").toLowerCase() === "running"
  if (!running) {
    if (canRepair && String(vps.status || "").toUpperCase() === "ACTIVE") {
      try {
        await client.startVM(node.nodeName, vps.vmid)
        repairs.push("start active VM for console validation")
        runtime = await waitForVmRunning(client, node.nodeName, vps.vmid, Math.max(timeoutMs, 60000))
        running = Boolean(runtime)
        addCheck(checks, "VM.PowerMgmt.start", running, running ? "VM started for console validation" : "VM did not reach running state after start")
      } catch (error) {
        addCheck(checks, "VM.PowerMgmt.start", false, safeError(error))
      }
    }
    if (!running) {
      addCheck(checks, "running", false, "VM is not running", { skipped: true })
    }
  }
  if (running) {
    addCheck(checks, "running", true, "VM is running")
  }

  if (family === "linux") {
    const patch = linuxSerialPatch(vmConfig)
    if (Object.keys(patch).length) {
      if (canRepair) {
        try {
          await client.updateVMConfig(node.nodeName, vps.vmid, patch)
          repairs.push(`set ${Object.entries(patch).map(([key, value]) => `${key}=${value}`).join(",")}`)
          addCheck(checks, "serial0_config", true, "serial0 repaired through Proxmox API", { evidence: patch })
          vmConfig = { ...vmConfig, ...patch }
        } catch (error) {
          addCheck(checks, "serial0_config", false, safeError(error), { evidence: patch })
        }
      } else {
        addCheck(checks, "serial0_config", false, "serial0 repair needed", { evidence: patch })
      }
    } else {
      addCheck(checks, "serial0_config", true, "serial0 socket is present")
    }

    let guestReboot = false
    if (running && canRepair && options.validateGuest !== false) {
      const guest = await repairLinuxGuestViaSsh(vps, checks, timeoutMs)
      guestReboot = guest.rebootNeeded
      if (!guest.ok) {
        const agent = await repairLinuxGuestViaAgent(node, vps, client, checks, timeoutMs)
        guestReboot = guestReboot || agent.rebootNeeded
        if (agent.ok) {
          repairs.push("repair linux serial console through QEMU guest agent")
        } else {
          // Both remaining fallbacks are removed. A guest the agent cannot
          // reach is reported as unreachable, which is the answer.
          reportCloudInitPathUnavailable(checks)
          reportSeedIsoPathUnavailable(checks)
          addCheck(
            checks,
            "linux_guest_reachability",
            false,
            "Neither SSH nor the guest agent could reach this guest, so the console cannot be repaired from the panel",
            { evidence: { vmid: vps.vmid, remedy: "Open the hypervisor console directly, or install the QEMU guest agent in the image." } },
          )
        }
      }
    } else {
      addCheck(checks, "linux_guest_ssh", true, running ? "Guest repair skipped without --apply" : "Guest repair skipped because VM is offline", { skipped: true })
    }

    if (guestReboot) {
      try {
        await client.rebootVM(node.nodeName, vps.vmid)
        repairs.push("reboot linux guest after GRUB serial update")
        addCheck(checks, "VM.PowerMgmt", true, "Linux VM reboot requested")
        runtime = await waitForVmRunning(client, node.nodeName, vps.vmid, Math.max(timeoutMs, 60000))
        running = Boolean(runtime)
      } catch (error) {
        addCheck(checks, "VM.PowerMgmt", false, safeError(error))
      }
    }
    if (running) {
      const serialOk = await validateSerial(node, vps, vmConfig, checks, timeoutMs)
      if (!serialOk && canRepair && !guestReboot) {
        try {
          await client.rebootVM(node.nodeName, vps.vmid)
          repairs.push("reboot linux guest after failed serial validation")
          addCheck(checks, "VM.PowerMgmt.serial_retry", true, "Linux VM reboot requested after failed serial validation")
          runtime = await waitForVmRunning(client, node.nodeName, vps.vmid, Math.max(timeoutMs, 60000))
          running = Boolean(runtime)
          if (running) await validateSerial(node, vps, vmConfig, checks, timeoutMs)
        } catch (error) {
          addCheck(checks, "VM.PowerMgmt.serial_retry", false, safeError(error))
        }
      }
    } else {
      addCheck(checks, "serial_end_to_end", false, "Serial validation skipped because VM is offline", { skipped: true })
    }
  } else if (family === "windows") {
    const patch = windowsDisplayPatch(vmConfig)
    if (Object.keys(patch).length) {
      if (canRepair) {
        try {
          await client.updateVMConfig(node.nodeName, vps.vmid, patch)
          repairs.push(`set vga=${patch.vga}`)
          addCheck(checks, "vga_config", true, "Windows display repaired through Proxmox API", { evidence: patch })
          try {
            await client.rebootVM(node.nodeName, vps.vmid)
            repairs.push("reboot windows guest after display update")
            addCheck(checks, "VM.PowerMgmt", true, "Windows VM reboot requested")
            await new Promise((resolve) => setTimeout(resolve, 8000))
          } catch (error) {
            addCheck(checks, "VM.PowerMgmt", false, `Graceful reboot failed: ${safeError(error)}`)
            try {
              await client.resetVM(node.nodeName, vps.vmid)
              repairs.push("reset windows guest after display update")
              addCheck(checks, "VM.PowerMgmt.reset", true, "Windows VM reset requested after reboot failure")
              await new Promise((resolve) => setTimeout(resolve, 8000))
            } catch (resetError) {
              addCheck(checks, "VM.PowerMgmt.reset", false, safeError(resetError))
            }
          }
          vmConfig = { ...vmConfig, ...patch }
        } catch (error) {
          addCheck(checks, "vga_config", false, safeError(error), { evidence: patch })
        }
      } else {
        addCheck(checks, "vga_config", false, "Windows display repair needed", { evidence: patch })
      }
    } else {
      addCheck(checks, "vga_config", true, "Windows display config is compatible")
    }
    if (running) await validateVnc(node, vps, checks, timeoutMs)
    else addCheck(checks, "vnc_framebuffer", false, "VNC validation skipped because VM is offline", { skipped: true })
  } else {
    addCheck(checks, "console_family", false, "Could not determine guest family")
  }

  const success = checks.every((check) => check.ok || check.skipped)
  return {
    vpsId: vps.id,
    vmid: vps.vmid,
    name: vps.name,
    managed,
    nodeId: node.id,
    nodeName: node.nodeName,
    family,
    panelStatus: vps.status,
    runtimeStatus: String(runtime?.status || "unknown"),
    config: {
      serial0: vmConfig.serial0 || null,
      vga: vmConfig.vga || null,
      agent: vmConfig.agent || null,
      machine: vmConfig.machine || null,
      bios: vmConfig.bios || null,
      sockets: vmConfig.sockets || null,
      cores: vmConfig.cores || null,
      memory: vmConfig.memory || null,
    },
    repairs,
    checks,
    success,
  }
}

export async function runConsoleAudit(options: ConsoleRepairOptions = {}): Promise<ConsoleAuditReport> {
  const rows = await loadVpsRows(options)
  const nodes = await loadProxmoxNodes(options)
  const reports: ConsoleNodeReport[] = []
  for (const node of nodes) {
    const nodeChecks: ConsoleCheck[] = []
    const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, { allowInsecureTls: node.allowInsecureTls })
    await auditNodePermissions(node, client, nodeChecks)
    let qemuRows: any[] = []
    try {
      qemuRows = await client.getVMList(node.nodeName)
    } catch (error) {
      addCheck(nodeChecks, "qemu_inventory", false, safeError(error))
    }
    if (options.vmid) qemuRows = qemuRows.filter((row) => Number(row?.vmid) === options.vmid)

    const managedRows = rows.filter((row) => row.proxmoxNodeId === node.id)
    const managedByVmid = new Map<number, VpsRow>(managedRows.map((row) => [Number(row.vmid), { ...row, managed: true }]))
    const qemuEntries = qemuRows
      .map((row): [number, any] => [Number(row?.vmid), row])
      .filter((entry): entry is [number, any] => Number.isInteger(entry[0]))
    const qemuByVmid = new Map<number, any>(qemuEntries)
    for (const row of managedRows) {
      if (!qemuByVmid.has(Number(row.vmid))) qemuByVmid.set(Number(row.vmid), { vmid: row.vmid, name: row.name })
    }

    const vms: ConsoleVmReport[] = []
    const targets = Array.from(qemuByVmid.entries())
      .sort(([left], [right]) => left - right)
      .map(([vmid, qemu]) => managedByVmid.get(vmid) || syntheticVpsForQemu(node, qemu))
    for (const vps of targets) {
      vms.push(await auditVm(node, vps, options))
    }
    reports.push({
      node: {
        id: node.id,
        name: node.name,
        nodeName: node.nodeName,
        host: node.host,
        status: node.status,
      },
      checks: nodeChecks,
      vms,
      success: nodeChecks.every((check) => check.ok || check.skipped) && vms.every((vm) => vm.success),
    })
  }
  return {
    generatedAt: new Date().toISOString(),
    apply: Boolean(options.apply),
    nodes: reports,
    success: reports.every((node) => node.success),
  }
}

export function parseConsoleRepairArgs(argv: string[]): ConsoleRepairOptions {
  const options: ConsoleRepairOptions = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--apply") options.apply = true
    else if (arg === "--json") options.json = true
    else if (arg === "--skip-guest") options.validateGuest = false
    else if (arg === "--vmid") options.vmid = Number(argv[++index])
    else if (arg.startsWith("--vmid=")) options.vmid = Number(arg.slice("--vmid=".length))
    else if (arg === "--node-id") options.nodeId = argv[++index]
    else if (arg.startsWith("--node-id=")) options.nodeId = arg.slice("--node-id=".length)
    else if (arg === "--timeout-ms") options.timeoutMs = Number(argv[++index])
    else if (arg.startsWith("--timeout-ms=")) options.timeoutMs = Number(arg.slice("--timeout-ms=".length))
  }
  return options
}

export function printConsoleReport(report: ConsoleAuditReport, json = false) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`Console audit ${report.success ? "PASS" : "FAIL"} apply=${report.apply} generatedAt=${report.generatedAt}`)
  for (const node of report.nodes) {
    console.log(`\nNode ${node.node.name} (${node.node.host}) ${node.success ? "PASS" : "FAIL"}`)
    for (const check of node.checks) console.log(`  ${check.ok ? "PASS" : check.skipped ? "SKIP" : "FAIL"} ${check.name}${check.message ? ` - ${check.message}` : ""}`)
    for (const vm of node.vms) {
      console.log(`  VM ${vm.vmid} ${vm.name} family=${vm.family} runtime=${vm.runtimeStatus} ${vm.success ? "PASS" : "FAIL"}`)
      for (const repair of vm.repairs) console.log(`    REPAIR ${repair}`)
      for (const check of vm.checks) console.log(`    ${check.ok ? "PASS" : check.skipped ? "SKIP" : "FAIL"} ${check.name}${check.message ? ` - ${check.message}` : ""}`)
    }
  }
}
