import { z } from "zod"
import type { WhatsAppGatewayAuthType, WhatsAppGatewayMediaUrlPolicy, WhatsAppGatewayMessageType } from "@/lib/whatsapp-gateway/types"

export const PHONE_REGEX = /^\+?[0-9]{4,15}$/

function phoneNumber() {
  return z.string().trim().min(4).max(16).transform((value) => value.replace(/\D/g, ""))
}

export const gatewayContactInputSchema = z.object({
  phone: phoneNumber(),
  name: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().email().max(254).optional().or(z.literal("")).or(z.literal("")),
})

export const gatewaySenderInputSchema = z.object({
  contactNo: phoneNumber(),
  senderNumber: z.string().trim().max(32).optional(),
  senderNumberId: z.string().trim().max(64).optional(),
  wabaId: z.string().trim().max(64).optional(),
})

export const gatewaySendSchema = z
  .object({
    contactNo: phoneNumber(),
    senderNumber: z.string().trim().max(32).optional(),
    senderNumberId: z.string().trim().max(64).optional(),
    wabaId: z.string().trim().max(64).optional(),
    messageType: z.enum(["text", "image", "document", "audio", "video", "location", "multiple_media"] as const),
    message: z.string().trim().max(4000).optional(),
    mediaUrl: z.string().trim().max(2048).optional(),
    mediaUrls: z.array(z.string().trim().max(2048)).max(10).optional(),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        name: z.string().trim().max(200).optional(),
        address: z.string().trim().max(500).optional(),
      })
      .optional(),
  })
  .refine(
    (value) => {
      if (value.messageType === "text") return Boolean(value.message?.trim())
      if (["image", "document", "audio", "video"].includes(value.messageType)) {
        const hasUrl = Boolean(value.mediaUrl?.trim())
        return hasUrl || Boolean(value.message?.trim())
      }
      if (value.messageType === "multiple_media") return Array.isArray(value.mediaUrls) && value.mediaUrls.length > 0
      if (value.messageType === "location") return Boolean(value.location)
      return false
    },
    { message: "The selected message type requires additional fields" },
  )

export const gatewaySendDraftSchema = z.object({
  contactNo: phoneNumber(),
  senderNumber: z.string().trim().max(32).optional(),
  senderNumberId: z.string().trim().max(64).optional(),
  wabaId: z.string().trim().max(64).optional(),
  messageType: z.enum(["text", "image", "document", "audio", "video", "location", "multiple_media", "local_media"] as const),
  message: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().trim().max(2048).optional(),
  mediaUrls: z.array(z.string().trim().max(2048)).max(10).optional(),
  mediaName: z.string().trim().max(255).optional(),
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      name: z.string().trim().max(200).optional(),
      address: z.string().trim().max(500).optional(),
    })
    .optional(),
})

export const gatewayLocalMediaUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^[a-z0-9]+\/[a-z0-9.+-]+$/i).max(120),
  whatsappPhoneNumberId: z.string().trim().min(1).max(120),
  contactId: z.string().trim().min(1).max(120),
  message: z.string().trim().max(4000).optional(),
  messageType: z.enum(["image", "document", "audio", "video"] as const),
})

export const gatewayAuthTypeSchema = z.enum(["api_key", "bearer", "basic", "none"] as const)
export const gatewayMediaPolicySchema = z.enum(["public", "any"] as const)

export const gatewaySettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiBaseUrl: z.string().trim().url().optional().or(z.literal("")).or(z.literal("")),
    authType: gatewayAuthTypeSchema.optional(),
    apiKeyHeader: z.string().trim().max(64).optional(),
    apiKey: z.string().trim().max(500).optional(),
    apiToken: z.string().trim().max(2000).optional(),
    basicUsername: z.string().trim().max(64).optional(),
    requestTimeoutMs: z.coerce.number().int().min(2000).max(120000).optional(),
    retryEnabled: z.boolean().optional(),
    maxRetries: z.coerce.number().int().min(0).max(5).optional(),
    retryDelayMs: z.coerce.number().int().min(0).max(10000).optional(),
    defaultWabaId: z.string().trim().max(64).optional(),
    defaultSenderNumber: z.string().trim().max(32).optional(),
    defaultSenderNumberId: z.string().trim().max(64).optional(),
    connectionTestPath: z
      .string()
      .trim()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .max(200)
      .optional(),
    loggingEnabled: z.boolean().optional(),
    mediaUrlPolicy: gatewayMediaPolicySchema.optional(),
  })
  .partial()

