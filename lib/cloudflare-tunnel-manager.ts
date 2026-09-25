import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { listCloudflareAccounts, selectedCloudflareContext, updateActiveCloudflareTunnel } from "@/lib/cloudflare-accounts"

const execFileAsync = promisify(execFile)
const API = "https://api.cloudflare.com/client/v4"

function env(name: string, fallback = "") {
  return String(process.env[name] || fallback).trim()
}

function cfEnv(name: string, fallback = "") {
  const legacy = name.startsWith("CF_") ? `CLOUDFLARE_${name.slice(3)}` : ""
  return env(name, legacy ? env(legacy, fallback) : fallback)
}

function required(name: string) {
  const value = cfEnv(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function cf<T = any>(path: string, init: RequestInit = {}, tokenOverride?: string): Promise<T> {
  const token = tokenOverride || required("CF_API_TOKEN")
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const message = Array.isArray(body.errors) && body.errors.length
      ? body.errors.map((error: any) => error.message || error.code).join("; ")
      : response.statusText
    throw new Error(`Cloudflare API failed ${path}: ${message}`)
  }
  return body.result as T
}

export function cloudflareTunnelName() {
  const domain = env("SITE_DOMAIN") || env("DOMAIN") || "myrdphub"
  return cfEnv("CF_TUNNEL_NAME", env("CLOUDFLARE_TUNNEL_NAME", "myrdphub-production"))
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || `zws-${domain}`
}

export function cloudflareRouteNames() {
  let domain = env("SITE_DOMAIN") || env("DOMAIN")
  if (!domain) {
    try {
      domain = new URL(env("APP_URL") || env("NEXT_PUBLIC_APP_URL") || "").hostname
    } catch {
      domain = ""
    }
  }
  const extra = env("CF_DNS_RECORDS").split(",").map((item) => item.trim()).filter(Boolean)
  return Array.from(new Set([domain, domain ? `www.${domain}` : "", domain ? `admin.${domain}` : "", domain ? `api.${domain}` : "", ...extra].filter(Boolean)))
}

function artifactDir() {
  return env("CLOUDFLARE_ARTIFACT_DIR") || path.join(process.cwd(), "deployment-reports", "cloudflare")
}

function tunnelService() {
  return cfEnv("CF_TUNNEL_SERVICE", env("CF_TUNNEL_SERVICE", "http://app:3000")) || "http://app:3000"
}

export function buildCloudflareTunnelArtifacts(input: { tunnelId?: string; tunnelName?: string } = {}) {
  const tunnelId = input.tunnelId || cfEnv("CF_TUNNEL_ID") || "<CF_TUNNEL_ID>"
  const tunnelName = input.tunnelName || cloudflareTunnelName()
  const service = tunnelService()
  const hostnames = cloudflareRouteNames()
  const ingress = [
    `tunnel: ${tunnelId}`,
    `credentials-file: /etc/cloudflared/${tunnelId}.json`,
    "ingress:",
    ...hostnames.flatMap((hostname) => [
      `  - hostname: ${hostname}`,
      `    service: ${service}`,
    ]),
    "  - service: http_status:404",
    "",
  ].join("\n")
  const systemd = [
    "[Unit]",
    `Description=Cloudflare Tunnel for ${tunnelName}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    "User=cloudflared",
    "ExecStart=/usr/local/bin/cloudflared tunnel --config /etc/cloudflared/config.yml run",
    "Restart=always",
    "RestartSec=5s",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n")
  const validation = {
    generatedAt: new Date().toISOString(),
    tunnelName,
    tunnelId,
    service,
    hostnames,
    cloudflareOnlyMode: env("CLOUDFLARE_ONLY_MODE") === "true",
    nginxProfileKept: true,
    dnsDeletionAutomatic: false,
    requiredBeforeNginxRemoval: ["payments", "uploads", "payment_webhooks", "whatsapp_webhook", "auth", "proxmox", "cron_jobs"],
  }
  return { tunnelName, tunnelId, service, hostnames, ingress, systemd, validation }
}

export async function generateCloudflareTunnelArtifacts(input: { tunnelId?: string; tunnelName?: string } = {}) {
  const artifacts = buildCloudflareTunnelArtifacts(input)
  const dir = artifactDir()
  await fs.mkdir(dir, { recursive: true })
  const configPath = path.join(dir, "cloudflared-config.yml")
  const servicePath = path.join(dir, "cloudflared.service")
  const validationPath = path.join(dir, "cloudflare-only-validation.json")
  await Promise.all([
    fs.writeFile(configPath, artifacts.ingress, "utf8"),
    fs.writeFile(servicePath, artifacts.systemd, "utf8"),
    fs.writeFile(validationPath, JSON.stringify(artifacts.validation, null, 2), "utf8"),
  ])
  return { ...artifacts, files: { configPath, servicePath, validationPath } }
}

export async function validateCloudflareOnlyReadiness() {
  const base = env("APP_URL") || env("NEXT_PUBLIC_APP_URL") || "http://127.0.0.1:3000"
  const checks = [
    { key: "health", path: "/api/health" },
    { key: "payments", path: "/api/admin/payment-gateways" },
    { key: "uploads", path: "/api/admin/cms/media" },
    { key: "payment_webhooks", path: "/api/payments/webhook?gateway=phonepe" },
    { key: "whatsapp_webhook", path: "/api/whatsapp/webhook" },
    { key: "auth", path: "/login" },
    { key: "proxmox", path: "/api/admin/proxmox/nodes" },
    { key: "cron_jobs", path: "/api/admin/system/health" },
  ]
  const results = await Promise.all(checks.map(async (check) => {
    const url = `${base.replace(/\/+$/, "")}${check.path}`
    const startedAt = Date.now()
    const response = await fetch(url, { method: "GET", cache: "no-store" }).catch((error) => ({ ok: false, status: 0, statusText: error?.message || "network failure" } as Response))
    const status = Number((response as Response).status || 0)
    const acceptable = check.key === "payment_webhooks"
      ? [200, 400, 401, 405].includes(status)
      : check.key === "whatsapp_webhook"
        ? [200, 401].includes(status)
        : status > 0 && status < 500
    return { ...check, url, ok: acceptable, status, elapsedMs: Date.now() - startedAt }
  }))
  const ok = results.every((row) => row.ok)
  return {
    ok,
    checkedAt: new Date().toISOString(),
    mode: env("CLOUDFLARE_ONLY_MODE") === "true" ? "cloudflare_only" : "standard",
    nginxProfileKept: true,
    recommendation: ok ? "direct_tunnel_ready_keep_nginx_available" : "keep_nginx_until_failed_checks_pass",
    results,
  }
}

export function cloudflareConfigured() {
  return {
    accountId: cfEnv("CF_ACCOUNT_ID"),
    zoneId: cfEnv("CF_ZONE_ID"),
    tunnelId: cfEnv("CF_TUNNEL_ID"),
    tokenConfigured: Boolean(cfEnv("CF_API_TOKEN")),
    tunnelTokenConfigured: Boolean(cfEnv("CF_TUNNEL_TOKEN")),
    tunnelName: cloudflareTunnelName(),
    routeNames: cloudflareRouteNames(),
  }
}

/** Resolves the Cloudflare API token without ever exposing it in returned objects. */
async function cloudflareApiToken() {
  const selected = await selectedCloudflareContext().catch(() => null)
  if (selected?.token) return selected.token
  return cfEnv("CF_API_TOKEN")
}

async function cloudflareRuntimeConfig() {
  const selected = await selectedCloudflareContext().catch(() => null)
  const hasToken = Boolean(selected?.token || cfEnv("CF_API_TOKEN"))
  const accounts = await listCloudflareAccounts().catch(() => [])
  if (selected) {
    return {
      accountId: selected.accountId,
      zoneId: selected.zoneId,
      tunnelId: selected.tunnelId,
      tokenConfigured: hasToken,
      tunnelTokenConfigured: Boolean(cfEnv("CF_TUNNEL_TOKEN")),
      tunnelName: selected.account.tunnelName || cloudflareTunnelName(),
      routeNames: cloudflareRouteNames(),
      source: "database",
      accounts,
    }
  }
  return { ...cloudflareConfigured(), source: "environment", accounts }
}

export async function getCloudflareTunnelReport() {
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  if (!config.tokenConfigured || !config.accountId) return { ok: false, configured: config, error: "Cloudflare API token/account is not configured." }
  const tunnels = await cf<any[]>(`/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel?name=${encodeURIComponent(config.tunnelName)}&is_deleted=false`, {}, token).catch(() => [])
  const tunnelId = config.tunnelId || tunnels[0]?.id || ""
  const tunnel = tunnelId ? await cf<any>(`/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}`, {}, token).catch((error) => ({ error: error.message })) : null
  const routes = tunnelId ? await cf<any>(`/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/configurations`, {}, token).catch((error) => ({ error: error.message })) : null
  const connections = tunnelId ? await cf<any>(`/accounts/${encodeURIComponent(config.accountId)}/cfd_tunnel/${encodeURIComponent(tunnelId)}/connections`, {}, token).catch(() => null) : null
  const dns = config.zoneId && tunnelId ? await getDnsMigrationPlan(tunnelId).catch((error) => ({ error: error.message, records: [], proposed: [], conflicts: [] })) : null
  const readiness = await validateCloudflareOnlyReadiness().catch((error) => ({ ok: false, error: error?.message || "Cloudflare-only readiness failed" }))
  return {
    ok: Boolean(tunnel && !(tunnel as any).deleted_at && !(tunnel as any).error),
    configured: { ...config, tunnelId },
    tunnel,
    routes,
    connections,
    health: {
      status: (tunnel as any)?.status || ((connections as any)?.length ? "healthy" : "unknown"),
      connected: Array.isArray(connections) ? connections.length : null,
    },
    dns,
    artifacts: buildCloudflareTunnelArtifacts({ tunnelId }),
    readiness,
  }
}

export async function createCloudflareTunnel(name = cloudflareTunnelName()) {
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  const accountId = config.accountId || required("CF_ACCOUNT_ID")
  const existing = await cf<any[]>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`, {}, token).catch(() => [])
  if (existing[0]) return { tunnel: existing[0], created: false, token: await getCloudflareTunnelToken(existing[0].id).catch(() => null) }
  const tunnel = await cf<any>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`, {
    method: "POST",
    body: JSON.stringify({ name, tunnel_secret: crypto.randomBytes(32).toString("base64"), config_src: "cloudflare" }),
  }, token)
  await updateActiveCloudflareTunnel({ tunnelId: tunnel.id, tunnelName: tunnel.name || name }).catch(() => null)
  return { tunnel, created: true, token: await getCloudflareTunnelToken(tunnel.id).catch(() => null) }
}

export async function getCloudflareTunnelToken(tunnelId?: string) {
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  const accountId = config.accountId || required("CF_ACCOUNT_ID")
  const resolvedTunnelId = tunnelId || config.tunnelId || required("CF_TUNNEL_ID")
  return cf<string>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(resolvedTunnelId)}/token`, {}, token)
}

