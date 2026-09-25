import { isIP } from "node:net"
import { prisma } from "@/lib/db"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"
import { maskSecret } from "@/lib/settings"
import type { SecurityContext } from "@/lib/security/abuse"

const CACHE_MS = 30_000

type CacheEntry = {
  expiresAt: number
  value: RuntimeSecuritySettings
}

let cache: CacheEntry | null = null

export type TurnstileMode = "managed" | "invisible" | "non_interactive"
export type CloudflareSecurityMode = "OFF" | "LOW" | "MEDIUM" | "HIGH" | "ENTERPRISE"
export type TurnstileSurface =
  | "login"
  | "signup"
  | "register"
  | "forgotPassword"
  | "contact"
  | "checkout"
  | "tickets"
  | "support"
  | "orders"
  | "adminLogin"

export type TurnstileProtectionFlags = Record<TurnstileSurface, boolean>

export type RuntimeSecuritySettings = {
  id: string
  enabled: boolean
  mode: CloudflareSecurityMode
  turnstileEnabled: boolean
  turnstileSiteKey: string
  turnstileSecretKey: string
  turnstileMode: TurnstileMode
  protectLogin: boolean
  protectSignup: boolean
  protectRegister: boolean
  protectForgotPassword: boolean
  protectContact: boolean
  protectCheckout: boolean
  protectTickets: boolean
  protectSupport: boolean
  protectOrders: boolean
  protectAdminLogin: boolean
  whitelistEnabled: boolean
  whitelistIPs: string[]
  whitelistCIDRs: string[]
  whitelistEmails: string[]
  whitelistCustomerIds: string[]
  lastVerificationAt?: Date | null
  lastVerificationStatus?: string | null
  otpEnabled: boolean
  rateLimitEnabled: boolean
  xssProtectionEnabled: boolean
  riskScoringEnabled: boolean
  botDetectionEnabled: boolean
  createdAt?: Date
  updatedAt?: Date
}

export type PublicTurnstileConfig = {
  enabled: boolean
  siteKey: string
  mode: TurnstileMode
  securityMode: CloudflareSecurityMode
  cloudflareEnabled: boolean
  protect: TurnstileProtectionFlags
}

export type AdminSecuritySettings = Omit<RuntimeSecuritySettings, "turnstileSecretKey"> & {
  turnstileSecretKey: string
  turnstileConfigured: boolean
  status?: AdminSecurityStatus
}

export type AdminSecurityStatus = {
  totalRequests: number
  blockedRequests: number
  captchaPasses: number
  captchaFailures: number
  averageRiskScore: number
  ipBans: number
  falsePositives: number
  captchaRequests: number
  blockedBots: number
  failedVerifications: number
  verificationApi: "not_tested" | "reachable" | "failed"
  lastVerificationAt: Date | null
  lastVerificationStatus: string | null
}

const cloudflareDefaults = {
  enabled: false,
  mode: "OFF",
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  turnstileMode: "managed",
  protectLogin: true,
  protectRegister: true,
  protectForgotPassword: true,
  protectContact: true,
  protectCheckout: true,
  protectSupport: true,
  protectOrders: true,
  protectAdminLogin: true,
  whitelistEnabled: false,
  whitelistIPs: [],
  whitelistCIDRs: [],
  whitelistEmails: [],
  whitelistCustomerIds: [],
  rateLimitEnabled: true,
  riskScoringEnabled: true,
  botDetectionEnabled: true,
}

const legacyDefaults = {
  turnstileEnabled: false,
  turnstileSiteKey: "",
  turnstileSecretKey: "",
  turnstileMode: "managed",
  protectLogin: true,
  protectSignup: true,
  protectContact: true,
  protectCheckout: true,
  protectTickets: true,
  otpEnabled: true,
  rateLimitEnabled: true,
  xssProtectionEnabled: true,
}

export function clearSystemSecuritySettingsCache() {
  cache = null
}

export function validateTurnstileSiteKey(value: unknown) {
  const key = String(value || "").trim()
  if (!key) return ""
  if (!/^0x[A-Za-z0-9_-]{20,120}$/.test(key)) {
    throw new Error("Turnstile site key must start with 0x and use only safe key characters.")
  }
  return key
}

export function validateTurnstileSecretKey(value: unknown) {
  const key = String(value || "").trim()
  if (!key) return ""
  if (!/^0x[A-Za-z0-9_-]{20,180}$/.test(key)) {
    throw new Error("Turnstile secret key must start with 0x and use only safe key characters.")
  }
  return key
}

