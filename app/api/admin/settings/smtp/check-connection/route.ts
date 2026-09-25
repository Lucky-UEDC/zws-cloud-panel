import dns from "node:dns/promises"
import net from "node:net"
import tls from "node:tls"
import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { classifySmtpError, verifySmtpConnection } from "@/lib/mailer"
import { getEmailConfig } from "@/lib/email/config"
import { isAdminLikeRole } from "@/lib/admin-rbac"

function jsonError(code: string, error: string, status = 400) {
  return NextResponse.json({ ok: false, success: false, code, error }, { status })
}

function tcpCheck(host: string, port: number) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const socket = net.connect({ host, port, timeout: 8000 }, () => {
      socket.destroy()
      resolve({ ok: true })
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve({ ok: false, error: "timeout" })
    })
    socket.on("error", (error) => resolve({ ok: false, error: error.message }))
  })
}

function tlsCheck(host: string, port: number) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: 8000 }, () => {
      socket.destroy()
      resolve({ ok: socket.authorized, error: socket.authorized ? undefined : String(socket.authorizationError || "tls_not_authorized") })
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve({ ok: false, error: "timeout" })
    })
    socket.on("error", (error) => resolve({ ok: false, error: error.message }))
  })
}

export async function POST() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !isAdminLikeRole(admin.role)) {
    return jsonError("ADMIN_UNAUTHORIZED", "Your admin session expired. Please sign in again.", 401)
  }

  const smtp = await getEmailConfig()
  const host = String(smtp?.smtpHost || "").trim()
  const port = Number(smtp?.smtpPort || 0)
  if (!host || !port) return jsonError("SMTP_NOT_CONFIGURED", "SMTP host and port are required.", 400)

  const dnsResult = await dns.lookup(host, { all: true }).then((addresses) => ({ ok: true, addresses: addresses.map((item) => item.address) })).catch((error) => ({ ok: false, error: error.message }))
  const tcpResult = await tcpCheck(host, port)
  const tlsResult = smtp?.smtpSecure ? await tlsCheck(host, port) : { ok: true, skipped: true }
  let authResult: Record<string, unknown>
  try {
    await verifySmtpConnection()
    authResult = { ok: true }
  } catch (error) {
    const safeError = classifySmtpError(error)
    authResult = { ok: false, code: safeError.code, error: safeError.message }
  }

  return NextResponse.json({
    ok: true,
    success: true,
    provider: "smtp",
    host,
    port,
    secure: Boolean(smtp?.smtpSecure),
    checks: {
      dns: dnsResult,
      tcp: tcpResult,
      tls: tlsResult,
      auth: authResult,
    },
  })
}
