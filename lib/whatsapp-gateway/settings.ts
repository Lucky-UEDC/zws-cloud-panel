import { getRuntimeIntegrationConfig, updateRuntimeIntegrationConfig } from "@/lib/integration-config"
import type { WhatsAppGatewayAuthType, WhatsAppGatewayMediaUrlPolicy } from "@/lib/whatsapp-gateway/types"

export const WHATSAPP_GATEWAY_SERVICE = "whatsappGateway"
export const WHATSAPP_GATEWAY_PROVIDER = "whatsapp_gateway"

export const GATEWAY_MASKED_PATTERN = /^\*{6,}$/

export type WhatsAppGatewaySettings = {
  provider: typeof WHATSAPP_GATEWAY_PROVIDER
  enabled: boolean
  apiBaseUrl: string
  authType: WhatsAppGatewayAuthType
  apiKeyHeader: string
  apiKey: string
  apiToken: string
  basicUsername: string
  requestTimeoutMs: number
  retryEnabled: boolean
  maxRetries: number
  retryDelayMs: number
  defaultWabaId: string
  defaultSenderNumber: string
  defaultSenderNumberId: string
  connectionTestPath: string
  loggingEnabled: boolean
  mediaUrlPolicy: WhatsAppGatewayMediaUrlPolicy
}

export type WhatsAppGatewayPublicSettings = Omit<
  WhatsAppGatewaySettings,
  "apiKey" | "apiToken" | "provider"
> & {
  provider: typeof WHATSAPP_GATEWAY_PROVIDER
  apiKeyConfigured: boolean
  apiTokenConfigured: boolean
}

export const DEFAULT_GATEWAY_SETTINGS: WhatsAppGatewaySettings = {
  provider: WHATSAPP_GATEWAY_PROVIDER,
  enabled: false,
  apiBaseUrl: "",
  authType: "bearer",
  apiKeyHeader: "x-api-key",
  apiKey: "",
  apiToken: "",
  basicUsername: "",
  requestTimeoutMs: 20000,
  retryEnabled: true,
  maxRetries: 2,
  retryDelayMs: 1000,
  defaultWabaId: "",
  defaultSenderNumber: "",
  defaultSenderNumberId: "",
  connectionTestPath: "/api/whatsapp/phone-numbers",
  loggingEnabled: true,
  mediaUrlPolicy: "public",
}

function text(value: unknown) {
  return String(value || "").trim()
}

