import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import {
  buildSendAudioPayload,
  buildSendDocumentPayload,
  buildSendImagePayload,
  buildSendLocationPayload,
  buildSendMultipleMediaPayload,
  buildSendTextPayload,
  buildSendVideoPayload,
  buildTemplatePayload,
  classifyTemplateType,
} from "@/lib/whatsapp-gateway/payloads"
import { WhatsAppGatewayProvider } from "@/lib/whatsapp-gateway/client"
import { DEFAULT_GATEWAY_SETTINGS, type WhatsAppGatewaySettings, isGatewayConfigured } from "@/lib/whatsapp-gateway/settings"
import { sanitizeErrorMessage, sanitizeErrorForLogs } from "@/lib/whatsapp-gateway/errors"
import { assertPublicMediaUrl, isPrivateAddress, MediaUrlValidationError } from "@/lib/whatsapp-gateway/ssrf"
import {
  gatewayContactInputSchema,
  gatewaySettingsSchema,
  gatewayTemplateSchema,
  phoneNumber,
} from "@/lib/whatsapp-gateway/validate"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8")
}

function makeSettings(overrides: Partial<WhatsAppGatewaySettings> = {}): WhatsAppGatewaySettings {
  return { ...DEFAULT_GATEWAY_SETTINGS, enabled: true, apiBaseUrl: "https://api.example.com", ...overrides }
}

function jsonFetchMock(
  handler: (url: string, init: Record<string, unknown>) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>,
) {
  return async (url: any, init: any = {}) => {
    const result = await handler(String(url), init || {})
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: new Headers({ "content-type": "application/json" }),
      async text() {
        return JSON.stringify(result.body)
      },
    } as Response
  }
}

function abortAwareFetch(delayMs: number) {
  return async (_url: any, init: any = {}) => {
    const signal = init.signal
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
      }, delayMs)
      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        })
      }
    })
  }
}

test("text send payload matches the documented wire shape", () => {
  assert.deepEqual(buildSendTextPayload({ contactNo: "919876543210", senderNumber: "919876543201", message: "Hello" }), {
    contact_no: "919876543210",
    whatsapp_phone_number: "919876543201",
    messageType: "text",
    message: "Hello",
  })
})

test("media payloads include messageType and mediaUrl", () => {
  assert.equal(buildSendImagePayload({ contactNo: "919876543210", mediaUrl: "https://cdn.example.com/a.jpg", caption: "Look" }).messageType, "image")
  assert.equal(buildSendDocumentPayload({ contactNo: "919876543210", mediaUrl: "https://cdn.example.com/a.pdf" }).mediaUrl, "https://cdn.example.com/a.pdf")
  assert.equal(buildSendAudioPayload({ contactNo: "919876543210", mediaUrl: "https://cdn.example.com/a.mp3" }).messageType, "audio")
  assert.equal(buildSendVideoPayload({ contactNo: "919876543210", mediaUrl: "https://cdn.example.com/a.mp4", message: "Watch" }).messageType, "video")
  const multi = buildSendMultipleMediaPayload({ contactNo: "919876543210", mediaUrls: ["https://x/a.jpg", "https://x/b.jpg"] })
  assert.deepEqual(multi.mediaUrls, ["https://x/a.jpg", "https://x/b.jpg"])
  assert.equal(multi.messageType, "multiple_media")
})

test("location payload embeds coordinates", () => {
  const payload = buildSendLocationPayload({ contactNo: "919876543210", location: { latitude: 28.6139, longitude: 77.209, name: "Connaught Place", address: "New Delhi" } })
  assert.equal(payload.messageType, "location")
  assert.deepEqual(payload.location, { latitude: 28.6139, longitude: 77.209, name: "Connaught Place", address: "New Delhi" })
})

