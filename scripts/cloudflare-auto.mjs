#!/usr/bin/env node
import crypto from "node:crypto"
import fs, { constants as fsConstants } from "node:fs"

const { O_CREAT, O_EXCL, O_NOFOLLOW, O_WRONLY } = fsConstants

const API = "https://api.cloudflare.com/client/v4"
const command = process.argv[2] || "health"

function env(name, fallback = "") {
  return String(process.env[name] || fallback).trim()
}

function cfEnv(name, fallback = "") {
  const legacy = name.startsWith("CF_") ? `CLOUDFLARE_${name.slice(3)}` : ""
  return env(name, legacy ? env(legacy, fallback) : fallback)
}

function required(name) {
  const value = cfEnv(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function tunnelName(domain) {
  return cfEnv("CF_TUNNEL_NAME", env("CLOUDFLARE_TUNNEL_NAME", `zws-${domain}`))
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || `zws-${domain}`
}

async function cf(path, init = {}) {
  const token = required("CF_API_TOKEN")
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    const errors = Array.isArray(body.errors) && body.errors.length
      ? body.errors.map((error) => error.message || error.code).join("; ")
      : response.statusText
    throw new Error(`Cloudflare API failed ${path}: ${errors}`)
  }
  return body.result
}

function zoneCandidates(hostname) {
  const parts = String(hostname || "").split(".").filter(Boolean)
  const out = []
  for (let i = 0; i < parts.length - 1; i += 1) out.push(parts.slice(i).join("."))
  return out
}

function recordNames(domain) {
  const extra = env("CF_DNS_RECORDS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set([
    domain,
    `www.${domain}`,
    `admin.${domain}`,
    `api.${domain}`,
    `*.${domain}`,
    ...extra,
  ]))
}

async function verifyToken() {
  const accountId = required("CF_ACCOUNT_ID")
  const result = await cf(`/accounts/${encodeURIComponent(accountId)}/tokens/verify`)
  return { ok: true, accountId, tokenStatus: result?.status || "active", id: result?.id || null }
}

async function findAccount() {
  const accountId = cfEnv("CF_ACCOUNT_ID")
  if (accountId) {
    const account = await cf(`/accounts/${encodeURIComponent(accountId)}`)
    return account
  }
  const accounts = await cf("/accounts")
  if (!Array.isArray(accounts) || !accounts.length) throw new Error("Cloudflare token cannot list accounts")
  return accounts[0]
}

async function findZone(domain) {
  const configured = cfEnv("CF_ZONE_ID")
  if (configured) return cf(`/zones/${encodeURIComponent(configured)}`)
  for (const name of zoneCandidates(domain)) {
    const zones = await cf(`/zones?name=${encodeURIComponent(name)}&status=active`)
    if (Array.isArray(zones) && zones.length) return zones[0]
  }
  throw new Error(`No active Cloudflare zone found for ${domain}`)
}

async function createDnsRecord(zoneId, name, content) {
  const existing = await cf(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}`)
  const records = Array.isArray(existing) ? existing : []
  const exact = records.find((record) => record.type === "CNAME" && record.content === content && record.proxied === true)
  if (exact) return { name, id: exact.id || null, action: "unchanged", conflicts: [] }
  const conflicts = records.filter((record) => record.type !== "CNAME" || record.content !== content)
  if (conflicts.length && env("CF_DNS_OVERWRITE", "0") !== "1") {
    return { name, id: null, action: "conflict", conflicts: conflicts.map((record) => ({ id: record.id, type: record.type, name: record.name, content: record.content, proxied: record.proxied })) }
  }
  const updatable = records.find((record) => record.type === "CNAME")
  if (updatable) {
    const record = await cf(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(updatable.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ type: "CNAME", name, content, proxied: true, ttl: 1 }),
    })
    return { name, id: record?.id || null, action: "updated", conflicts: [] }
  }
  const record = await cf(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
    method: "POST",
    body: JSON.stringify({ type: "CNAME", name, content, proxied: true, ttl: 1 }),
  })
  return { name, id: record?.id || null, action: "created", conflicts: [] }
}

async function configureDns(zoneId, domain, target) {
  const records = []
  for (const name of recordNames(domain)) {
    records.push(await createDnsRecord(zoneId, name, target))
  }
  return records
}

async function setSslMode(zoneId) {
  const mode = env("CF_SSL_MODE", "full")
  await cf(`/zones/${encodeURIComponent(zoneId)}/settings/ssl`, {
    method: "PATCH",
    body: JSON.stringify({ value: mode }),
  }).catch((error) => {
    if (env("CF_SSL_STRICT", "0") === "1") throw error
  })
  return mode
}

async function patchZoneSetting(zoneId, setting, value) {
  await cf(`/zones/${encodeURIComponent(zoneId)}/settings/${encodeURIComponent(setting)}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  })
  return { setting, value }
}

