export type WhatsAppGatewayMessageType = "text" | "image" | "document" | "audio" | "video" | "location" | "multiple_media"

export type WhatsAppGatewayMessageStatus = "queued" | "sending" | "sent" | "failed"

export type WhatsAppGatewayAuthType = "api_key" | "bearer" | "basic" | "none"

export type WhatsAppGatewayMediaUrlPolicy = "public" | "any"

export type SendContactInput = {
  contactNo: string
  senderNumber?: string
  senderNumberId?: string
  wabaId?: string
}

export type SendTextInput = SendContactInput & { message: string }
export type SendImageInput = SendContactInput & { caption?: string; mediaUrl?: string }
export type SendDocumentInput = SendContactInput & { message?: string; mediaUrl?: string }
export type SendAudioInput = SendContactInput & { mediaUrl?: string }
export type SendVideoInput = SendContactInput & { message?: string; mediaUrl?: string }
export type SendMultipleMediaInput = SendContactInput & { mediaUrls: string[]; message?: string }
export type SendLocationInput = SendContactInput & {
  location: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
}

export type SendLocalMediaInput = {
  file: Blob
  fileName: string
  mimeType: string
  whatsappPhoneNumberId: string
  contactId: string
  message?: string
  provider?: string
  messageType: WhatsAppGatewayMessageType
}

export type SendResultItem = {
  id: string
  waMessageId?: string
  success: boolean
}

export type SendResult = {
  success: boolean
  message: string
  id?: string
  waMessageId?: string
  results?: SendResultItem[]
}

export type GatewayConnection = {
  id: string
  name?: string
  whatsappBusinessAccountId?: string
  isActive: boolean
}

export type GatewayPhoneNumber = {
  id: string
  displayPhoneNumber?: string
  isPrimary: boolean
}

export type GatewayWabaPhoneNumber = {
  phoneNumberId: string
  displayPhoneNumber?: string
}

export type GatewayContact = {
  id: string
  name?: string
  phone?: string
  email?: string
}

// -- Template wire types (mirror the external API documented shapes) --

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION"

export type TemplateVariableExample = { key: string; example: string }

export type TemplateButton =
  | { type: "quick_reply"; text: string }
  | { type: "phone_call"; text: string; phoneNumber: string }
  | { type: "website"; text: string; websiteUrl: string }
  | { type: "copy_code"; text: string }
  | { type: "catalog"; text: string; ctaUrl?: string }

export type TemplateCarouselCardComponent = {
  type: "header" | "body" | "buttons"
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"
  text?: string
  example?: {
    header_url?: string
    header_handle?: Array<string | number>
  }
  buttons?: TemplateButton[]
}

export type TemplateCarouselCard = { components: TemplateCarouselCardComponent[] }

export type TemplateDraft = {
  wabaId: string
  templateName: string
  category: TemplateCategory
  language: string
  templateType?: string
  headerText?: string
  messageBody?: string
  footerText?: string
  variableExamples?: TemplateVariableExample[]
  buttons?: TemplateButton[]
  otpButtons?: Array<{ otp_type: "COPY_CODE" | "ONE_TAP"; copy_button_text?: string }>
  addSecurityRecommendation?: boolean
  codeExpirationMinutes?: number
  otpCodeLength?: number
  isLimitedTimeOffer?: boolean
  offerText?: string
  hasExpiration?: boolean
  callPermission?: boolean
  carouselCards?: TemplateCarouselCard[]
}

export type TemplateWireBody = Record<string, unknown>

export type TemplateResult = {
  success: boolean
  message: string
  id?: string
  status?: string
  sanitized?: Record<string, unknown>
}

export type ConnectionTestResult = {
  success: boolean
  latencyMs: number
  httpStatus: number
  message: string
  checkedAt: string
  detail?: unknown
}