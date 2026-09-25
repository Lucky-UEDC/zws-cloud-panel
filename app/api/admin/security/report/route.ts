import { promises as fs } from "node:fs"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { NextResponse } from "next/server"
import { canAccessAdminApi } from "@/lib/admin-rbac"
import { getCloudflareTunnelReport } from "@/lib/cloudflare-tunnel-manager"
import { getAdminFromCookies } from "@/lib/server-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

const ROOT = process.cwd()
const execFileAsync = promisify(execFile)
const SECRET_PATTERNS = [
  { name: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "cloudflare_token", pattern: /\b(?:cf_[A-Za-z0-9_-]{20,}|cfat_[A-Za-z0-9_-]{20,})\b/ },
  { name: "generic_secret_assignment", pattern: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[^"'\s]{16,}/i },
]

async function exists(file: string) {
  return fs.access(file).then(() => true).catch(() => false)
}

async function scanFile(file: string) {
  const absolute = path.join(ROOT, file)
  if (!await exists(absolute)) return []
  const text = await fs.readFile(absolute, "utf8").catch(() => "")
  const findings = []
  for (const entry of SECRET_PATTERNS) {
    if (entry.pattern.test(text)) findings.push({ file, type: entry.name, redacted: true })
  }
  return findings
}

async function openPorts() {
  const { stdout } = await execFileAsync("ss", ["-tulpen"], { timeout: 5000 }).catch(() => ({ stdout: "" }))
  return String(stdout || "")
    .split("\n")
    .filter((line) => /\bLISTEN\b|\bUNCONN\b/.test(line))
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      const local = parts.find((part) => /:\d+$/.test(part)) || ""
      const port = Number((local.match(/:(\d+)$/) || [])[1] || 0)
      return { proto: parts[0] || "unknown", local, port, raw: line.trim() }
    })
    .filter((row) => row.port > 0)
}

function classifyService(port: number) {
  if (port === 22) return "ssh"
  if (port === 80 || port === 443) return "http_edge"
  if (port === 3000) return "nextjs_origin"
  if (port === 3001) return "vnc_proxy"
  if (port === 5432) return "postgres"
  if (port === 6379) return "redis"
  return "unknown"
}

async function dnsSslHealth() {
  const base = String(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000").replace(/\/+$/, "")
  const response = await fetch(`${base}/api/health`, { cache: "no-store" }).catch(() => null)
  if (!response?.ok) return { ok: false, error: response ? `health returned ${response.status}` : "health unavailable" }
  const body: any = await response.json().catch(() => ({}))
  return {
    ok: Boolean(body?.checks?.dnsSsl?.ok ?? body?.dnsSsl?.ok ?? body?.ok),
    dnsSsl: body?.checks?.dnsSsl || body?.dnsSsl || null,
    cloudflare: body?.checks?.cloudflare || body?.cloudflare || null,
  }
}

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const [cloudflare, secretFindings, ports, ssl] = await Promise.all([
    getCloudflareTunnelReport().catch((error) => ({ ok: false, error: error?.message || "Cloudflare validation failed" })),
    Promise.all([".env", ".env.production", "docker-compose.yml", "scripts/cloudflare-auto.mjs", "installer/install.sh"].map(scanFile)).then((rows) => rows.flat()),
    openPorts().catch(() => []),
    dnsSslHealth().catch((error) => ({ ok: false, error: error?.message || "SSL health failed" })),
  ])
  const exposedServices = ports.map((port) => ({ ...port, service: classifyService(port.port), exposedInCloudflareOnlyMode: ![22].includes(port.port) && process.env.CLOUDFLARE_ONLY_MODE === "true" }))
  return NextResponse.json({
    success: true,
    report: {
      generatedAt: new Date().toISOString(),
      fail2ban: {
        recommended: true,
        packages: ["fail2ban"],
        jails: ["sshd"],
        status: "recommendation",
      },
      ufw: {
        recommended: true,
        allow: ["22/tcp"],
        deny: ["80/tcp", "443/tcp", "3000/tcp", "8080/tcp", "8000/tcp", "5000/tcp", "5432/tcp", "6379/tcp"],
        cloudflareOnlyMode: process.env.CLOUDFLARE_ONLY_MODE === "true",
      },
      cloudflareTunnel: cloudflare,
      openPorts: ports,
      exposedServices,
      sslHealth: ssl,
      secretScanner: {
        ok: secretFindings.length === 0,
        findings: secretFindings,
      },
    },
  })
}