export function validateTurnstileMode(value: unknown): TurnstileMode {
  const mode = String(value || "managed").trim()
  if (mode === "managed" || mode === "invisible" || mode === "non_interactive") return mode
  throw new Error("Captcha mode must be managed, invisible, or non_interactive.")
}

export function validateCloudflareSecurityMode(value: unknown): CloudflareSecurityMode {
  const mode = String(value || "OFF").trim().toUpperCase()
  if (mode === "OFF" || mode === "LOW" || mode === "MEDIUM" || mode === "HIGH" || mode === "ENTERPRISE") return mode
  throw new Error("Cloudflare security mode must be OFF, LOW, MEDIUM, HIGH, or ENTERPRISE.")
}

export function isMaskedTurnstileSecret(value: unknown) {
  const text = String(value || "")
  return text === "__MASKED__" || text.startsWith("••••")
}

function stringList(value: unknown) {
  const raw = Array.isArray(value) ? value : []
  return raw.map((entry) => String(entry || "").trim()).filter(Boolean)
}

function normalizedEmailList(value: unknown) {
  return stringList(value).map((entry) => entry.toLowerCase())
}

function normalizeSurface(surface: TurnstileSurface): Exclude<TurnstileSurface, "signup" | "tickets"> {
  if (surface === "signup") return "register"
  if (surface === "tickets") return "support"
  return surface
}

function protectionFlags(settings: RuntimeSecuritySettings): TurnstileProtectionFlags {
  return {
    login: settings.protectLogin,
    signup: settings.protectRegister,
    register: settings.protectRegister,
    forgotPassword: settings.protectForgotPassword,
    contact: settings.protectContact,
    checkout: settings.protectCheckout,
    tickets: settings.protectSupport,
    support: settings.protectSupport,
    orders: settings.protectOrders,
    adminLogin: settings.protectAdminLogin,
  }
}

export function isTurnstileSurfaceProtected(settings: RuntimeSecuritySettings, surface: TurnstileSurface) {
  return protectionFlags(settings)[surface] !== false
}

export function isCloudflareProtectionActive(settings: Pick<RuntimeSecuritySettings, "enabled" | "mode">) {
  return Boolean(settings.enabled && settings.mode !== "OFF")
}

export function isCloudflareCaptchaRequired(settings: RuntimeSecuritySettings, surface: TurnstileSurface) {
  return isCloudflareProtectionActive(settings) && isTurnstileSurfaceProtected(settings, surface)
}

export function isCloudflareRateLimitEnabled(settings: Pick<RuntimeSecuritySettings, "enabled" | "mode" | "rateLimitEnabled">) {
  return Boolean(settings.rateLimitEnabled && settings.enabled && (settings.mode === "MEDIUM" || settings.mode === "HIGH" || settings.mode === "ENTERPRISE"))
}

function legacyFromRow(row: any) {
  return {
    turnstileSiteKey: String(row?.turnstileSiteKey || ""),
    turnstileSecretKey: String(row?.turnstileSecretKey || ""),
    turnstileMode: validateTurnstileMode(row?.turnstileMode),
    protectLogin: row?.protectLogin === undefined ? true : Boolean(row.protectLogin),
    protectRegister: row?.protectSignup === undefined ? true : Boolean(row.protectSignup),
    protectForgotPassword: row?.protectLogin === undefined ? true : Boolean(row.protectLogin),
    protectContact: row?.protectContact === undefined ? true : Boolean(row.protectContact),
    protectCheckout: row?.protectCheckout === undefined ? true : Boolean(row.protectCheckout),
    protectSupport: row?.protectTickets === undefined ? true : Boolean(row.protectTickets),
    protectOrders: row?.protectCheckout === undefined ? true : Boolean(row.protectCheckout),
    protectAdminLogin: row?.protectLogin === undefined ? true : Boolean(row.protectLogin),
    lastVerificationAt: row?.lastVerificationAt || null,
    lastVerificationStatus: row?.lastVerificationStatus || null,
    rateLimitEnabled: row?.rateLimitEnabled === undefined ? true : Boolean(row.rateLimitEnabled),
  }
}

async function getLegacySystemSecuritySettings() {
  let row = await (prisma as any).systemSecuritySettings.findFirst({
    orderBy: { createdAt: "asc" },
  }).catch(() => null)

  if (!row) {
    row = await (prisma as any).systemSecuritySettings.create({
      data: legacyDefaults,
    }).catch(() => null)
  }

  return row ? legacyFromRow(row) : legacyFromRow(null)
}