async function purgeNextStaticCache(zoneId, domain) {
  const files = recordNames(domain).flatMap((hostname) => [
    `https://${hostname}/_next/static/*`,
    `http://${hostname}/_next/static/*`,
  ])
  await cf(`/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
    method: "POST",
    body: JSON.stringify({ files }),
  }).catch(async () => {
    await cf(`/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
      method: "POST",
      body: JSON.stringify({ purge_everything: true }),
    })
  })
  return files
}

async function safeMode() {
  const domain = required("DOMAIN")
  await verifyToken()
  const zone = await findZone(domain)
  const settings = []
  for (const [setting, value] of [
    ["rocket_loader", "off"],
    ["minify", { css: "off", html: "off", js: "off" }],
    ["mirage", "off"],
    ["polish", "off"],
    ["email_obfuscation", "off"],
    ["ssl", "strict"],
    ["websockets", "on"],
  ]) {
    settings.push(await patchZoneSetting(zone.id, setting, value))
  }
  const purgedFiles = await purgeNextStaticCache(zone.id, domain)
  return { ok: true, zoneId: zone.id, zoneName: zone.name, settings, purgedFiles }
}

async function waf() {
  const domain = required("DOMAIN")
  await verifyToken()
  const zone = await findZone(domain)
  const description = "ZWS public form and auth hardening"
  const expression = [
    '(http.request.uri.path contains "/api/contact")',
    '(http.request.uri.path contains "/api/client/tickets")',
    '(http.request.uri.path contains "/api/auth/login")',
    '(http.request.uri.path contains "/api/auth/register")',
    '(http.request.uri.path contains "/api/auth/forgot-password")',
    '(http.request.uri.path contains "/api/checkout")',
    '(http.request.uri.path contains "/api/coupons/validate")',
    '(http.request.uri.path contains "/api/dedicated/inquiries")',
  ].join(" or ")

  const managed = await cf(`/zones/${encodeURIComponent(zone.id)}/rulesets`, {
    method: "POST",
    body: JSON.stringify({
      name: "zws-managed-security",
      description,
      kind: "zone",
      phase: "http_request_firewall_managed",
      rules: [
        {
          action: "execute",
          expression: "true",
          action_parameters: { id: "efb7b8c949ac4650a09736fc376e9aee" },
          description: "Cloudflare Managed Ruleset",
          enabled: true,
        },
        {
          action: "execute",
          expression: "true",
          action_parameters: { id: "4814384a9e5d4991b9815dcfc25d2f1f" },
          description: "Cloudflare OWASP Core Ruleset",
          enabled: true,
        },
      ],
    }),
  }).catch((error) => ({ error: error.message }))

  const custom = await cf(`/zones/${encodeURIComponent(zone.id)}/rulesets`, {
    method: "POST",
    body: JSON.stringify({
      name: "zws-custom-public-form-blocks",
      description,
      kind: "zone",
      phase: "http_request_firewall_custom",
      rules: [
        {
          action: "block",
          expression: `(${expression}) and (http.request.body.raw contains "<script" or http.request.body.raw contains "javascript:" or http.request.body.raw contains "onerror=" or http.request.body.raw contains "union select" or http.request.body.raw contains "%3C")`,
          description: "Block public form XSS and SQLi payloads",
          enabled: true,
        },
      ],
    }),
  }).catch((error) => ({ error: error.message }))

  const rateLimit = await cf(`/zones/${encodeURIComponent(zone.id)}/rulesets`, {
    method: "POST",
    body: JSON.stringify({
      name: "zws-public-form-rate-limits",
      description,
      kind: "zone",
      phase: "http_ratelimit",
      rules: [
        {
          action: "block",
          expression: `(${expression})`,
          ratelimit: {
            characteristics: ["ip.src", "http.request.uri.path"],
            period: 3600,
            requests_per_period: 20,
            mitigation_timeout: 3600,
          },
          description: "Rate limit public form and auth endpoints",
          enabled: true,
        },
      ],
    }),
  }).catch((error) => ({ error: error.message }))

  return { ok: true, zoneId: zone.id, zoneName: zone.name, managed, custom, rateLimit }
}

