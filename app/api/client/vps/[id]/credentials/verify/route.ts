import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { decryptSecret } from "@/lib/provision"
import { createProxmoxVncProxy, getProxmoxPasswordTicket } from "@/lib/proxmox-vnc"
import { writeAuditLog } from "@/lib/audit-log"

export const runtime = "nodejs"

const VERIFIED = "VERIFIED"
const FAILED = "FAILED"

function isWindowsVps(vps: any) {
  const text = [
    vps?.operatingSystem?.name,
    vps?.operatingSystem?.slug,
    vps?.operatingSystem?.osType,
    vps?.operatingSystem?.category,
    vps?.operatingSystem?.osFamily,
    vps?.order?.osName,
  ].filter(Boolean).join(" ").toLowerCase()
  return /\bwindows\b|winserver|win-server|server\s*20\d{2}/i.test(text)
}

function safeDecrypt(value?: string | null) {
  if (!value) return ""
  try {
    return decryptSecret(value)
  } catch {
    return ""
  }
}

async function verifySshLogin(input: { host: string; username: string; password: string; timeoutMs?: number }) {
  const { Client: SshClient } = await import("ssh2")
  return new Promise<void>((resolve, reject) => {
    const client = new SshClient()
    const timer = setTimeout(() => {
      client.destroy()
      reject(new Error("SSH login timed out"))
    }, input.timeoutMs || 12_000)

    client
      .on("ready", () => {
        clearTimeout(timer)
        client.end()
        resolve()
      })
      .on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
      .connect({
        host: input.host,
        port: 22,
        username: input.username,
        password: input.password,
        readyTimeout: input.timeoutMs || 12_000,
        tryKeyboard: false,
      })
  })
}

async function persist(vpsId: string, status: typeof VERIFIED | typeof FAILED, message: string | null) {
  const now = new Date()
  await prisma.vpsInstance.update({
    where: { id: vpsId },
    data: {
      credentialVerificationStatus: status,
      credentialVerificationCheckedAt: now,
      credentialVerifiedAt: status === VERIFIED ? now : null,
      credentialVerificationMessage: message,
    },
  })
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
    include: { proxmoxNode: true, operatingSystem: true, order: { select: { osName: true } } },
  })
  if (!vps) return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })

  try {
    if (isWindowsVps(vps)) {
      if (!vps.proxmoxNode || !vps.vmid) throw new Error("Console validation unavailable")
      const username = String(process.env.PROXMOX_VNC_USER || "").trim()
      const password = String(process.env.PROXMOX_VNC_PASSWORD || "")
      if (!username || !password) throw new Error("Console credentials are not configured")
      const auth = await getProxmoxPasswordTicket({
        host: vps.proxmoxNode.host,
        username,
        password,
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      })
      await createProxmoxVncProxy({
        host: vps.proxmoxNode.host,
        node: vps.proxmoxNode.nodeName,
        vmid: vps.vmid,
        pveTicket: auth.ticket,
        csrf: auth.csrf,
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      })
      await persist(vps.id, VERIFIED, "windows_console_reachable")
      await writeAuditLog({ action: "client_console_credentials_validated", customerId, targetType: "vps", targetId: vps.id, metadata: { method: "windows_console" } })
      return NextResponse.json({ success: true, status: VERIFIED, label: "Verified" })
    }

    const host = String(vps.ipAddress || "").trim()
    const username = String(vps.username || vps.adminUsername || "root").trim()
    const password = safeDecrypt(vps.passwordEncrypted)
    if (!host || !username || !password) throw new Error("Credentials are incomplete")
    await verifySshLogin({ host, username, password })
    await persist(vps.id, VERIFIED, "ssh_login_success")
    await writeAuditLog({ action: "client_console_credentials_validated", customerId, targetType: "vps", targetId: vps.id, metadata: { method: "ssh" } })
    return NextResponse.json({ success: true, status: VERIFIED, label: "Verified" })
  } catch (error: any) {
    await persist(vps.id, FAILED, error?.message || "credential_verification_failed").catch(() => null)
    await writeAuditLog({ action: "client_console_credentials_validation_failed", customerId, targetType: "vps", targetId: vps?.id || id, metadata: { message: error?.message || String(error) } })
    return NextResponse.json({ success: false, status: FAILED, label: "Verification Failed" }, { status: 200 })
  }
}
