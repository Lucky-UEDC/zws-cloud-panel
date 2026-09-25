import { prisma } from "@/lib/db"
import { getRedisClient } from "@/lib/redis"
import { decryptSecretValue, encryptSecretValue } from "@/lib/secret-crypto"

export const INTEGRATION_CONFIG_KEY = "runtime_service_integrations"

export const INTEGRATION_SECTIONS = {
  integrations: ["cashfree", "phonepe", "googleOAuth", "googleDriveBackups", "googleDriveAttachmentStorage", "whatsappApi", "whatsappGateway", "telegramApi", "backups", "cloudflareOAuth", "cloudflareR2"],
  seo: ["googleSearchConsole"],
  analytics: ["googleAnalytics", "cloudflareAnalytics"],
  geo: ["exchangeRates", "geoIp", "redisOverrides"],
  notifications: ["smtp", "whatsappApi", "telegramApi"],
} as const

const DEFAULT_RUNTIME_INTEGRATIONS: RuntimeIntegrationConfig = {
  exchangeRates: { provider: "openexchangerates", appId: "b6f9bbf96d3f4297be7a92c8e7e8fcb0", symbols: "INR" },
  geoIp: { provider: "maxmind", apiKey: "", url: "", maxmindDbPath: "" },
  googleOAuth: { enabled: false, clientId: "", clientSecret: "", redirectUri: "" },
  googleDriveBackups: { enabled: false, clientId: "", clientSecret: "", refreshToken: "", folderId: "", folderName: "ZWS Backups" },
  googleDriveAttachmentStorage: { enabled: false, rcloneRemote: "", driveFolder: "ZWS Ticket Attachments", sharedDrive: "" },
  smtp: { smtpHost: "", smtpPort: 587, smtpSecure: false, smtpUser: "", smtpPass: "", smtpFrom: "" },
  googleAnalytics: { measurementId: "" },
  googleSearchConsole: { siteUrl: "", serviceAccountJson: "" },
  cloudflareAnalytics: { accountId: "", zoneId: "", apiToken: "", email: "" },
  cloudflareOAuth: { enabled: false, clientId: "", clientSecret: "", redirectUri: "", scopes: "account:read zone:read dns:edit tunnel:edit" },
  cloudflareR2: { accountId: "", bucket: "", endpoint: "", accessKey: "", secretKey: "" },
  whatsappApi: { provider: "evolution", serverUrl: "", instanceId: "", instanceName: "", instanceToken: "", apiKey: "", webhookUrl: "", webhookSecret: "", testRecipient: "", connectedNumber: "" },
  whatsappGateway: { provider: "whatsapp_gateway", enabled: false, apiBaseUrl: "", authType: "bearer", apiKeyHeader: "x-api-key", apiKey: "", apiToken: "", basicUsername: "", requestTimeoutMs: 20000, retryEnabled: true, maxRetries: 2, retryDelayMs: 1000, defaultWabaId: "", defaultSenderNumber: "", defaultSenderNumberId: "", connectionTestPath: "/api/whatsapp/phone-numbers", loggingEnabled: true, mediaUrlPolicy: "public" },
  telegramApi: { botUsername: "", token: "" },
  backups: { provider: "local", remote: "", retentionDays: 30, scheduleCron: "" },
  redisOverrides: { url: "", tls: "" },
}

const SECRET_FIELDS = new Set([
  "apiKey",
  "apiSecret",
  "clientSecret",
  "clientId",
  "appId",
  "secretKey",
  "webhookSecret",
  "serviceAccountJson",
  "privateKey",
  "accessToken",
  "accessKey",
  "refreshToken",
  "apiToken",
  "password",
  "token",
  "dsn",
  "url",
  "config",
])

export type RuntimeIntegrationConfig = Record<string, Record<string, unknown>>

const CACHE_KEY = "runtime-integrations:v2"
const CACHE_TTL_SECONDS = 60
let memoryCache: { encrypted: RuntimeIntegrationConfig; expiresAt: number } | null = null

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isMasked(value: unknown) {
  return /^\*{6,}$/.test(String(value || ""))
}

function serializeValue(value: unknown) {
  return JSON.stringify({ value })
}

function parseValue(value: string) {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === "object" && "value" in parsed) return (parsed as any).value
  } catch {
    // Older rows may contain a raw string.
  }
  return value
}

export function maskIntegrationConfig(input: RuntimeIntegrationConfig | null | undefined): RuntimeIntegrationConfig {
  const output: RuntimeIntegrationConfig = {}
  for (const [service, config] of Object.entries({ ...DEFAULT_RUNTIME_INTEGRATIONS, ...object(input) })) {
    output[service] = {}
    for (const [key, value] of Object.entries(object(config))) {
      output[service][key] = SECRET_FIELDS.has(key) && value ? "********" : value
    }
  }
  return output
}

function decryptConfig(input: RuntimeIntegrationConfig): RuntimeIntegrationConfig {
  const output: RuntimeIntegrationConfig = {}
  for (const [service, config] of Object.entries({ ...DEFAULT_RUNTIME_INTEGRATIONS, ...object(input) })) {
    output[service] = {}
    for (const [key, value] of Object.entries(object(config))) {
      output[service][key] = value ? parseValue(decryptSecretValue(String(value))) : value
    }
  }
  return output
}

