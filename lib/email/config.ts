import { prisma } from "@/lib/db"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { getMailSettings, maskSecret } from "@/lib/settings"
import { getPublicSiteSettings } from "@/lib/settings/site-settings"

const MASKED_SECRET_PREFIX = "••••"
const MASKED_SECRET_VALUE = "__MASKED__"

export type EmailConfigInput = {
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUser?: string
  smtpPass?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  enabled?: boolean
}

export type EmailConfigPublic = {
  id: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  fromName: string
  fromEmail: string
  replyTo: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type EmailConfigResolved = Omit<EmailConfigPublic, "smtpPass" | "createdAt" | "updatedAt"> & {
  smtpPass: string
  createdAt: Date
  updatedAt: Date
}

function isMasked(value: unknown) {
  const text = String(value || "")
  return text === MASKED_SECRET_VALUE || text.startsWith(MASKED_SECRET_PREFIX)
}

function normalizePort(value: unknown) {
  const port = Number(value || 0)
  return Number.isFinite(port) && port > 0 ? Math.floor(port) : 587
}

function isSecureFromLegacy(encryption: unknown, port: unknown) {
  const normalized = String(encryption || "").toLowerCase()
  return normalized === "ssl_tls" || normalized === "ssl" || normalizePort(port) === 465
}

function toPublic(config: EmailConfigResolved): EmailConfigPublic {
  return {
    id: config.id,
    smtpHost: config.smtpHost,
    smtpPort: config.smtpPort,
    smtpSecure: config.smtpSecure,
    smtpUser: config.smtpUser,
    smtpPass: maskSecret(config.smtpPass),
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo || "",
    enabled: config.enabled,
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
  }
}

async function fromDbRow(row: any): Promise<EmailConfigResolved | null> {
  if (!row) return null
  const site = await getPublicSiteSettings().catch(() => null)
  return {
    id: row.id,
    smtpHost: row.smtpHost || "",
    smtpPort: normalizePort(row.smtpPort),
    smtpSecure: Boolean(row.smtpSecure),
    smtpUser: row.smtpUser || "",
    smtpPass: decryptSecretValue(row.smtpPass || ""),
    fromName: row.fromName || site?.brandName || "Cloud",
    fromEmail: row.fromEmail || row.smtpUser || site?.supportEmail || "",
    replyTo: row.replyTo || "",
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function createFromLegacy() {
  const legacy = await getMailSettings().catch(() => null)
  if (!legacy) return null
  const host = String(legacy.host || "").trim()
  const user = String(legacy.username || "").trim()
  const pass = String(legacy.password || "").trim()
  const site = await getPublicSiteSettings().catch(() => null)
  const fromEmail = String(legacy.mailFromAddress || user || site?.supportEmail || "").trim()

  const row = await prisma.emailConfig.create({
    data: {
      smtpHost: host,
      smtpPort: normalizePort(legacy.port),
      smtpSecure: isSecureFromLegacy(legacy.encryption, legacy.port),
      smtpUser: user,
      smtpPass: encryptSecretValue(pass),
      fromName: String(legacy.mailFromName || site?.brandName || "Cloud").trim() || "Cloud",
      fromEmail,
      replyTo: String(legacy.replyTo || "").trim() || null,
      enabled: Boolean(legacy.enabled && host && user && pass),
    },
  })
  return fromDbRow(row)
}

export async function getEmailConfig(options: { createFromLegacyIfMissing?: boolean } = {}) {
  const existing = await prisma.emailConfig.findFirst({ orderBy: { updatedAt: "desc" } }).catch(() => null)
  if (existing) return fromDbRow(existing)
  if (options.createFromLegacyIfMissing === false) return null
  return createFromLegacy()
}

export async function getPublicEmailConfig() {
  const config = await getEmailConfig()
  if (!config) return null
  return toPublic(config)
}

export async function upsertEmailConfig(input: EmailConfigInput) {
  const previous = await getEmailConfig({ createFromLegacyIfMissing: true })
  const site = await getPublicSiteSettings().catch(() => null)
  const smtpPass = isMasked(input.smtpPass) || input.smtpPass === undefined
    ? previous?.smtpPass || ""
    : String(input.smtpPass || "")
  const payload = {
    smtpHost: String(input.smtpHost ?? previous?.smtpHost ?? "").trim(),
    smtpPort: normalizePort(input.smtpPort ?? previous?.smtpPort),
    smtpSecure: Boolean(input.smtpSecure ?? previous?.smtpSecure ?? false),
    smtpUser: String(input.smtpUser ?? previous?.smtpUser ?? "").trim(),
    smtpPass: encryptSecretValue(smtpPass),
    fromName: String(input.fromName ?? previous?.fromName ?? site?.brandName ?? "Cloud").trim() || "Cloud",
    fromEmail: String(input.fromEmail ?? previous?.fromEmail ?? site?.supportEmail ?? "").trim(),
    replyTo: String(input.replyTo ?? previous?.replyTo ?? "").trim() || null,
    enabled: Boolean(input.enabled ?? previous?.enabled ?? false),
  }

  const row = previous
    ? await prisma.emailConfig.update({ where: { id: previous.id }, data: payload })
    : await prisma.emailConfig.create({ data: payload })
  const config = await fromDbRow(row)
  if (!config) throw new Error("Unable to save email configuration")
  return toPublic(config)
}

export function publicToLegacySmtp(config: EmailConfigPublic | EmailConfigResolved | null) {
  const smtpPort = normalizePort(config?.smtpPort)
  const smtpSecure = Boolean(config?.smtpSecure)
  return {
    version: 1,
    enabled: Boolean(config?.enabled),
    provider: "custom" as const,
    mailFromName: config?.fromName || "Cloud",
    mailFromAddress: config?.fromEmail || "",
    replyTo: config?.replyTo || "",
    testEmailRecipient: "",
    host: config?.smtpHost || "",
    port: smtpPort,
    username: config?.smtpUser || "",
    password: config?.smtpPass || "",
    encryption: smtpSecure ? "ssl_tls" as const : "starttls" as const,
    supportFromAddress: "",
    billingFromAddress: "",
    accountsFromAddress: "",
    adminFromAddress: "",
    smtpLastTestStatus: "not_tested" as const,
    smtpLastTestAt: "",
    smtpLastErrorCode: "",
    smtpLastErrorMessage: "",
  }
}
