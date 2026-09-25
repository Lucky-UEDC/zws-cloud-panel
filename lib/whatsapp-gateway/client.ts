import { createHash, randomUUID } from "node:crypto"
import type { WhatsAppGatewaySettings } from "@/lib/whatsapp-gateway/settings"
import {
  pickProviderError,
  sanitizeErrorMessage,
  isTransientError,
  WhatsAppGatewayError,
} from "@/lib/whatsapp-gateway/errors"
import {
  buildSendAudioPayload,
  buildSendDocumentPayload,
  buildSendImagePayload,
  buildSendLocationPayload,
  buildSendMultipleMediaPayload,
  buildSendTextPayload,
  buildSendVideoPayload,
  buildTemplatePayload,
} from "@/lib/whatsapp-gateway/payloads"
import type {
  ConnectionTestResult,
  GatewayConnection,
  GatewayContact,
  GatewayPhoneNumber,
  GatewayWabaPhoneNumber,
  SendAudioInput,
  SendDocumentInput,
  SendImageInput,
  SendLocalMediaInput,
  SendLocationInput,
  SendMultipleMediaInput,
  SendResult,
  SendTextInput,
  SendVideoInput,
  TemplateDraft,
  TemplateResult,
  TemplateWireBody,
} from "@/lib/whatsapp-gateway/types"
import { isGatewayConfigured } from "@/lib/whatsapp-gateway/settings"

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  json?: unknown
  form?: FormData
  timeoutMs?: number
  idempotent?: boolean
}

type FetchLike = (input: any, init?: any) => Promise<Response>

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, "")
  const normalizedPath = path.replace(/^\/+/, "")
  if (!normalizedBase) return `/${normalizedPath}`
  return `${normalizedBase}/${normalizedPath}`
}

export class WhatsAppGatewayProvider {
  readonly settings: WhatsAppGatewaySettings
  private readonly fetchImpl: FetchLike

  constructor(settings: WhatsAppGatewaySettings, fetchImpl: FetchLike = fetch) {
    this.settings = settings
    this.fetchImpl = fetchImpl
  }

  isConfigured() {
    return isGatewayConfigured(this.settings)
  }

  private async request(options: RequestOptions): Promise<{ status: number; data: unknown; latencyMs: number }> {
    if (!this.settings.apiBaseUrl) throw new WhatsAppGatewayError("Gateway base URL is not configured", { code: "NOT_CONFIGURED" })

    const method = options.method ?? (options.json !== undefined || options.form ? "POST" : "GET")
    const idempotent = Boolean(options.idempotent) || method === "GET"
    const timeoutMs = options.timeoutMs ?? this.settings.requestTimeoutMs
    const url = joinUrl(this.settings.apiBaseUrl, options.path)

    const headers = new Headers({ accept: "application/json" })
    if (this.settings.authType === "api_key") {
      headers.set(this.settings.apiKeyHeader || "x-api-key", this.settings.apiKey)
      if (this.settings.apiToken) headers.set("Authorization", `Bearer ${this.settings.apiToken}`)
    } else if (this.settings.authType === "bearer") {
      if (this.settings.apiToken) headers.set("Authorization", `Bearer ${this.settings.apiToken}`)
      else if (this.settings.apiKey) headers.set("Authorization", `Bearer ${this.settings.apiKey}`)
    } else if (this.settings.authType === "basic") {
      if (this.settings.apiToken) headers.set("Authorization", `Basic ${Buffer.from(`${this.settings.basicUsername || "zws"}:${this.settings.apiToken}`).toString("base64")}`)
    }
    if (options.json !== undefined) headers.set("Content-Type", "application/json")

    const allowedAttempts = idempotent && this.settings.retryEnabled ? 1 + this.settings.maxRetries : 1

    let lastError: unknown = null
    let lastStatus = 0
    let lastData: unknown = null

    for (let attempt = 0; attempt < allowedAttempts; attempt += 1) {
      if (attempt > 0) {
        if (this.settings.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.settings.retryDelayMs))
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const init: Record<string, unknown> = {
          method,
          headers,
          signal: controller.signal,
          cache: "no-store",
          redirect: "manual",
        }
        if (options.form) init.body = options.form
        if (options.json !== undefined) init.body = JSON.stringify(options.json)

        const response = await this.fetchImpl(url, init)
        const text = await response.text()
        let data: unknown = null
        if (text.trim()) {
          try {
            data = JSON.parse(text)
          } catch {
            data = { unparsed: text.slice(0, 500) }
          }
        }

        lastStatus = response.status
        lastData = data

        if (!response.ok) {
          lastError = new WhatsAppGatewayError(pickProviderError(data, response.status, `Provider returned HTTP ${response.status}`), {
            status: response.status,
            code: "HTTP_ERROR",
            providerMessage: sanitizeErrorMessage(typeof (data as any)?.message === "string" ? (data as any)?.message : undefined),
          })
        } else {
          lastError = null
          return { status: response.status, data, latencyMs: 0 }
        }
      } catch (error) {
        if (error instanceof WhatsAppGatewayError) {
          lastError = error
        } else if ((error as any)?.name === "AbortError") {
          lastError = new WhatsAppGatewayError(`Request timed out after ${timeoutMs}ms`, { code: "TIMEOUT" })
        } else {
          lastError = new WhatsAppGatewayError(error instanceof Error ? error.message : "Provider request failed", { code: "FETCH_FAILED" })
        }
      } finally {
        clearTimeout(timer)
      }

      if (attempt < allowedAttempts - 1 && isTransientError(lastError)) {
        continue
      }
    }

