import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"
import { prisma } from "@/lib/db"
import { encryptSecretValue } from "@/lib/secret-crypto"
import { encryptGatewayCredentials } from "@/lib/payments/domain-gateway-credentials"
import { ensureAdminPaymentGateways } from "@/lib/payments/payment-gateway-admin"

const ENV_PATH = process.env.ENV_PATH || "/var/www/zws/.env"
const OUT_PATH = process.env.OUT_PATH || "/var/www/zws/shared/.env.production"
const WRITE_MINIMAL_ENV = process.argv.includes("--write-minimal-env")

function parseEnvFile(path: string) {
  const env: Record<string, string> = {}
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const index = trimmed.indexOf("=")
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function first(env: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = String(env[key] || process.env[key] || "").trim()
    if (value) return value
  }
  return ""
}

function boolText(value: string) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase())
}

function quote(value: string) {
  if (!value) return ""
  if (/^[A-Za-z0-9_./:@?=&%+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

async function upsertSystemSettings(env: Record<string, string>) {
  const existing = await (prisma as any).systemSetting.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } })
  const data: Record<string, unknown> = {
    siteName: first(env, "APP_NAME") || undefined,
    brandName: first(env, "APP_NAME", "NEXT_PUBLIC_APP_NAME") || undefined,
    smtpHost: first(env, "SMTP_HOST") || undefined,
    smtpPort: Number(first(env, "SMTP_PORT") || "587"),
    smtpSecure: boolText(first(env, "SMTP_SECURE")),
    smtpUser: first(env, "SMTP_USER") || undefined,
    smtpFrom: first(env, "SMTP_FROM") || undefined,
    proxmoxHost: first(env, "PROXMOX_HOST") || undefined,
    proxmoxNode: first(env, "PROXMOX_NODE") || undefined,
    proxmoxTokenId: first(env, "PROXMOX_TOKEN_ID") || undefined,
    proxmoxVerifyTls: first(env, "PROXMOX_VERIFY_TLS") !== "false",
    proxmoxVncUser: first(env, "PROXMOX_VNC_USER") || undefined,
    active: true,
    updatedBy: "env-migration",
  }

  const smtpPass = first(env, "SMTP_PASS")
  if (smtpPass) data.smtpPassEncrypted = encryptSecretValue(smtpPass)
  const proxmoxTokenSecret = first(env, "PROXMOX_TOKEN_SECRET")
  if (proxmoxTokenSecret) data.proxmoxTokenSecretEncrypted = encryptSecretValue(proxmoxTokenSecret)
  const proxmoxVncPassword = first(env, "PROXMOX_VNC_PASSWORD")
  if (proxmoxVncPassword) data.proxmoxVncPasswordEncrypted = encryptSecretValue(proxmoxVncPassword)

  if (existing) {
    await (prisma as any).systemSetting.update({ where: { id: existing.id }, data })
  } else {
    await (prisma as any).systemSetting.create({ data })
  }
}

async function upsertGateway(provider: "cashfree" | "phonepe", env: Record<string, string>, credentials: Record<string, string>) {
  const requiredCredentials = provider === "cashfree"
    ? [credentials.appId, credentials.secretKey]
    : [credentials.merchantId, credentials.clientId, credentials.clientSecret, credentials.clientVersion]
  const hasCredentials = requiredCredentials.every(Boolean)
  const encrypted = encryptGatewayCredentials(credentials)
  await (prisma as any).paymentGateway.upsert({
    where: { provider_environment: { provider, environment: "global" } },
    update: {
      code: provider,
      enabled: hasCredentials,
      active: hasCredentials,
      mode: first(env, "PAYMENT_MODE") === "production" ? "production" : "test",
      configEncrypted: encrypted.credentialsEnc,
      configIv: encrypted.credentialsIv,
      configTag: encrypted.credentialsTag,
      updatedAt: new Date(),
    },
    create: {
      name: provider === "cashfree" ? "Cashfree" : "PhonePe",
      provider,
      code: provider,
      environment: "global",
      enabled: hasCredentials,
      active: hasCredentials,
      primary: false,
      mode: first(env, "PAYMENT_MODE") === "production" ? "production" : "test",
      priority: provider === "phonepe" ? 10 : 20,
      failsafeEnabled: true,
      credentials: {},
      configEncrypted: encrypted.credentialsEnc,
      configIv: encrypted.credentialsIv,
      configTag: encrypted.credentialsTag,
      lastHealthStatus: "unknown",
    },
  })
}

