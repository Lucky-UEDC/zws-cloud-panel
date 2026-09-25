import { prisma } from "@/lib/db"
import { createProxmoxClient, ProxmoxError } from "@/lib/proxmox"
import { encryptSecret } from "@/lib/provision"
import { writeAuditLog } from "@/lib/audit-log"

export type PasswordRotationState = "not_started" | "running" | "success" | "failed" | "guest_agent_unavailable"

export type GuestPasswordRotationResult = {
  state: PasswordRotationState
  ok: boolean
  message: string
  username?: string
  method?: "chpasswd" | "set-local-user"
  guestCommandExitCode?: number | null
  storedCredentialUpdated: boolean
  lastChangedAt: string | null
}

function windowsHint(value: unknown): boolean {
  const text = [value].filter((v) => v != null).map((v) => String(v)).join(" ").toLowerCase()
  return /\bwindows\b|winserver|win-server|server\s*20\d{2}/i.test(text)
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

async function persistRotationState(vpsId: string, update: Record<string, unknown>) {
  const current = await prisma.vpsInstance.findUnique({ where: { id: vpsId }, select: { lifecycleMetadata: true } }).catch(() => null)
  const meta = asObj(current?.lifecycleMetadata)
  await prisma.vpsInstance.update({
    where: { id: vpsId },
    data: { lifecycleMetadata: { ...meta, passwordRotation: { ...asObj(meta.passwordRotation), ...update } } as any },
  }).catch(() => null)
}

export async function getPasswordRotationStatus(input: {
  vpsId: string
}): Promise<{
  state: PasswordRotationState
  lastChangedAt: string | null
  method?: string
  username?: string | null
  guestAgentPending?: boolean
}> {
  const vps = await prisma.vpsInstance.findUnique({ where: { id: input.vpsId }, select: { lifecycleMetadata: true } }).catch(() => null)
  const rotation = asObj((vps?.lifecycleMetadata as any)?.passwordRotation) || {}
  const state = String(rotation.state || "not_started") as PasswordRotationState
  const lastChangedAt = typeof rotation.lastChangedAt === "string" ? rotation.lastChangedAt : null

  let running = false
  try {
    const latest = await prisma.auditLog.findFirst({
      where: { action: "vm.password.rotation_started", metadata: { path: ["vpsInstanceId"], equals: input.vpsId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }).catch(() => null)
    running = Boolean(latest && Date.now() - new Date(latest.createdAt).getTime() < 5 * 60 * 1000)
  } catch {
    running = false
  }

  const inFlight = running && (state === "not_started" || state === "running")
  return {
    state: inFlight ? "running" : state,
    lastChangedAt,
    method: typeof rotation.method === "string" ? rotation.method : undefined,
    username: typeof rotation.username === "string" ? rotation.username : null,
    guestAgentPending: inFlight,
  }
}

const ADMIN_USER_CANDIDATES = ["root", "admin", "ubuntu", "debian", "cloud-user", "administrator"]

async function resolveLinuxAdminUser(input: { client: any; nodeName: string; vmid: number; storedUsername?: string | null }): Promise<string | null> {
  const candidates: string[] = []
  if (input.storedUsername) candidates.push(input.storedUsername)
  for (const candidate of ADMIN_USER_CANDIDATES) {
    if (!candidates.includes(candidate)) candidates.push(candidate)
  }

  for (const candidate of candidates) {
    if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(candidate)) continue
    try {
      const exec = await input.client.execVMGuestCommand(input.nodeName, input.vmid, ["getent", "passwd", candidate])
      if (exec && Number(exec.pid) > 0) {
        const status = await pollGuestExecStatus(input.client, input.nodeName, input.vmid, Number(exec.pid), 10_000)
        if (String(status?.exitcode) === "0") return candidate
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

async function pollGuestExecStatus(client: any, nodeName: string, vmid: number, pid: number, timeoutMs: number) {
  const started = Date.now()
  let last: any = null
  while (Date.now() - started < timeoutMs) {
    try {
      last = await client.getVMGuestExecStatus(nodeName, vmid, pid)
      if (last?.exited || last?.exitcode !== undefined || last?.exit_code !== undefined) break
    } catch {
      // transient
    }
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  const exitcode = last?.exitcode ?? last?.exit_code
  return {
    exited: Boolean(last?.exited ?? (exitcode !== undefined)),
    exitcode: exitcode === undefined || exitcode === null ? null : Number(exitcode),
    outData: last?.outData ?? last?.out_data ?? "",
    errData: last?.errData ?? last?.err_data ?? "",
  }
}

export async function rotateGuestPassword(input: {
  vpsId: string
  customerId?: string | null
  node: { host: string; tokenId: string; tokenSecret: string; allowInsecureTls: boolean; nodeName: string }
  vmid: number
  password: string
  username?: string | null
  isWindows?: boolean
  osHint?: string | null
}): Promise<GuestPasswordRotationResult> {
  const { node, vmid, password } = input
  const startedAt = new Date().toISOString()
  const auditMeta: Record<string, unknown> = { vpsInstanceId: input.vpsId, method: "guest-exec", status: "running" }
  if (input.customerId) auditMeta["customerId"] = input.customerId

  writeAuditLog({
    action: "vm.password.rotation_started",
    customerId: input.customerId || null,
    targetType: "vps",
    targetId: input.vpsId,
    metadata: auditMeta,
  }).catch(() => null)
  await persistRotationState(input.vpsId, { state: "running", startedAt, username: input.username || null })

  const client = createProxmoxClient(node.host, node.tokenId, node.tokenSecret, {
    allowInsecureTls: node.allowInsecureTls,
  })

  const runtime = await client.getVMStatus(node.nodeName, Number(vmid)).catch(() => null)
  const runtimeStatus = String(runtime?.status || "").toLowerCase()
  if (runtimeStatus !== "running") {
    await persistRotationState(input.vpsId, { state: "failed", lastChangedAt: startedAt })
    writeAuditLog({
      action: "vm.password.rotation_failed",
      customerId: input.customerId || null,
      targetType: "vps",
      targetId: input.vpsId,
      metadata: { ...auditMeta, status: "failed", reason: "vm_not_running" },
    }).catch(() => null)
    return {
      state: "failed",
      ok: false,
      message: "The VM must be running to update the guest password automatically.",
      storedCredentialUpdated: false,
      lastChangedAt: null,
    }
  }

  let agentOnline = false
  try {
    await client.pingVMGuestAgent(node.nodeName, Number(vmid))
    agentOnline = true
  } catch {
    agentOnline = false
  }
  if (!agentOnline) {
    await persistRotationState(input.vpsId, { state: "guest_agent_unavailable", lastChangedAt: startedAt })
    writeAuditLog({
      action: "vm.password.rotation_failed",
      customerId: input.customerId || null,
      targetType: "vps",
      targetId: input.vpsId,
      metadata: { ...auditMeta, status: "failed", reason: "guest_agent_unavailable" },
    }).catch(() => null)
    return {
      state: "guest_agent_unavailable",
      ok: false,
      message: "QEMU Guest Agent is unavailable. Start or install the QEMU Guest Agent in the operating system, then retry.",
      storedCredentialUpdated: false,
      lastChangedAt: null,
    }
  }

  const guestWindows = input.isWindows || windowsHint(input.osHint)

  try {
    if (guestWindows) {
      const user = String(input.username || "Administrator")
      if (!/^[A-Za-z0-9_. \-]+$/.test(user)) throw new ProxmoxError(400, "Invalid Windows username token")
      const passwordArg = String(password).replace(/\\/g, "").replace(/'/g, "''")
      const command = [
        "powershell.exe",
        "-NoProfile",
        "-Command",
        `$p = ConvertTo-SecureString '${passwordArg}' -AsPlainText -Force; Set-LocalUser -Name '${user.replace(/'/g, "''")}' -Password $p; if ($LASTEXITCODE -eq 0) { exit 0 } else { exit 1 }`,
      ]
      const exec = await client.execVMGuestCommand(node.nodeName, Number(vmid), command)
      const result = await pollGuestExecStatus(client, node.nodeName, Number(vmid), Number(exec.pid), 30_000)
      const exitOk = result.exitcode === 0
      await persistRotationState(input.vpsId, {
        state: exitOk ? "success" : "failed",
        method: "set-local-user",
        username: user,
        lastChangedAt: new Date().toISOString(),
        guestCommandExitCode: result.exitcode,
        exited: result.exited,
      })
      writeAuditLog({
        action: exitOk ? "vm.password.rotated" : "vm.password.rotation_failed",
        customerId: input.customerId || null,
        targetType: "vps",
        targetId: input.vpsId,
        newValue: exitOk
          ? { username: user, method: "set-local-user", liveGuestChanged: true, storedCredentialUpdated: true }
          : undefined,
        metadata: exitOk
          ? { ...auditMeta, status: "success", username: user, method: "set-local-user", exitcode: result.exitcode, storedCredentialUpdated: true }
          : { ...auditMeta, status: "failed", username: user, method: "set-local-user", exitcode: result.exitcode, reason: "guest_command_failed" },
      }).catch(() => null)
      return {
        state: exitOk ? "success" : "failed",
        ok: exitOk,
        message: exitOk ? "Password updated inside the guest and stored credential synced." : "The guest command exited with an error; the stored credential was not changed.",
        username: user,
        method: "set-local-user",
        guestCommandExitCode: result.exitcode,
        storedCredentialUpdated: exitOk,
        lastChangedAt: exitOk ? new Date().toISOString() : null,
      }
    }

    const resolvedUser = await resolveLinuxAdminUser({ client, nodeName: node.nodeName, vmid: Number(vmid), storedUsername: input.username || (input.username === "root" ? "root" : input.username) })
    const user = resolvedUser || (input.username ? (/^[a-z_][a-z0-9_]*$/.test(input.username) ? input.username : "root") : "root")
    const inputLine = `${user}:${password}\n`
    const exec = await client.execVMGuestCommandWithInput(node.nodeName, Number(vmid), ["chpasswd"], inputLine)
    if (!exec || !Number(exec.pid)) throw new ProxmoxError(500, "Guest agent did not start the password command")
    const status = await pollGuestExecStatus(client, node.nodeName, Number(vmid), Number(exec.pid), 30_000)
    const exitOk = status.exitcode === 0

    if (exitOk) {
      const encrypted = encryptSecret(password)
      await prisma.vpsInstance.update({
        where: { id: input.vpsId },
        data: { username: user, adminUsername: user, passwordEncrypted: encrypted },
      }).catch(() => null)
    }

    await persistRotationState(input.vpsId, {
      state: exitOk ? "success" : "failed",
      method: "chpasswd",
      username: user,
      lastChangedAt: new Date().toISOString(),
      guestCommandExitCode: status.exitcode,
      exited: status.exited,
    })
    writeAuditLog({
      action: exitOk ? "vm.password.rotated" : "vm.password.rotation_failed",
      customerId: input.customerId || null,
      targetType: "vps",
      targetId: input.vpsId,
      newValue: exitOk
        ? { username: user, method: "chpasswd", liveGuestChanged: true, storedCredentialUpdated: true }
        : undefined,
      metadata: exitOk
        ? { ...auditMeta, status: "success", username: user, method: "chpasswd", exitcode: status.exitcode, storedCredentialUpdated: true }
        : { ...auditMeta, status: "failed", username: user, method: "chpasswd", exitcode: status.exitcode, reason: "guest_command_failed" },
    }).catch(() => null)

    return {
      state: exitOk ? "success" : "failed",
      ok: exitOk,
      message: exitOk
        ? "Password updated inside the guest and stored credential synced."
        : "The guest command exited with an error; the stored credential was not changed.",
      username: user,
      method: "chpasswd",
      guestCommandExitCode: status.exitcode,
      storedCredentialUpdated: exitOk,
      lastChangedAt: exitOk ? new Date().toISOString() : null,
    }
  } catch (error: any) {
    await persistRotationState(input.vpsId, { state: "failed", lastChangedAt: new Date().toISOString() })
    writeAuditLog({
      action: "vm.password.rotation_failed",
      customerId: input.customerId || null,
      targetType: "vps",
      targetId: input.vpsId,
      metadata: { ...auditMeta, status: "failed", reason: String(error?.message || "rotation_error") },
    }).catch(() => null)
    return {
      state: "failed",
      ok: false,
      message: String(error?.message || "Password rotation failed"),
      storedCredentialUpdated: false,
      lastChangedAt: null,
    }
  }
}