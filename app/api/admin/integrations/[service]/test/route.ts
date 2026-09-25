import { NextRequest, NextResponse } from "next/server"
import nodemailer from "nodemailer"
import { canManageSettings } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { getServiceIntegrationConfig } from "@/lib/integration-config"
import { getGoogleOAuthConfig } from "@/lib/auth/google-oauth"
import { sessionExpiredJson } from "@/lib/auth/session-expired-response"
import { prisma } from "@/lib/db"
import { exchangeRatesHealth } from "@/lib/exchange-rates"
import { googleDriveBackupHealth } from "@/lib/google-drive-backup"
import { getSearchConsoleSummary } from "@/lib/search-console"

export const dynamic = "force-dynamic"

function ok(data: Record<string, unknown> = {}) {
  return NextResponse.json({ success: true, ok: true, ...data })
}

async function recordHealth(input: { service: string; ok: boolean; startedAt: number; adminEmail?: string | null; message?: string | null; metadata?: Record<string, unknown> }) {
  const model = (prisma as any).integrationHealthLog
  if (!model) return
  await model.create({
    data: {
      provider: input.service,
      action: "connection_test",
      status: input.ok ? "healthy" : "failed",
      latencyMs: Date.now() - input.startedAt,
      message: input.message || null,
      checkedBy: input.adminEmail || null,
      metadata: input.metadata || {},
    },
  }).catch(() => null)
}

async function testSmtp() {
  const config = await getServiceIntegrationConfig("smtp")
  const host = String(config.smtpHost || "")
  const port = Number(config.smtpPort || 587)
  const user = String(config.smtpUser || "")
  const pass = String(config.smtpPass || "")
  if (!host) return { ok: false, error: "SMTP host is not configured." }
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: Boolean(config.smtpSecure),
    auth: user || pass ? { user, pass } : undefined,
  })
  await transport.verify()
  return { ok: true, host, port }
}

async function testCloudflare() {
  const config = await getServiceIntegrationConfig("cloudflareAnalytics")
  const token = String(config.apiToken || config.apiKey || "")
  const zoneId = String(config.zoneId || "")
  if (!token || !zoneId) return { ok: false, error: "Cloudflare zone ID and API token are required." }
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok && body?.success !== false, status: response.status, zoneId, error: body?.errors?.[0]?.message || null }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canManageSettings(admin.role)) return sessionExpiredJson()
  const { service } = await params
  const startedAt = Date.now()
  try {
    let result: Record<string, unknown>
    if (service === "exchangeRates") result = { result: await exchangeRatesHealth() }
    else if (service === "googleOAuth") {
      const config = await getGoogleOAuthConfig(request)
      result = { result: { configured: Boolean(config.clientId && config.clientSecret), redirectUri: config.redirectUri } }
    } else if (service === "googleDriveBackups") result = { result: await googleDriveBackupHealth() }
    else if (service === "smtp") result = { result: await testSmtp() }
    else if (service === "googleSearchConsole") result = { result: await getSearchConsoleSummary() }
    else if (service === "cloudflareAnalytics" || service === "cloudflare") result = { result: await testCloudflare() }
    else if (service === "geoIp" || service === "maxmind") {
      const config = await getServiceIntegrationConfig("geoIp")
      result = { result: { configured: Boolean(config.maxmindDbPath || config.apiKey || config.url), provider: config.provider || "maxmind" } }
    } else if (service === "googleAnalytics") {
      const config = await getServiceIntegrationConfig("googleAnalytics")
      result = { result: { configured: Boolean(config.measurementId || config.gaId), measurementId: config.measurementId || config.gaId || null } }
    } else if (["phonepe", "cashfree", "razorpay", "telegram", "discord", "s3", "wasabi", "backblaze", "github", "proxmox"].includes(service)) {
      const config = await getServiceIntegrationConfig(service)
      result = { result: { configured: Object.keys(config).length > 0, provider: service } }
    } else {
      await recordHealth({ service, ok: false, startedAt, adminEmail: String(admin.email), message: "Unsupported integration service." })
      return NextResponse.json({ error: "Unsupported integration service." }, { status: 404 })
    }
    await recordHealth({ service, ok: true, startedAt, adminEmail: String(admin.email), metadata: result })
    return ok(result)
  } catch (error: any) {
    await recordHealth({ service, ok: false, startedAt, adminEmail: String(admin.email), message: error?.message || "Integration test failed." })
    return NextResponse.json({ success: false, ok: false, error: error?.message || "Integration test failed." }, { status: 500 })
  }
}