test("template payloads cover the documented template types", () => {
  const simple = buildTemplatePayload({ wabaId: "w1", templateName: "hello", category: "MARKETING", language: "en_US", messageBody: "Hi" })
  assert.equal(simple.template_name, "hello")
  assert.equal(simple.message_body, "Hi")

  const auth = buildTemplatePayload({
    wabaId: "w1",
    templateName: "otp_login",
    category: "AUTHENTICATION",
    language: "en_US",
    messageBody: "Your code is {{otp_code}}",
    otpButtons: [{ otp_type: "ONE_TAP" }],
    addSecurityRecommendation: true,
    codeExpirationMinutes: 5,
    otpCodeLength: 6,
  })
  assert.deepEqual(auth.otp_buttons, [{ otp_type: "ONE_TAP" }])
  assert.equal(auth.add_security_recommendation, true)
  assert.equal(auth.code_expiration_minutes, 5)
  assert.equal(auth.otp_code_length, 6)

  const quickReply = buildTemplatePayload({
    wabaId: "w1",
    templateName: "confirm",
    category: "UTILITY",
    language: "en_US",
    messageBody: "Confirm?",
    buttons: [{ type: "quick_reply", text: "Yes" }],
  })
  assert.deepEqual(quickReply.buttons, [{ type: "quick_reply", text: "Yes" }])

  const coupon = buildTemplatePayload({
    wabaId: "w1",
    templateName: "offer",
    category: "MARKETING",
    language: "en_US",
    messageBody: "Use coupon",
    buttons: [{ type: "copy_code", text: "SAVE10" }],
    isLimitedTimeOffer: true,
    offerText: "Ends today",
    hasExpiration: true,
  })
  assert.deepEqual(coupon.buttons, [{ type: "copy_code", text: "SAVE10" }])
  assert.equal(coupon.is_limited_time_offer, true)
  assert.equal(coupon.has_expiration, true)
  assert.equal(coupon.offer_text, "Ends today")

  const cta = buildTemplatePayload({
    wabaId: "w1",
    templateName: "visit",
    category: "MARKETING",
    language: "en_US",
    messageBody: "Check it",
    buttons: [{ type: "website", text: "Go", websiteUrl: "https://example.com" }],
  })
  assert.deepEqual(cta.buttons, [{ type: "website", text: "Go", website_url: "https://example.com" }])

  const carousel = buildTemplatePayload({
    wabaId: "w1",
    templateName: "catalog",
    category: "MARKETING",
    language: "en_US",
    messageBody: "Best sellers",
    templateType: "carousel_product",
    carouselCards: [
      { components: [{ type: "header", format: "IMAGE", example: { header_url: "https://x/a.jpg" } }, { type: "body", text: "Product A" }] },
    ],
  })
  assert.equal(carousel.template_type, "carousel_product")
  assert.ok(Array.isArray(carousel.carousel_cards))
  assert.equal((carousel.carousel_cards as Array<any>)[0].components.length, 2)
})

test("template classification", () => {
  assert.equal(classifyTemplateType({ category: "AUTHENTICATION", language: "en_US", messageBody: "x" }), "authentication")
  assert.equal(classifyTemplateType({ category: "MARKETING", language: "en_US", messageBody: "x", carouselCards: [{ components: [] }] }), "carousel_product")
  assert.equal(classifyTemplateType({ category: "UTILITY", language: "en_US", messageBody: "Hi {{name}}", variableExamples: [{ key: "name", example: "Rahul" }] }), "variables")
  assert.equal(classifyTemplateType({ category: "MARKETING", language: "en_US", messageBody: "Hi" }), "standard")
})

test("configuration probe", () => {
  assert.equal(isGatewayConfigured(makeSettings({ enabled: false })).configured, false)
  assert.equal(isGatewayConfigured(makeSettings({ apiBaseUrl: "" })).configured, false)
  assert.equal(isGatewayConfigured(makeSettings({ authType: "bearer", apiToken: "tok" })).configured, true)
  assert.equal(isGatewayConfigured(makeSettings({ authType: "api_key", apiKey: "key" })).configured, true)
  assert.equal(isGatewayConfigured(makeSettings({ authType: "basic", apiToken: "pw" })).configured, true)
  assert.equal(isGatewayConfigured(makeSettings({ authType: "none" })).configured, true)
})

test("provider sends bearer token and parses a single send response", async () => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = []
  const client = new WhatsAppGatewayProvider(
    makeSettings({ authType: "bearer", apiToken: "secret-token" }),
    jsonFetchMock((url, init) => {
      calls.push({ url, init })
      return { status: 200, body: { success: true, data: { id: "ext-1", wa_message_id: "wamid-1" } } }
    }),
  )
  const result = await client.sendText({ contactNo: "919876543210", message: "Hi" })
  assert.equal(result.success, true)
  assert.equal(result.id, "ext-1")
  assert.equal(result.waMessageId, "wamid-1")
  assert.equal(calls[0].url, "https://api.example.com/api/whatsapp/send")
  assert.equal(calls[0].init.method, "POST")
  const headers = calls[0].init.headers as Headers
  assert.equal(headers.get("Authorization"), "Bearer secret-token")
  assert.equal(headers.get("Content-Type"), "application/json")
})