async function upsertPaymentGateways(env: Record<string, string>) {
  await ensureAdminPaymentGateways()
  await upsertGateway("cashfree", env, {
    appId: first(env, "CASHFREE_APP_ID"),
    secretKey: first(env, "CASHFREE_SECRET_KEY"),
    webhookSecret: first(env, "CASHFREE_WEBHOOK_SECRET"),
  })
  await upsertGateway("phonepe", env, {
    merchantId: first(env, "PHONEPE_MERCHANT_ID"),
    clientId: first(env, "PHONEPE_CLIENT_ID"),
    clientSecret: first(env, "PHONEPE_CLIENT_SECRET"),
    clientVersion: first(env, "PHONEPE_CLIENT_VERSION"),
    webhookUsername: first(env, "PHONEPE_WEBHOOK_USERNAME"),
    webhookPassword: first(env, "PHONEPE_WEBHOOK_PASSWORD"),
  })
}

function minimalEnv(env: Record<string, string>) {
  const configuredAppUrl = first(env, "APP_URL", "NEXT_PUBLIC_APP_URL")
  const configuredHost = (() => {
    if (!configuredAppUrl) return ""
    try {
      return new URL(/^https?:\/\//i.test(configuredAppUrl) ? configuredAppUrl : `https://${configuredAppUrl}`).hostname
    } catch {
      return ""
    }
  })()
  const siteDomain = first(env, "SITE_DOMAIN", "DOMAIN") || configuredHost
  const appUrl = configuredAppUrl || (siteDomain ? `https://${siteDomain}` : "")
  const nextAuthUrl = first(env, "NEXTAUTH_URL") || appUrl
  const allowed = [
    ["NODE_ENV", "production"],
    ["SITE_DOMAIN", siteDomain],
    ["APP_URL", appUrl],
    ["NEXT_PUBLIC_APP_URL", first(env, "NEXT_PUBLIC_APP_URL") || appUrl],
    ["PORT", first(env, "PORT") || "3000"],
    ["DATABASE_URL", first(env, "DATABASE_URL")],
    ["REDIS_URL", first(env, "REDIS_URL")],
    ["JWT_SECRET", first(env, "JWT_SECRET", "AUTH_SECRET")],
    ["SESSION_SECRET", first(env, "SESSION_SECRET", "COOKIE_SECRET")],
    ["NEXTAUTH_SECRET", first(env, "NEXTAUTH_SECRET", "AUTH_SECRET")],
    ["NEXTAUTH_URL", nextAuthUrl],
    ["STRIPE_SECRET_KEY", first(env, "STRIPE_SECRET_KEY")],
    ["STRIPE_WEBHOOK_SECRET", first(env, "STRIPE_WEBHOOK_SECRET")],
    ["CF_ACCOUNT_ID", first(env, "CF_ACCOUNT_ID")],
    ["CF_TUNNEL_TOKEN", first(env, "CF_TUNNEL_TOKEN")],
    ["SECRET_ENCRYPTION_KEY", first(env, "SECRET_ENCRYPTION_KEY", "ENCRYPTION_KEY")],
  ] as const
  return `${allowed.map(([key, value]) => `${key}=${quote(value)}`).join("\n")}\n`
}

async function main() {
  const env = { ...parseEnvFile(ENV_PATH), ...(process.env as Record<string, string>) }
  await upsertSystemSettings(env)
  await upsertPaymentGateways(env)

  if (WRITE_MINIMAL_ENV) {
    mkdirSync(dirname(OUT_PATH), { recursive: true })
    if (existsSync(OUT_PATH)) {
      renameSync(OUT_PATH, `${OUT_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`)
    }
    writeFileSync(OUT_PATH, minimalEnv(env), { mode: 0o600 })
  }

  console.log(`Runtime config migration complete${WRITE_MINIMAL_ENV ? `; wrote ${OUT_PATH}` : ""}.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