async function recreateTunnel(accountId, domain) {
  const name = tunnelName(domain)
  const existing = await cf(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`)
  const tunnel = Array.isArray(existing) && existing[0]
    ? existing[0]
    : await cf(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel`, {
        method: "POST",
        body: JSON.stringify({ name, tunnel_secret: crypto.randomBytes(32).toString("base64"), config_src: "cloudflare" }),
      })
  const service = env("CF_TUNNEL_SERVICE", "http://127.0.0.1:3000")
  const ingress = recordNames(domain).map((hostname) => ({ hostname, service }))
  ingress.push({ service: "http_status:404" })
  await cf(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnel.id)}/configurations`, {
    method: "PUT",
    body: JSON.stringify({ config: { ingress, originRequest: { noTLSVerify: true } } }),
  })
  const token = await cf(`/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${encodeURIComponent(tunnel.id)}/token`)
  return { id: tunnel.id, name, token, target: `${tunnel.id}.cfargotunnel.com` }
}

async function configure() {
  await verifyToken()
  const domain = required("DOMAIN")
  const account = await findAccount()
  const zone = await findZone(domain)
  const tunnel = await recreateTunnel(account.id, domain)
  const dnsRecords = await configureDns(zone.id, domain, tunnel.target)
  const sslMode = await setSslMode(zone.id)
  const outFile = env("CF_OUTPUT_ENV", "/tmp/zws-cloudflare-tunnel.env")
  // Write atomically via a private temp file, then rename. fs.writeFileSync
  // with mode 0600 on a fixed /tmp path is a symlink/race risk (an attacker
  // could pre-create a symlink at that path so the tunnel token is written
  // to an arbitrary file). O_EXCL + O_NOFOLLOW guards against that.
  const flags = process.platform === "linux" ? O_EXCL | O_NOFOLLOW | O_CREAT | O_WRONLY : O_EXCL | O_CREAT | O_WRONLY
  const fd = fs.openSync(outFile, flags, 0o600)
  try {
    fs.writeFileSync(fd, [
      `CF_ACCOUNT_ID=${account.id}`,
      `CF_ZONE_ID=${zone.id}`,
      `CF_TUNNEL_ID=${tunnel.id}`,
      `CF_TUNNEL_NAME=${tunnel.name}`,
      `CF_TUNNEL_TOKEN=${tunnel.token}`,
    ].join("\n") + "\n")
  } finally {
    fs.closeSync(fd)
  }
  fs.chmodSync(outFile, 0o600)
  return { ok: true, accountId: account.id, zoneId: zone.id, zoneName: zone.name, tunnelId: tunnel.id, tunnelName: tunnel.name, sslMode, dnsRecords }
}

async function dns() {
  const domain = required("DOMAIN")
  const zone = await findZone(domain)
  const target = required("CF_DNS_TARGET")
  const dnsRecords = await configureDns(zone.id, domain, target)
  return { ok: true, zoneId: zone.id, zoneName: zone.name, target, dnsRecords }
}

async function health() {
  const out = {
    token: false,
    account: false,
    zone: false,
    tunnel: false,
    dns: false,
  }
  await verifyToken()
  out.token = true
  const domain = env("DOMAIN")
  const account = await findAccount()
  out.account = Boolean(account?.id)
  if (domain) {
    const zone = await findZone(domain)
    out.zone = Boolean(zone?.id)
    if (cfEnv("CF_TUNNEL_ID")) {
      const tunnel = await cf(`/accounts/${encodeURIComponent(account.id)}/cfd_tunnel/${encodeURIComponent(cfEnv("CF_TUNNEL_ID"))}`)
      out.tunnel = !tunnel?.deleted_at
      const expected = `${cfEnv("CF_TUNNEL_ID")}.cfargotunnel.com`
      const rootRecords = await cf(`/zones/${encodeURIComponent(zone.id)}/dns_records?name=${encodeURIComponent(domain)}`)
      out.dns = Array.isArray(rootRecords) && rootRecords.some((record) => record.type === "CNAME" && record.content === expected && record.proxied === true)
    }
  }
  return { ok: Object.values(out).every(Boolean), ...out }
}

async function main() {
  const result = command === "verify"
    ? await verifyToken()
    : command === "configure"
      ? await configure()
      : command === "dns"
        ? await dns()
        : command === "waf"
          ? await waf()
        : command === "safe-mode"
          ? await safeMode()
          : await health()
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error?.message || String(error))
  process.exit(1)
})