function bool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return fallback
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(text(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function getGatewaySettings(): Promise<WhatsAppGatewaySettings> {
  const config = await getRuntimeIntegrationConfig({ decrypted: true, masked: false }).catch(() => ({}) as never)
  const section = object(config[WHATSAPP_GATEWAY_SERVICE])
  return {
    provider: WHATSAPP_GATEWAY_PROVIDER,
    enabled: bool(section.enabled, DEFAULT_GATEWAY_SETTINGS.enabled),
    apiBaseUrl: text(section.apiBaseUrl || ""),
    authType: (["api_key", "bearer", "basic", "none"].includes(text(section.authType)) ? text(section.authType) : DEFAULT_GATEWAY_SETTINGS.authType) as WhatsAppGatewayAuthType,
    apiKeyHeader: text(section.apiKeyHeader) || DEFAULT_GATEWAY_SETTINGS.apiKeyHeader,
    apiKey: text(section.apiKey),
    apiToken: text(section.apiToken),
    basicUsername: text(section.basicUsername),
    requestTimeoutMs: integer(section.requestTimeoutMs, DEFAULT_GATEWAY_SETTINGS.requestTimeoutMs, 2000, 120000),
    retryEnabled: bool(section.retryEnabled, DEFAULT_GATEWAY_SETTINGS.retryEnabled),
    maxRetries: integer(section.maxRetries, DEFAULT_GATEWAY_SETTINGS.maxRetries, 0, 5),
    retryDelayMs: integer(section.retryDelayMs, DEFAULT_GATEWAY_SETTINGS.retryDelayMs, 0, 10000),
    defaultWabaId: text(section.defaultWabaId),
    defaultSenderNumber: text(section.defaultSenderNumber),
    defaultSenderNumberId: text(section.defaultSenderNumberId),
    connectionTestPath: text(section.connectionTestPath) || DEFAULT_GATEWAY_SETTINGS.connectionTestPath,
    loggingEnabled: bool(section.loggingEnabled, DEFAULT_GATEWAY_SETTINGS.loggingEnabled),
    mediaUrlPolicy: section.mediaUrlPolicy === "any" ? "any" : "public",
  }
}

export function publicGatewaySettings(settings: WhatsAppGatewaySettings): WhatsAppGatewayPublicSettings {
  return {
    provider: settings.provider,
    enabled: settings.enabled,
    apiBaseUrl: settings.apiBaseUrl,
    authType: settings.authType,
    apiKeyHeader: settings.apiKeyHeader,
    basicUsername: settings.basicUsername,
    requestTimeoutMs: settings.requestTimeoutMs,
    retryEnabled: settings.retryEnabled,
    maxRetries: settings.maxRetries,
    retryDelayMs: settings.retryDelayMs,
    defaultWabaId: settings.defaultWabaId,
    defaultSenderNumber: settings.defaultSenderNumber,
    defaultSenderNumberId: settings.defaultSenderNumberId,
    connectionTestPath: settings.connectionTestPath,
    loggingEnabled: settings.loggingEnabled,
    mediaUrlPolicy: settings.mediaUrlPolicy,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiTokenConfigured: Boolean(settings.apiToken),
  }
}

export function isGatewayConfigured(settings: WhatsAppGatewaySettings) {
  const baseUrlConfigured = /^https?:\/\//i.test(settings.apiBaseUrl)
  const authConfigured = Boolean(
    settings.authType === "none"
      ? settings.apiBaseUrl
      : settings.authType === "basic"
        ? settings.apiBaseUrl && settings.apiToken
        : settings.apiBaseUrl && (settings.apiKey || settings.apiToken),
  )
  return {
    configured: Boolean(settings.enabled && baseUrlConfigured && authConfigured),
    baseUrlConfigured,
    authConfigured,
    authentication: settings.authType,
  }
}

export type GatewaySettingsInput = Partial<WhatsAppGatewaySettings>

export async function updateGatewaySettings(input: GatewaySettingsInput, updatedBy?: string | null): Promise<WhatsAppGatewayPublicSettings> {
  const existing = await getGatewaySettings()
  const next: GatewaySettingsInput = {}

  if (input.enabled !== undefined) next.enabled = Boolean(input.enabled)
  if (input.apiBaseUrl !== undefined) next.apiBaseUrl = text(input.apiBaseUrl)
  if (input.authType !== undefined) next.authType = input.authType
  if (input.apiKeyHeader !== undefined) next.apiKeyHeader = text(input.apiKeyHeader)
  if (input.apiToken !== undefined) next.apiToken = GATEWAY_MASKED_PATTERN.test(text(input.apiToken)) ? existing.apiToken : text(input.apiToken)
  if (input.apiKey !== undefined) next.apiKey = GATEWAY_MASKED_PATTERN.test(text(input.apiKey)) ? existing.apiKey : text(input.apiKey)
  if (input.basicUsername !== undefined) next.basicUsername = text(input.basicUsername)
  if (input.requestTimeoutMs !== undefined) next.requestTimeoutMs = integer(input.requestTimeoutMs, existing.requestTimeoutMs, 2000, 120000)
  if (input.retryEnabled !== undefined) next.retryEnabled = Boolean(input.retryEnabled)
  if (input.maxRetries !== undefined) next.maxRetries = integer(input.maxRetries, existing.maxRetries, 0, 5)
  if (input.retryDelayMs !== undefined) next.retryDelayMs = integer(input.retryDelayMs, existing.retryDelayMs, 0, 10000)
  if (input.defaultWabaId !== undefined) next.defaultWabaId = text(input.defaultWabaId)
  if (input.defaultSenderNumber !== undefined) next.defaultSenderNumber = text(input.defaultSenderNumber)
  if (input.defaultSenderNumberId !== undefined) next.defaultSenderNumberId = text(input.defaultSenderNumberId)
  if (input.connectionTestPath !== undefined) next.connectionTestPath = text(input.connectionTestPath)
  if (input.loggingEnabled !== undefined) next.loggingEnabled = Boolean(input.loggingEnabled)
  if (input.mediaUrlPolicy !== undefined) next.mediaUrlPolicy = input.mediaUrlPolicy

  const merged = { ...existing, ...next }
  const masked = { decrypted: true, masked: false }
  const config = await getRuntimeIntegrationConfig(masked).catch(() => ({}) as never)
  const section = object(config[WHATSAPP_GATEWAY_SERVICE])
  await updateRuntimeIntegrationConfig(
    {
      [WHATSAPP_GATEWAY_SERVICE]: {
        ...section,
        enabled: merged.enabled,
        apiBaseUrl: merged.apiBaseUrl,
        authType: merged.authType,
        apiKeyHeader: merged.apiKeyHeader,
        apiKey: merged.apiKey,
        apiToken: merged.apiToken,
        basicUsername: merged.basicUsername,
        requestTimeoutMs: merged.requestTimeoutMs,
        retryEnabled: merged.retryEnabled,
        maxRetries: merged.maxRetries,
        retryDelayMs: merged.retryDelayMs,
        defaultWabaId: merged.defaultWabaId,
        defaultSenderNumber: merged.defaultSenderNumber,
        defaultSenderNumberId: merged.defaultSenderNumberId,
        connectionTestPath: merged.connectionTestPath,
        loggingEnabled: merged.loggingEnabled,
        mediaUrlPolicy: merged.mediaUrlPolicy,
      },
    },
    updatedBy,
  )
  return publicGatewaySettings(await getGatewaySettings())
}