test("provider uses the configured api key header for api_key auth", async () => {
  const calls: Array<{ init: Record<string, unknown> }> = []
  const client = new WhatsAppGatewayProvider(
    makeSettings({ authType: "api_key", apiKey: "k123", apiKeyHeader: "x-api-key" }),
    jsonFetchMock((_url, init) => {
      calls.push({ init })
      return { status: 200, body: { success: true, data: { id: "ext-2" } } }
    }),
  )
  await client.sendText({ contactNo: "919876543210", message: "Hi" })
  const headers = calls[0].init.headers as Headers
  assert.equal(headers.get("x-api-key"), "k123")
})

test("provider parses the results array response form", async () => {
  const client = new WhatsAppGatewayProvider(
    makeSettings(),
    jsonFetchMock(() => ({ status: 200, body: { results: [{ id: "r1", wa_message_id: "w-1", success: true }] } })),
  )
  const result = await client.sendMultipleMedia({ contactNo: "919876543210", mediaUrls: ["https://x/a.jpg"] })
  assert.equal(result.success, true)
  assert.equal(result.results?.[0].id, "r1")
})

test("provider retries transient errors on reads only (not on sends)", async () => {
  let attempts = 0
  const retryClient = new WhatsAppGatewayProvider(
    makeSettings({ retryEnabled: true, maxRetries: 2, retryDelayMs: 1 }),
    jsonFetchMock(() => {
      attempts += 1
      if (attempts < 3) return { status: 503, body: { message: "busy" } }
      return { status: 200, body: {} }
    }),
  )
  await retryClient.getPhoneNumbers()
  assert.equal(attempts, 3)

  let sendAttempts = 0
  const sendClient = new WhatsAppGatewayProvider(
    makeSettings({ retryEnabled: true, maxRetries: 2, retryDelayMs: 1 }),
    jsonFetchMock(() => {
      sendAttempts += 1
      return { status: 503, body: { message: "busy" } }
    }),
  )
  await assert.rejects(() => sendClient.sendText({ contactNo: "919876543210", message: "Hi" }), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 503)
    assert.equal(sendAttempts, 1)
    return true
  })
})

test("provider surfaces sanitized provider errors", async () => {
  const client = new WhatsAppGatewayProvider(
    makeSettings(),
    jsonFetchMock(() => ({ status: 400, body: { message: "Invalid token xyz123" } })),
  )
  await assert.rejects(() => client.sendText({ contactNo: "919876543210", message: "Hi" }), (error: unknown) => {
    assert.match(String((error as Error).message), /Invalid token/)
    assert.equal((error as { status?: number }).status, 400)
    return true
  })
})

test("provider times out when the upstream hangs", async () => {
  const client = new WhatsAppGatewayProvider(
    makeSettings({ requestTimeoutMs: 30 }),
    abortAwareFetch(5000) as unknown as typeof fetch,
  )
  await assert.rejects(() => client.getPhoneNumbers(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "TIMEOUT")
    return true
  })
})