export const gatewayTemplateSchema = z
  .object({
    wabaId: z.string().trim().min(1).max(64),
    templateName: z.string().trim().min(1).max(512),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"] as const),
    language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).max(12).default("en_US"),
    templateType: z.string().trim().max(64).optional(),
    headerText: z.string().trim().max(254).optional(),
    messageBody: z.string().trim().min(1).max(1024),
    footerText: z.string().trim().max(200).optional(),
    variableExamples: z
      .array(z.object({ key: z.string().trim().min(1).max(64), example: z.string().trim().min(1).max(500) }))
      .max(64)
      .optional(),
    buttons: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ type: z.literal("quick_reply"), text: z.string().trim().min(1).max(25) }),
          z.object({ type: z.literal("phone_call"), text: z.string().trim().min(1).max(25), phoneNumber: z.string().regex(PHONE_REGEX) }),
          z.object({ type: z.literal("website"), text: z.string().trim().min(1).max(25), websiteUrl: z.string().trim().url().max(2048) }),
          z.object({ type: z.literal("copy_code"), text: z.string().trim().min(1).max(25) }),
          z.object({ type: z.literal("catalog"), text: z.string().trim().min(1).max(25), ctaUrl: z.string().trim().url().max(2048).optional() }),
        ]),
      )
      .max(10)
      .optional(),
    otpButtons: z.array(z.object({ otp_type: z.enum(["COPY_CODE", "ONE_TAP"]), copy_button_text: z.string().trim().max(25).optional() })).max(1).optional(),
    addSecurityRecommendation: z.boolean().optional(),
    codeExpirationMinutes: z.coerce.number().int().min(1).max(90).optional(),
    otpCodeLength: z.coerce.number().int().min(4).max(8).optional(),
    isLimitedTimeOffer: z.boolean().optional(),
    offerText: z.string().trim().max(200).optional(),
    hasExpiration: z.boolean().optional(),
    callPermission: z.boolean().optional(),
    carouselCards: z
      .array(
        z.object({
          components: z
            .array(
              z.object({
                type: z.enum(["header", "body", "buttons"]),
                format: z.enum(["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]).optional(),
                text: z.string().trim().max(1024).optional(),
                example: z
                  .object({
                    header_url: z.string().trim().url().max(2048).optional(),
                    header_handle: z.array(z.union([z.string(), z.number()])).optional(),
                  })
                  .optional(),
                buttons: z
                  .array(
                    z.object({
                      type: z.enum(["quick_reply", "website", "phone_call", "url"]),
                      text: z.string().trim().max(25),
                      url: z.string().trim().url().max(2048).optional(),
                      phoneNumber: z.string().regex(PHONE_REGEX).optional(),
                    }),
                  )
                  .max(4)
                  .optional(),
              }),
            )
            .min(1)
            .max(6),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const body = value.messageBody
    const variableCount = (body.match(/\{\{([a-zA-Z0-9_]+)\}\}/g) || []).length
    if (value.variableExamples && value.variableExamples.length > variableCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variableExamples"], message: "More variable examples than variables used in the message body" })
    }
    if (value.category === "AUTHENTICATION" && !value.otpButtons?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otpButtons"], message: "Authentication templates require at least one OTP button" })
    }
    if (value.codeExpirationMinutes !== undefined && value.category !== "AUTHENTICATION") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["codeExpirationMinutes"], message: "OTP code expiration applies only to authentication templates" })
    }
  })

export type GatewaySendInput = z.infer<typeof gatewaySendSchema>
export type GatewayTemplateInput = z.infer<typeof gatewayTemplateSchema>
export type GatewaySettingsInputSchema = z.infer<typeof gatewaySettingsSchema>

export const AUTH_TYPES: WhatsAppGatewayAuthType[] = ["api_key", "bearer", "basic", "none"]
export const MEDIA_POLICIES: WhatsAppGatewayMediaUrlPolicy[] = ["public", "any"]
export const SEND_MESSAGE_TYPES: WhatsAppGatewayMessageType[] = ["text", "image", "document", "audio", "video", "location", "multiple_media"]

export { phoneNumber }