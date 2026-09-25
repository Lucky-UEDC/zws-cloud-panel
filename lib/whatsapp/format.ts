import {
  maskWhatsAppPhone,
  normalizeWhatsAppNumber,
} from "@/lib/whatsapp/diagnostics"

export { maskWhatsAppPhone, normalizeWhatsAppNumber }

export function normalizeWhatsAppPhone(input: string, defaultCountry?: string | null) {
  return normalizeWhatsAppNumber(input, defaultCountry).digits
}