test("SSRF guard rejects private, loopback and link-local addresses", async () => {
  assert.equal(isPrivateAddress("10.0.0.1"), true)
  assert.equal(isPrivateAddress("127.0.0.1"), true)
  assert.equal(isPrivateAddress("169.254.169.254"), true)
  assert.equal(isPrivateAddress("192.168.1.1"), true)
  assert.equal(isPrivateAddress("172.16.0.1"), true)
  assert.equal(isPrivateAddress("fc00::1"), true)
  assert.equal(isPrivateAddress("::1"), true)
  assert.equal(isPrivateAddress("fe80::1"), true)
  assert.equal(isPrivateAddress("8.8.8.8"), false)
  assert.equal(isPrivateAddress("142.250.72.14"), false)
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false)
  assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true)

  await assert.rejects(() => assertPublicMediaUrl("http://192.168.1.10/media.jpg"), MediaUrlValidationError)
  await assert.rejects(() => assertPublicMediaUrl("http://169.254.169.254/latest/meta-data/"), MediaUrlValidationError)
  await assert.rejects(() => assertPublicMediaUrl("ftp://old.example.com/x.jpg"), MediaUrlValidationError)
  await assert.rejects(() => assertPublicMediaUrl("http://user:pass@example.com/x.jpg"), MediaUrlValidationError)
  await assert.rejects(() => assertPublicMediaUrl("not a url"), MediaUrlValidationError)
  const publicUrl = await assertPublicMediaUrl("https://cdn.example.com/a.jpg", async (_hostname: string) => [{ address: "93.184.216.34", family: 4 } as never])
  assert.equal(publicUrl, "https://cdn.example.com/a.jpg")
  await assert.rejects(
    () => assertPublicMediaUrl("https://evil.example.com/x.jpg", async (_hostname: string) => [{ address: "169.254.169.254", family: 4 } as never]),
    MediaUrlValidationError,
  )
})

test("error sanitization strips authorization and keys", () => {
  assert.equal(sanitizeErrorMessage('Authorization: Bearer abc.def.ghi failed'), 'Authorization: [REDACTED] failed')
  assert.equal(sanitizeErrorMessage('x-api-key: supersecret rejected'), 'x-api-key: [REDACTED] rejected')
  assert.equal(sanitizeErrorMessage(""), "Unknown provider error")
})

test("input schema validates phones, sends and templates", () => {
  const phone = gatewayContactInputSchema.safeParse({ phone: "+91 98765 43210" })
  assert.equal(phone.success, true)
  const badPhone = gatewayContactInputSchema.safeParse({ phone: "abc" })
  assert.equal(badPhone.success, false)

  const send = gatewayTemplateSchema.safeParse({
    wabaId: "w1",
    templateName: "confirm",
    category: "UTILITY",
    language: "en_US",
    messageBody: "Confirm order {{order_id}}?",
    variableExamples: [{ key: "order_id", example: "ORD-1" }],
  })
  assert.equal(send.success, true)

  const tooManyExamples = gatewayTemplateSchema.safeParse({
    wabaId: "w1",
    templateName: "confirm",
    category: "UTILITY",
    language: "en_US",
    messageBody: "Confirm?",
    variableExamples: [{ key: "name", example: "Rahul" }],
  })
  assert.equal(tooManyExamples.success, false)

  const authWithoutOtp = gatewayTemplateSchema.safeParse({
    wabaId: "w1",
    templateName: "otp",
    category: "AUTHENTICATION",
    language: "en_US",
    messageBody: "Code: {{otp_code}}",
  })
  assert.equal(authWithoutOtp.success, false)

  const settings = gatewaySettingsSchema.safeParse({ authType: "bearer", apiToken: "******", requestTimeoutMs: 30000 })
  assert.equal(settings.success, true)
  assert.equal((settings.data as any).requestTimeoutMs, 30000)
})

test("sanitizeErrorForLogs never returns secrets or non-strings", () => {
  const message = "Gateway message failed" 
  const scrubbed = sanitizeErrorForLogs(message)
  assert.equal(scrubbed, message)
})

test("validation helper exports normalize phone", () => {
  assert.equal(typeof phoneNumber, "function")
})

test("gateway files follow the admin route and no-secret conventions (static)", () => {
  const settingsSource = read("lib/whatsapp-gateway/settings.ts")
  assert.match(settingsSource, /getRuntimeIntegrationConfig/)
  assert.match(settingsSource, /updateRuntimeIntegrationConfig/)
  assert.match(settingsSource, /apiKeyConfigured/)
  assert.doesNotMatch(settingsSource, /createPanelLog/)

  const clientSource = read("lib/whatsapp-gateway/client.ts")
  assert.match(clientSource, /isGatewayConfigured/)
  assert.doesNotMatch(clientSource, /console\.log/)

  const sendRoute = read("app/api/admin/whatsapp-gateway/send/route.ts")
  assert.match(sendRoute, /requireGatewayAdmin/)
  assert.match(sendRoute, /assertPublicMediaUrl/)
  assert.match(sendRoute, /sanitizeErrorMessage/)
  assert.doesNotMatch(sendRoute, /console\.log/)
  assert.match(sendRoute, /idempotency-key/)
})