export async function rotateCloudflareTunnelCredentials(tunnelId?: string) {
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  const accountId = config.accountId || required("CF_ACCOUNT_ID")
  const resolvedTunnelId = tunnelId || config.tunnelId || required("CF_TUNNEL_ID")
  const tunnel = await cf<any>(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(resolvedTunnelId)}`, {
    method: "PATCH",
    body: JSON.stringify({ tunnel_secret: crypto.randomBytes(32).toString("base64") }),
  }, token)
  await updateActiveCloudflareTunnel({ tunnelId: resolvedTunnelId, tunnelName: tunnel.name || null }).catch(() => null)
  return { tunnel, token: await getCloudflareTunnelToken(resolvedTunnelId).catch(() => null) }
}

export async function restartCloudflaredService() {
  if (env("CLOUDFLARE_ALLOW_SERVICE_RESTART") !== "1") {
    return { restarted: false, commandRequired: "systemctl restart cloudflared", reason: "Set CLOUDFLARE_ALLOW_SERVICE_RESTART=1 to allow app-initiated restart." }
  }
  await execFileAsync("systemctl", ["restart", "cloudflared"], { timeout: 15_000 })
  return { restarted: true }
}

export async function getDnsMigrationPlan(tunnelId?: string) {
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  const zoneId = config.zoneId || required("CF_ZONE_ID")
  const resolvedTunnelId = tunnelId || config.tunnelId || required("CF_TUNNEL_ID")
  const target = `${resolvedTunnelId}.cfargotunnel.com`
  const proposed = cloudflareRouteNames().map((name) => ({ type: "CNAME", name, content: target, proxied: true, ttl: 1 }))
  const records = await Promise.all(proposed.map(async (route) => ({
    route,
    records: await cf<any[]>(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(route.name)}`, {}, token).catch(() => []),
  })))
  const conflicts = records.flatMap((entry) => entry.records
    .filter((record) => record.type !== "CNAME" || record.content !== target || record.proxied !== true)
    .map((record) => ({ name: entry.route.name, existing: { id: record.id, type: record.type, content: record.content, proxied: record.proxied }, proposed: entry.route })))
  return { target, proposed, current: records, conflicts }
}

export async function applyDnsMigration(input: { tunnelId?: string; understandDnsChanges: boolean }) {
  if (!input.understandDnsChanges) throw new Error("DNS confirmation is required.")
  const config = await cloudflareRuntimeConfig()
  const token = await cloudflareApiToken()
  const zoneId = config.zoneId || required("CF_ZONE_ID")
  const plan = await getDnsMigrationPlan(input.tunnelId || config.tunnelId || required("CF_TUNNEL_ID"))
  if (plan.conflicts.length) throw new Error("DNS conflicts detected. Resolve conflicts before applying.")
  const applied = []
  for (const route of plan.proposed) {
    const existing = plan.current.find((entry) => entry.route.name === route.name)?.records || []
    const exact = existing.find((record) => record.type === route.type && record.content === route.content && record.proxied === true)
    if (exact) {
      applied.push({ name: route.name, action: "unchanged", id: exact.id })
      continue
    }
    const record = await cf<any>(`/zones/${encodeURIComponent(zoneId)}/dns_records`, { method: "POST", body: JSON.stringify(route) }, token)
    applied.push({ name: route.name, action: "created", id: record.id })
  }
  return { applied, plan }
}