    if (lastError instanceof WhatsAppGatewayError) {
      throw lastError
    }
    throw new WhatsAppGatewayError(lastError instanceof Error ? lastError.message : "Provider request failed", { code: "FETCH_FAILED" })
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = performance.now()
    try {
      const path = this.settings.connectionTestPath || "/api/whatsapp/phone-numbers"
      const response = await this.request({ method: "GET", path, idempotent: true })
      return {
        success: response.status >= 200 && response.status < 300,
        latencyMs: Math.round(performance.now() - startedAt),
        httpStatus: response.status,
        message: `Gateway responded with HTTP ${response.status}`,
        checkedAt: new Date().toISOString(),
        detail: response.data,
      }
    } catch (error) {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - startedAt),
        httpStatus: error instanceof WhatsAppGatewayError ? error.status : 0,
        message: sanitizeErrorMessage(error instanceof Error ? error.message : "Connection test failed"),
        checkedAt: new Date().toISOString(),
      }
    }
  }

  async getConnections(): Promise<GatewayConnection[]> {
    const response = await this.request({ method: "GET", path: "/api/whatsapp/connections", idempotent: true })
    const data = (response.data || {}) as any
    const list = Array.isArray(data) ? data : Array.isArray(data?.connections) ? data.connections : Array.isArray(data?.data) ? data.data : []
    return list.map((item: any) => ({
      id: String(item.id ?? item.connection_id ?? item.waba_id ?? ""),
      name: item.name || item.waba_name || undefined,
      whatsappBusinessAccountId: item.whatsapp_business_account_id || undefined,
      isActive: item.is_active !== false && item.is_active !== 0,
    }))
  }

  async getPhoneNumbers(): Promise<GatewayPhoneNumber[]> {
    const response = await this.request({ method: "GET", path: "/api/whatsapp/phone-numbers", idempotent: true })
    const data = (response.data || {}) as any
    const list = Array.isArray(data) ? data : Array.isArray(data?.phone_numbers) ? data.phone_numbers : Array.isArray(data?.data) ? data.data : []
    return list.map((item: any) => ({
      id: String(item.id ?? item.phone_number_id ?? ""),
      displayPhoneNumber: item.display_phone_number || undefined,
      isPrimary: item.is_primary === true || item.is_primary === 1,
    }))
  }

  async getWabaPhoneNumbers(wabaId: string): Promise<GatewayWabaPhoneNumber[]> {
    const path = `/api/whatsapp/${encodeURIComponent(wabaId)}/phone-numbers`
    const response = await this.request({ method: "GET", path, idempotent: true })
    const data = (response.data || {}) as any
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.phone_numbers) ? data.phone_numbers : []
    return list.map((item: any) => ({
      phoneNumberId: String(item.phone_number_id ?? item.id ?? ""),
      displayPhoneNumber: item.display_phone_number || undefined,
    }))
  }

  private async send(body: unknown): Promise<SendResult> {
    const response = await this.request({ method: "POST", path: "/api/whatsapp/send", json: body })
    const data = (response.data || {}) as any
    return normalizeSendResult(data, response.status)
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    return this.send(buildSendTextPayload(input))
  }

  async sendImage(input: SendImageInput): Promise<SendResult> {
    return this.send(buildSendImagePayload(input))
  }

  async sendDocument(input: SendDocumentInput): Promise<SendResult> {
    return this.send(buildSendDocumentPayload(input))
  }

  async sendAudio(input: SendAudioInput): Promise<SendResult> {
    return this.send(buildSendAudioPayload(input))
  }

  async sendVideo(input: SendVideoInput): Promise<SendResult> {
    return this.send(buildSendVideoPayload(input))
  }

  async sendMultipleMedia(input: SendMultipleMediaInput): Promise<SendResult> {
    return this.send(buildSendMultipleMediaPayload(input))
  }

  async sendLocation(input: SendLocationInput): Promise<SendResult> {
    return this.send(buildSendLocationPayload(input))
  }

  async sendLocalMedia(input: SendLocalMediaInput): Promise<SendResult> {
    const form = new FormData()
    const file = new File([input.file], input.fileName, { type: input.mimeType })
    form.set("file_url", file)
    form.set("whatsapp_phone_number_id", input.whatsappPhoneNumberId)
    form.set("contact_id", input.contactId)
    if (input.message) form.set("message", input.message)
    form.set("provider", input.provider || "business_api")
    form.set("messageType", input.messageType)

    const response = await this.request({ method: "POST", path: "/api/whatsapp/send", form })
    return normalizeSendResult((response.data || {}) as any, response.status)
  }

  async createContact(input: { phoneNumber: string; name?: string; email?: string }): Promise<GatewayContact> {
    const response = await this.request({
      method: "POST",
      path: "/api/contacts",
      json: {
        phone_number: input.phoneNumber,
        name: input.name || "",
        email: input.email || "",
      },
    })
    const data = (response.data || {}) as any
    const item = data?.contact ?? (typeof data === "object" && data !== null ? data : {})
    return {
      id: String(item.id ?? item.contact_id ?? data?.id ?? ""),
      name: item.name || undefined,
      phone: item.phone || item.phone_number || input.phoneNumber,
      email: item.email || undefined,
    }
  }

  async listContacts(): Promise<GatewayContact[]> {
    const response = await this.request({ method: "GET", path: "/api/contacts", idempotent: true })
    const data = (response.data || {}) as any
    const list = Array.isArray(data) ? data : Array.isArray(data?.contacts) ? data.contacts : Array.isArray(data?.data) ? data.data : []
    return list.map((item: any) => ({
      id: String(item.id ?? item.contact_id ?? ""),
      name: item.name || undefined,
      phone: item.phone || item.phone_number || undefined,
      email: item.email || undefined,
    }))
  }

  async createTemplate(draft: TemplateDraft): Promise<TemplateResult> {
    const body: TemplateWireBody = buildTemplatePayload(draft)
    body.request_id = createHash("sha256").update(`${this.settings.apiBaseUrl}:${draft.wabaId}:${draft.templateName}`).digest("hex").slice(0, 24)
    const response = await this.request({ method: "POST", path: "/api/templates/create", json: body })
    const data = (response.data || {}) as any
    const id = String(data?.id ?? data?.template_id ?? data?.data?.id ?? "")
    const status = String(data?.status ?? data?.data?.status ?? "submitted")
    return {
      success: true,
      message: `Template submitted (HTTP ${response.status})`,
      id: id || undefined,
      status,
      sanitized: sanitizeTemplateResponse(data),
    }
  }

  makeIdempotencyId(): string {
    return randomUUID()
  }
}

