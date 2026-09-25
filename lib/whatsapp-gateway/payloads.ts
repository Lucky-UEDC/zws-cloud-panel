import type {
  SendAudioInput,
  SendDocumentInput,
  SendImageInput,
  SendLocationInput,
  SendMultipleMediaInput,
  SendTextInput,
  SendVideoInput,
  TemplateButton,
  TemplateCarouselCard,
  TemplateDraft,
  TemplateWireBody,
} from "@/lib/whatsapp-gateway/types"

export type SendPayload = Record<string, unknown>

function baseSendPayload(input: { contactNo: string; senderNumber?: string; senderNumberId?: string; wabaId?: string }): SendPayload {
  return {
    contact_no: input.contactNo,
    whatsapp_phone_number: input.senderNumber,
    ...(input.senderNumberId ? { whatsapp_phone_number_id: input.senderNumberId } : {}),
    ...(input.wabaId ? { waba_id: input.wabaId } : {}),
  }
}

export function buildSendTextPayload(input: SendTextInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "text",
    message: input.message,
  }
}

export function buildSendImagePayload(input: SendImageInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "image",
    message: input.caption || "",
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
  }
}

export function buildSendDocumentPayload(input: SendDocumentInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "document",
    message: input.message || "",
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
  }
}

export function buildSendAudioPayload(input: SendAudioInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "audio",
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
  }
}

export function buildSendVideoPayload(input: SendVideoInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "video",
    message: input.message || "",
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
  }
}

export function buildSendMultipleMediaPayload(input: SendMultipleMediaInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "multiple_media",
    mediaUrls: input.mediaUrls,
    message: input.message || "",
  }
}

export function buildSendLocationPayload(input: SendLocationInput): SendPayload {
  return {
    ...baseSendPayload(input),
    messageType: "location",
    location: {
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      ...(input.location.name ? { name: input.location.name } : {}),
      ...(input.location.address ? { address: input.location.address } : {}),
    },
  }
}

function normalizeButton(button: TemplateButton): Record<string, unknown> {
  switch (button.type) {
    case "quick_reply":
      return { type: "quick_reply", text: button.text }
    case "phone_call":
      return { type: "phone_call", text: button.text, phone_number: button.phoneNumber }
    case "website":
      return { type: "website", text: button.text, website_url: button.websiteUrl }
    case "copy_code":
      return { type: "copy_code", text: button.text }
    case "catalog":
      return { type: "catalog", text: button.text, ...(button.ctaUrl ? { cta_url: button.ctaUrl } : {}) }
    default:
      return {}
  }
}

function normalizeCarouselCard(card: TemplateCarouselCard): Record<string, unknown> {
  return {
    components: card.components.map((component) => ({
      type: component.type,
      ...(component.format ? { format: component.format } : {}),
      ...(component.text ? { text: component.text } : {}),
      ...(component.example ? { example: component.example } : {}),
      ...(component.buttons?.length ? { buttons: component.buttons.map(normalizeButton) } : {}),
    })),
  }
}

export function buildTemplatePayload(draft: TemplateDraft): TemplateWireBody {
  const body: TemplateWireBody = {
    waba_id: draft.wabaId,
    template_name: draft.templateName,
    category: draft.category,
    language: draft.language,
  }

  if (draft.templateType) body.template_type = draft.templateType
  if (draft.headerText) body.header_text = draft.headerText
  if (draft.messageBody) body.message_body = draft.messageBody
  if (draft.footerText) body.footer_text = draft.footerText
  if (draft.variableExamples?.length) body.variable_examples = draft.variableExamples
  if (draft.buttons?.length) body.buttons = draft.buttons.map(normalizeButton)
  if (draft.otpButtons?.length) body.otp_buttons = draft.otpButtons
  if (draft.addSecurityRecommendation) body.add_security_recommendation = true
  if (draft.codeExpirationMinutes !== undefined) body.code_expiration_minutes = draft.codeExpirationMinutes
  if (draft.otpCodeLength !== undefined) body.otp_code_length = draft.otpCodeLength
  if (draft.isLimitedTimeOffer) {
    body.is_limited_time_offer = true
    if (draft.offerText) body.offer_text = draft.offerText
    if (draft.hasExpiration !== undefined) body.has_expiration = Boolean(draft.hasExpiration)
  }
  if (draft.callPermission) body.call_permission = true
  if (draft.carouselCards?.length) body.carousel_cards = draft.carouselCards.map(normalizeCarouselCard)

  return body
}

export function classifyTemplateType(draft: TemplateDraft): string {
  if (draft.category === "AUTHENTICATION" || draft.otpButtons?.length) return "authentication"
  if (draft.carouselCards?.length) return "carousel_product"
  if (draft.buttons?.some((button) => ["copy_code", "catalog", "website", "phone_call"].includes(button.type))) return "interactive"
  if (draft.variableExamples?.length) return "variables"
  return "standard"
}