function fromCloudflareRow(row: any): RuntimeSecuritySettings {
  const mode = validateCloudflareSecurityMode(row.mode)
  const enabled = Boolean(row.enabled && mode !== "OFF")
  const protectRegister = row.protectRegister === undefined ? true : Boolean(row.protectRegister)
  const protectSupport = row.protectSupport === undefined ? true : Boolean(row.protectSupport)
  return {
    id: row.id,
    enabled,
    mode: enabled ? mode : "OFF",
    turnstileEnabled: enabled,
    turnstileSiteKey: String(row.turnstileSiteKey || ""),
    turnstileSecretKey: decryptSecretValue(String(row.turnstileSecretKey || "")),
    turnstileMode: validateTurnstileMode(row.turnstileMode),
    protectLogin: row.protectLogin === undefined ? true : Boolean(row.protectLogin),
    protectSignup: protectRegister,
    protectRegister,
    protectForgotPassword: row.protectForgotPassword === undefined ? true : Boolean(row.protectForgotPassword),
    protectContact: row.protectContact === undefined ? true : Boolean(row.protectContact),
    protectCheckout: row.protectCheckout === undefined ? true : Boolean(row.protectCheckout),
    protectTickets: protectSupport,
    protectSupport,
    protectOrders: row.protectOrders === undefined ? true : Boolean(row.protectOrders),
    protectAdminLogin: row.protectAdminLogin === undefined ? true : Boolean(row.protectAdminLogin),
    whitelistEnabled: Boolean(row.whitelistEnabled),
    whitelistIPs: stringList(row.whitelistIPs),
    whitelistCIDRs: stringList(row.whitelistCIDRs),
    whitelistEmails: normalizedEmailList(row.whitelistEmails),
    whitelistCustomerIds: stringList(row.whitelistCustomerIds),
    lastVerificationAt: row.lastVerificationAt || null,
    lastVerificationStatus: row.lastVerificationStatus || null,
    otpEnabled: true,
    rateLimitEnabled: row.rateLimitEnabled === undefined ? true : Boolean(row.rateLimitEnabled),
    xssProtectionEnabled: true,
    riskScoringEnabled: row.riskScoringEnabled === undefined ? true : Boolean(row.riskScoringEnabled),
    botDetectionEnabled: row.botDetectionEnabled === undefined ? true : Boolean(row.botDetectionEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toAdminSettings(settings: RuntimeSecuritySettings): AdminSecuritySettings {
  return {
    ...settings,
    turnstileSecretKey: maskSecret(settings.turnstileSecretKey),
    turnstileConfigured: Boolean(settings.turnstileSiteKey && settings.turnstileSecretKey),
  }
}

export async function getSystemSecuritySettings(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cache && cache.expiresAt > Date.now()) return cache.value

  let row = await (prisma as any).cloudflareSecuritySettings.findFirst({
    orderBy: { createdAt: "asc" },
  }).catch(() => null)

  if (!row) {
    const legacy = await getLegacySystemSecuritySettings()
    row = await (prisma as any).cloudflareSecuritySettings.create({
      data: {
        ...cloudflareDefaults,
        enabled: false,
        mode: "OFF",
        turnstileSiteKey: legacy.turnstileSiteKey,
        turnstileSecretKey: legacy.turnstileSecretKey,
        turnstileMode: legacy.turnstileMode,
        protectLogin: legacy.protectLogin,
        protectRegister: legacy.protectRegister,
        protectForgotPassword: legacy.protectForgotPassword,
        protectContact: legacy.protectContact,
        protectCheckout: legacy.protectCheckout,
        protectSupport: legacy.protectSupport,
        protectOrders: legacy.protectOrders,
        protectAdminLogin: legacy.protectAdminLogin,
        lastVerificationAt: legacy.lastVerificationAt,
        lastVerificationStatus: legacy.lastVerificationStatus,
        rateLimitEnabled: legacy.rateLimitEnabled,
      },
    })
  }

  const value = fromCloudflareRow(row)
  cache = { value, expiresAt: Date.now() + CACHE_MS }
  return value
}

export const getCloudflareSecuritySettings = getSystemSecuritySettings

export async function getPublicTurnstileConfig(): Promise<PublicTurnstileConfig> {
  const settings = await getSystemSecuritySettings()
  const enabled = Boolean(isCloudflareProtectionActive(settings) && settings.turnstileSiteKey)
  return {
    enabled,
    siteKey: enabled ? settings.turnstileSiteKey : "",
    mode: settings.turnstileMode,
    securityMode: settings.mode,
    cloudflareEnabled: settings.enabled,
    protect: protectionFlags(settings),
  }
}

export async function getAdminSecuritySettings() {
  return toAdminSettings(await getSystemSecuritySettings({ fresh: true }))
}

export async function getAdminSecurityStatus(): Promise<AdminSecurityStatus> {
  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const activePermanentIpWhere = {
    unblockedAt: null,
    permanent: true,
  }
  const [settings, totalRequests, blockedRequests, captchaPasses, captchaFailures, suspiciousBots, ipBans, falsePositives] = await Promise.all([
    getSystemSecuritySettings({ fresh: true }).catch(() => null),
    (prisma as any).securityEvent.count({ where: { createdAt: { gte: since } } }).catch(() => 0),
    (prisma as any).securityEvent.count({
      where: {
        actionTaken: { in: ["denied", "blocked", "rate_limited"] },
        createdAt: { gte: since },
      },
    }).catch(() => 0),
    (prisma as any).securityEvent.count({
      where: { eventType: "captcha_verified", createdAt: { gte: since } },
    }).catch(() => 0),
    (prisma as any).securityEvent.count({
      where: {
        eventType: { in: ["captcha_failed", "captcha_replay", "captcha_provider_error", "captcha_missing", "captcha_action_mismatch"] },
        createdAt: { gte: since },
      },
    }).catch(() => 0),
    (prisma as any).suspiciousRequest.count({
      where: {
        reason: { in: ["captcha_missing", "captcha_failed", "captcha_replay", "captcha_abuse", "rate_limit_abuse", "otp_rate_limit_abuse", "otp_daily_abuse"] },
        createdAt: { gte: since },
      },
    }).catch(() => 0),
    (prisma as any).blockedIp.count({ where: activePermanentIpWhere }).catch(() => 0),
    (prisma as any).securityEvent.count({
      where: {
        eventType: { in: ["verified_login_unblocked_soft_security_block", "cloudflare_soft_block_bypassed", "cloudflare_whitelist_bypass"] },
        createdAt: { gte: since },
      },
    }).catch(() => 0),
  ])
  return {
    totalRequests,
    blockedRequests,
    captchaPasses,
    captchaFailures,
    averageRiskScore: 0,
    ipBans,
    falsePositives,
    captchaRequests: captchaPasses + captchaFailures,
    blockedBots: suspiciousBots + ipBans,
    failedVerifications: captchaFailures,
    verificationApi: settings?.lastVerificationStatus === "success" ? "reachable" : settings?.lastVerificationStatus === "failed" ? "failed" : "not_tested",
    lastVerificationAt: settings?.lastVerificationAt || null,
    lastVerificationStatus: settings?.lastVerificationStatus || null,
  }
}

export async function updateSystemSecuritySettings(input: Record<string, unknown>) {
  const previous = await getSystemSecuritySettings({ fresh: true })
  const rawMode = input.mode ?? input.cloudflareMode ?? (input.turnstileEnabled === false ? "OFF" : previous.mode)
  const mode = validateCloudflareSecurityMode(rawMode)
  const enabled = input.enabled === undefined
    ? input.turnstileEnabled === undefined
      ? previous.enabled
      : Boolean(input.turnstileEnabled)
    : Boolean(input.enabled)
  const active = Boolean(enabled && mode !== "OFF")
  const siteKey = input.turnstileSiteKey === undefined
    ? previous.turnstileSiteKey
    : validateTurnstileSiteKey(input.turnstileSiteKey)
  const incomingSecret = input.turnstileSecretKey === undefined ? "__MASKED__" : String(input.turnstileSecretKey || "").trim()
  const secret = isMaskedTurnstileSecret(incomingSecret)
    ? previous.turnstileSecretKey
    : validateTurnstileSecretKey(incomingSecret)
  const turnstileMode = validateTurnstileMode(input.turnstileMode || previous.turnstileMode)

  if (active && (!siteKey || !secret)) {
    throw new Error("Turnstile site key and secret key are required before enabling Cloudflare protection.")
  }

  const saved = await (prisma as any).cloudflareSecuritySettings.update({
    where: { id: previous.id },
    data: {
      enabled: active,
      mode: active ? mode : "OFF",
      turnstileSiteKey: siteKey,
      turnstileSecretKey: secret ? encryptSecretValue(secret) : "",
      turnstileMode,
      protectLogin: input.protectLogin === undefined ? previous.protectLogin : Boolean(input.protectLogin),
      protectRegister: input.protectRegister === undefined
        ? input.protectSignup === undefined ? previous.protectRegister : Boolean(input.protectSignup)
        : Boolean(input.protectRegister),
      protectForgotPassword: input.protectForgotPassword === undefined ? previous.protectForgotPassword : Boolean(input.protectForgotPassword),
      protectContact: input.protectContact === undefined ? previous.protectContact : Boolean(input.protectContact),
      protectCheckout: input.protectCheckout === undefined ? previous.protectCheckout : Boolean(input.protectCheckout),
      protectSupport: input.protectSupport === undefined
        ? input.protectTickets === undefined ? previous.protectSupport : Boolean(input.protectTickets)
        : Boolean(input.protectSupport),
      protectOrders: input.protectOrders === undefined ? previous.protectOrders : Boolean(input.protectOrders),
      protectAdminLogin: input.protectAdminLogin === undefined ? previous.protectAdminLogin : Boolean(input.protectAdminLogin),
      whitelistEnabled: input.whitelistEnabled === undefined ? previous.whitelistEnabled : Boolean(input.whitelistEnabled),
      whitelistIPs: input.whitelistIPs === undefined ? previous.whitelistIPs : stringList(input.whitelistIPs),
      whitelistCIDRs: input.whitelistCIDRs === undefined ? previous.whitelistCIDRs : stringList(input.whitelistCIDRs),
      whitelistEmails: input.whitelistEmails === undefined ? previous.whitelistEmails : normalizedEmailList(input.whitelistEmails),
      whitelistCustomerIds: input.whitelistCustomerIds === undefined ? previous.whitelistCustomerIds : stringList(input.whitelistCustomerIds),
      rateLimitEnabled: input.rateLimitEnabled === undefined ? previous.rateLimitEnabled : Boolean(input.rateLimitEnabled),
      riskScoringEnabled: input.riskScoringEnabled === undefined ? previous.riskScoringEnabled : Boolean(input.riskScoringEnabled),
      botDetectionEnabled: input.botDetectionEnabled === undefined ? previous.botDetectionEnabled : Boolean(input.botDetectionEnabled),
    },
  })

  clearSystemSecuritySettingsCache()
  return toAdminSettings(fromCloudflareRow(saved))
}

export async function recordTurnstileVerificationStatus(success: boolean) {
  const current = await getSystemSecuritySettings({ fresh: true })
  const saved = await (prisma as any).cloudflareSecuritySettings.update({
    where: { id: current.id },
    data: {
      lastVerificationAt: new Date(),
      lastVerificationStatus: success ? "success" : "failed",
    },
  })
  clearSystemSecuritySettingsCache()
  return fromCloudflareRow(saved)
}

function ipv4ToNumber(ip: string) {
  const parts = ip.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function ipv4InCidr(ip: string, cidr: string) {
  const [base, bitsRaw] = cidr.split("/")
  const bits = Number(bitsRaw)
  const ipNum = ipv4ToNumber(ip)
  const baseNum = ipv4ToNumber(base || "")
  if (ipNum === null || baseNum === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (ipNum & mask) === (baseNum & mask)
}

export function isIpInCidrList(ip: string | null | undefined, cidrs: string[]) {
  if (!ip || ip === "unknown") return false
  return cidrs.some((cidr) => {
    const value = String(cidr || "").trim()
    if (!value.includes("/")) return false
    if (isIP(ip) === 4 && isIP(value.split("/")[0]) === 4) return ipv4InCidr(ip, value)
    return false
  })
}

export async function isCloudflareWhitelisted(
  ctx: Pick<SecurityContext, "ip">,
  identity: { email?: string | null; customerId?: string | null } = {},
) {
  const settings = await getSystemSecuritySettings()
  if (!settings.whitelistEnabled) return false
  const ip = ctx.ip && ctx.ip !== "unknown" ? ctx.ip : ""
  const email = String(identity.email || "").trim().toLowerCase()
  const customerId = String(identity.customerId || "").trim()
  return Boolean(
    (ip && settings.whitelistIPs.includes(ip)) ||
    (ip && isIpInCidrList(ip, settings.whitelistCIDRs)) ||
    (email && settings.whitelistEmails.includes(email)) ||
    (customerId && settings.whitelistCustomerIds.includes(customerId))
  )
}