function normalizeSendResult(data: any, httpStatus: number): SendResult {
  if (Array.isArray(data?.results)) {
    return {
      success: data.results.length > 0,
      message: "Message submitted",
      results: data.results.map((item: any) => ({
        id: String(item?.id ?? ""),
        waMessageId: item?.wa_message_id || item?.waMessageId || undefined,
        success: item?.success !== false,
      })),
    }
  }
  const single = typeof data === "object" && data !== null ? data : {}
  const id = String(single?.id ?? single?.data?.id ?? "")
  const waMessageId = String(single?.wa_message_id ?? single?.data?.wa_message_id ?? single?.waMessageId ?? "")
  return {
    success: single?.success === true || (httpStatus >= 200 && httpStatus < 300 && (Boolean(id) || Boolean(waMessageId))),
    message: typeof single?.message === "string" ? sanitizeErrorMessage(single.message, "Message submitted") : "Message submitted",
    id: id || undefined,
    waMessageId: waMessageId || undefined,
  }
}

function sanitizeTemplateResponse(data: any): Record<string, unknown> {
  if (!data || typeof data !== "object") return {}
  const pick = (source: any) => {
    const out: Record<string, unknown> = {}
    for (const key of ["id", "template_id", "template_name", "category", "status", "message"]) {
      if (source?.[key] !== undefined) out[key] = source[key]
    }
    return out
  }
  return pick(data?.data ?? data)
}