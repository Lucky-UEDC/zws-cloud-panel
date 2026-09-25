import { NextRequest, NextResponse } from "next/server"
import { getClientFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { createProxmoxClient } from "@/lib/proxmox"
import { decryptSecret, encryptSecret } from "@/lib/provision"
import { createProxmoxVncProxy, getProxmoxPasswordTicket } from "@/lib/proxmox-vnc"
import { writeAuditLog } from "@/lib/audit-log"

const VERIFIED = "VERIFIED"
const FAILED = "FAILED"
const PASSWORD_ACTIONS = new Set(["validate", "reset", "update_stored", "legacy_update", "rotate", "rotation_status"])

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

function actorMeta(request: NextRequest) {
  return {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip"),
    userAgent: request.headers.get("user-agent"),
  }
}

function recoveryGuidance(windows: boolean) {
  if (windows) {
    return [
      "QEMU guest agent is unavailable, so MyRDPHub cannot prove the live Administrator password changed.",
      "Open noVNC, use Windows recovery or an administrator session to set the password, then use Update Stored.",
    ]
  }
  return [
    "QEMU guest agent is unavailable, so use the serial terminal to set the root password inside the guest.",
    "After the terminal confirms the new password, use Update Stored to sync the panel credential.",
  ]
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

async function persistCredentialVerification(vpsId: string, status: typeof VERIFIED | typeof FAILED, message: string | null) {
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

async function validateStoredCredentials(input: {
  customerId: string
  vps: any
  meta: ReturnType<typeof actorMeta>
}) {
  const { customerId, vps, meta } = input
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
      await persistCredentialVerification(vps.id, VERIFIED, "windows_console_reachable")
      await writeAuditLog({
        action: "client_console_credentials_validated",
        customerId,
        targetType: "vps",
        targetId: vps.id,
        metadata: { method: "windows_console" },
        ...meta,
      })
      return NextResponse.json({
        success: true,
        status: VERIFIED,
        label: "Verified",
        verification: { status: VERIFIED, label: "Verified", checkedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() },
      })
    }

    const host = String(vps.ipAddress || "").trim()
    const username = String(vps.username || vps.adminUsername || "root").trim()
    const password = safeDecrypt(vps.passwordEncrypted)
    if (!host || !username || !password) throw new Error("Credentials are incomplete")
    await verifySshLogin({ host, username, password })
    await persistCredentialVerification(vps.id, VERIFIED, "ssh_login_success")
    await writeAuditLog({
      action: "client_console_credentials_validated",
      customerId,
      targetType: "vps",
      targetId: vps.id,
      metadata: { method: "ssh" },
      ...meta,
    })
    return NextResponse.json({
      success: true,
      status: VERIFIED,
      label: "Verified",
      verification: { status: VERIFIED, label: "Verified", checkedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() },
    })
  } catch (error: any) {
    const message = error?.message || "credential_verification_failed"
    await persistCredentialVerification(vps.id, FAILED, message).catch(() => null)
    await writeAuditLog({
      action: "client_console_credentials_validation_failed",
      customerId,
      targetType: "vps",
      targetId: vps?.id,
      metadata: { message },
      ...meta,
    })
    return NextResponse.json({
      success: false,
      status: FAILED,
      label: "Verification Failed",
      verification: { status: FAILED, label: "Verification Failed", checkedAt: new Date().toISOString(), verifiedAt: null },
    }, { status: 200 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const customer = await getClientFromCookies()
  const customerId = String(customer?.sub || "")
  if (!customerId) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const action = String(body?.action || "legacy_update").trim()
  const meta = actorMeta(request)

  if (!PASSWORD_ACTIONS.has(action)) {
    await writeAuditLog({
      action: "client_console_password_action_denied",
      customerId,
      targetType: "vps",
      targetId: id,
      metadata: { action, reason: "unknown_action" },
      ...meta,
    })
    return NextResponse.json({ success: false, error: "Unsupported password action" }, { status: 400 })
  }

  const vps = await prisma.vpsInstance.findFirst({
    where: { OR: [{ id }, { orderId: id }], customerId, deletedAt: null, status: { not: "DELETED" }, order: { deletedAt: null, status: { not: "DELETED" } } },
    include: { proxmoxNode: true, operatingSystem: true, order: { select: { osName: true } } },
  })
  if (!vps || !vps.proxmoxNode) {
    await writeAuditLog({
      action: "client_console_password_action_denied",
      customerId,
      targetType: "vps",
      targetId: id,
      metadata: { action, reason: "instance_not_found" },
      ...meta,
    })
    return NextResponse.json({ success: false, error: "Instance not found" }, { status: 404 })
  }

  if (action === "validate") {
    return validateStoredCredentials({ customerId, vps, meta })
  }

  if (action === "rotation_status") {
    const { getPasswordRotationStatus } = await import("@/lib/guest-password-rotation")
    const rotation = await getPasswordRotationStatus({ vpsId: vps.id })
    return NextResponse.json({ success: true, rotation })
  }

  const password = String(body?.password || "")
  const confirmPassword = body?.confirmPassword === undefined ? password : String(body.confirmPassword || "")
  if (password.length < 12) {
    await writeAuditLog({
      action: "client_console_password_action_failed",
      customerId,
      targetType: "vps",
      targetId: vps.id,
      metadata: { action, reason: "password_too_short" },
      ...meta,
    })
    return NextResponse.json({ success: false, error: "Password must be at least 12 characters" }, { status: 400 })
  }
  if (password !== confirmPassword) {
    await writeAuditLog({
      action: "client_console_password_action_failed",
      customerId,
      targetType: "vps",
      targetId: vps.id,
      metadata: { action, reason: "confirmation_mismatch" },
      ...meta,
    })
    return NextResponse.json({ success: false, error: "Password confirmation does not match" }, { status: 400 })
  }

  const username = String(vps.username || vps.adminUsername || (isWindowsVps(vps) ? "Administrator" : "root"))
  const encrypted = encryptSecret(password)

  if (action === "rotate") {
    const { rotateGuestPassword } = await import("@/lib/guest-password-rotation")
    const rotation = await rotateGuestPassword({
      vpsId: vps.id,
      customerId,
      node: {
        host: vps.proxmoxNode.host,
        tokenId: vps.proxmoxNode.tokenId,
        tokenSecret: vps.proxmoxNode.tokenSecret,
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
        nodeName: vps.proxmoxNode.nodeName,
      },
      vmid: Number(vps.vmid),
      password,
      username: vps.username || vps.adminUsername || (isWindowsVps(vps) ? "Administrator" : "root"),
      isWindows: isWindowsVps(vps),
      osHint: vps.operatingSystem?.name || vps.order.osName,
    })
    await writeAuditLog({
      action: rotation.ok ? "client_console_password_rotated" : "client_console_password_rotation_failed",
      customerId,
      targetType: "vps",
      targetId: vps.id,
      metadata: { action: "rotate", method: rotation.method || null, state: rotation.state },
      ...meta,
    })
    return NextResponse.json({ success: rotation.ok, rotation }, { status: rotation.ok ? 200 : 409 })
  }

  try {
    if (action === "update_stored") {
      await prisma.vpsInstance.update({ where: { id: vps.id }, data: { username, adminUsername: username, passwordEncrypted: encrypted } })
      await writeAuditLog({ action: "client_console_password_stored_updated", customerId, targetType: "vps", targetId: vps.id, metadata: { username, liveGuestChanged: false }, ...meta })
      return NextResponse.json({
        success: true,
        message: "Stored password updated after manual guest verification.",
        recovery: { status: "stored_updated", message: "Stored password updated." },
      })
    }

    if (action === "reset") {
      const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
        allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
      })
      try {
        await client.pingVMGuestAgent(vps.proxmoxNode.nodeName, vps.vmid)
        await client.setVMGuestPassword(vps.proxmoxNode.nodeName, vps.vmid, username, password, false)
        await prisma.vpsInstance.update({ where: { id: vps.id }, data: { username, adminUsername: username, passwordEncrypted: encrypted } })
        await writeAuditLog({ action: "client_console_password_guest_agent_reset", customerId, targetType: "vps", targetId: vps.id, metadata: { username, liveGuestChanged: true }, ...meta })
        return NextResponse.json({
          success: true,
          message: "Password reset through QEMU guest agent.",
          recovery: { status: "guest_agent_reset", message: "Live guest password reset." },
        })
      } catch (error: any) {
        const windows = isWindowsVps(vps)
        await writeAuditLog({
          action: "client_console_password_guest_agent_unavailable",
          customerId,
          targetType: "vps",
          targetId: vps.id,
          metadata: { username, windows, message: error?.message || String(error) },
          ...meta,
        })
        return NextResponse.json({
          success: false,
          error: "Guest agent password reset is unavailable.",
          recovery: {
            status: windows ? "windows_guided_recovery_required" : "linux_terminal_recovery_required",
            message: windows ? "Windows guided recovery required." : "Linux terminal recovery required.",
            guidance: recoveryGuidance(windows),
          },
        }, { status: 409 })
      }
    }

    const client = createProxmoxClient(vps.proxmoxNode.host, vps.proxmoxNode.tokenId, vps.proxmoxNode.tokenSecret, {
      allowInsecureTls: vps.proxmoxNode.allowInsecureTls,
    })
    await client.updateVMConfig(vps.proxmoxNode.nodeName, vps.vmid, { cipassword: password }).catch(() => undefined)
    await prisma.vpsInstance.update({ where: { id: vps.id }, data: { username, adminUsername: username, passwordEncrypted: encrypted } })
    await writeAuditLog({ action: "client_console_password_legacy_update", customerId, targetType: "vps", targetId: vps.id, metadata: { username, liveGuestChanged: "cloud-init-pending" }, ...meta })

    return NextResponse.json({
      success: true,
      message: "Password updated. Reboot may be required for the OS to apply it.",
      recovery: { status: "legacy_update", message: "Password stored and cloud-init config updated." },
    })
  } catch (error: any) {
    await writeAuditLog({ action: "client_console_password_update_failed", customerId, targetType: "vps", targetId: vps.id, metadata: { action, message: error?.message || String(error) }, ...meta })
    return NextResponse.json({ success: false, error: error?.message || "Password action failed" }, { status: 500 })
  }
}