function encryptConfig(input: RuntimeIntegrationConfig, previous: RuntimeIntegrationConfig = {}): RuntimeIntegrationConfig {
  const output: RuntimeIntegrationConfig = {}
  const services = new Set([...Object.keys(DEFAULT_RUNTIME_INTEGRATIONS), ...Object.keys(object(previous)), ...Object.keys(object(input))])
  for (const service of services) {
    output[service] = {}
    const previousService = { ...object(DEFAULT_RUNTIME_INTEGRATIONS[service]), ...object(previous[service]) }
    const nextService = object(input[service])
    const keys = new Set([...Object.keys(previousService), ...Object.keys(nextService)])
    for (const key of keys) {
      const next = nextService[key]
      if (isMasked(next)) {
        output[service][key] = previousService[key] || ""
      } else {
        const resolved = next === undefined ? previousService[key] : next
        output[service][key] = resolved === undefined || resolved === null || resolved === "" ? "" : encryptSecretValue(serializeValue(resolved))
      }
    }
  }
  return output
}

async function redisGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    await redis.connect().catch(() => undefined)
    const raw = await redis.get(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

async function redisSet(key: string, value: unknown, ttlSeconds: number) {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
  } catch {
    // In-process cache and DB remain authoritative.
  }
}

async function redisDelete(key: string) {
  const redis = getRedisClient()
  if (!redis) return
  try {
    await redis.connect().catch(() => undefined)
    await redis.del(key)
  } catch {
    // Cache invalidation is best-effort when Redis is unavailable.
  }
}

async function legacyRow() {
  return (prisma as any).appSetting.findUnique({ where: { key: INTEGRATION_CONFIG_KEY } }).catch(() => null)
}

async function readRuntimeIntegrationRows(): Promise<RuntimeIntegrationConfig> {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.encrypted
  const redisCached = await redisGet<RuntimeIntegrationConfig>(CACHE_KEY)
  if (redisCached) {
    memoryCache = { encrypted: redisCached, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 }
    return redisCached
  }
  const rows = await (prisma as any).runtimeIntegration.findMany().catch(async () => {
    const legacy = object((await legacyRow())?.value) as RuntimeIntegrationConfig
    return Object.entries(legacy).flatMap(([provider, config]) =>
      Object.entries(object(config)).map(([keyName, keyValueEncrypted]) => ({ provider, keyName, keyValueEncrypted, isEnabled: true })),
    )
  })
  const encrypted: RuntimeIntegrationConfig = {}
  for (const row of rows || []) {
    if (!row?.isEnabled) continue
    const provider = String(row.provider || "").trim()
    const keyName = String(row.keyName || row.key_name || "").trim()
    if (!provider || !keyName) continue
    encrypted[provider] ||= {}
    encrypted[provider][keyName] = row.keyValueEncrypted || row.key_value_encrypted || ""
  }
  if (!Object.keys(encrypted).length) {
    Object.assign(encrypted, object((await legacyRow())?.value) as RuntimeIntegrationConfig)
  }
  memoryCache = { encrypted, expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000 }
  await redisSet(CACHE_KEY, encrypted, CACHE_TTL_SECONDS)
  return encrypted
}

export async function invalidateRuntimeIntegrationCache() {
  memoryCache = null
  await redisDelete(CACHE_KEY)
}

export async function getRuntimeIntegrationConfig(options: { decrypted?: boolean; masked?: boolean } = {}) {
  const encrypted = await readRuntimeIntegrationRows()
  if (options.decrypted) return decryptConfig(encrypted)
  if (options.masked !== false) return maskIntegrationConfig(decryptConfig(encrypted))
  return encrypted
}

export async function updateRuntimeIntegrationConfig(input: RuntimeIntegrationConfig, updatedBy?: string | null) {
  const previous = await readRuntimeIntegrationRows()
  const encrypted = encryptConfig(input, previous)
  try {
    for (const [provider, config] of Object.entries(encrypted)) {
      for (const [keyName, keyValueEncrypted] of Object.entries(object(config))) {
        await (prisma as any).runtimeIntegration.upsert({
          where: { provider_keyName: { provider, keyName } },
          update: { keyValueEncrypted: String(keyValueEncrypted || ""), isEnabled: true },
          create: { provider, keyName, keyValueEncrypted: String(keyValueEncrypted || ""), isEnabled: true },
        })
      }
    }
  } catch {
    await (prisma as any).appSetting.upsert({
      where: { key: INTEGRATION_CONFIG_KEY },
      update: { value: encrypted as any, group: "integrations", isSecret: true, updatedBy: updatedBy || null },
      create: { key: INTEGRATION_CONFIG_KEY, value: encrypted as any, group: "integrations", isSecret: true, updatedBy: updatedBy || null },
    })
  }
  await invalidateRuntimeIntegrationCache()
  return maskIntegrationConfig(decryptConfig(encrypted))
}

export async function getServiceIntegrationConfig(service: string) {
  const config = await getRuntimeIntegrationConfig({ decrypted: true })
  return object(config[service])
}
