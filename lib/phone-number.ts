import {
  parsePhoneNumberFromString as parsePhoneNumberFromStringCore,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js/core"
import rawPhoneMetadata from "libphonenumber-js/metadata.max.json"

export const PHONE_VALIDATION_MESSAGE = "Enter a valid phone number"

const ALLOWED_FORMATTING = /^[+\d\s()-]+$/
const MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"])
const DUPLICATE_COUNTRY_CODE_NATIONAL_LENGTH = 10
const phoneMetadata = ((rawPhoneMetadata as any)?.default || rawPhoneMetadata) as any

export type StrictPhoneResult = {
  e164: string
  countryCode: string
  callingCode: string
  nationalNumber: string
  digits: string
  isMobile: boolean
}

export function sanitizePhoneInput(value: unknown) {
  const raw = String(value || "")
  const stripped = raw.replace(/[\s()-]+/g, "")
  const plus = stripped.startsWith("+") ? "+" : ""
  return plus + stripped.replace(/\+/g, "").replace(/\D/g, "")
}

export function hasOnlyPhoneInputCharacters(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw) return true
  if (!ALLOWED_FORMATTING.test(raw)) return false
  return (raw.match(/\+/g) || []).length <= 1 && (!raw.includes("+") || raw.trimStart().startsWith("+"))
}

function phoneError(message = PHONE_VALIDATION_MESSAGE) {
  return Object.assign(new Error(message), {
    code: "invalid_phone",
    status: 400,
  })
}

function normalizeCountry(countryCode?: string | null) {
  const country = String(countryCode || "").trim().toUpperCase()
  return /^[A-Z]{2}$/.test(country) ? country as CountryCode : undefined
}

function parsedType(parsed: PhoneNumber) {
  try {
    return parsed.getType()
  } catch {
    return undefined
  }
}

export function normalizeStrictPhoneNumber(input: unknown, countryCode?: string | null): StrictPhoneResult {
  const raw = String(input || "").trim()
  const country = normalizeCountry(countryCode)
  if (!raw) throw phoneError()
  if (!hasOnlyPhoneInputCharacters(raw)) throw phoneError()

  const compact = sanitizePhoneInput(raw)
  if (!compact || compact === "+") throw phoneError()
  if (!/^\+?\d+$/.test(compact)) throw phoneError()
  if ((compact.match(/\+/g) || []).length > 1 || (compact.includes("+") && !compact.startsWith("+"))) throw phoneError()

  const candidates = compact.startsWith("+")
    ? [compact]
    : country
      ? [compact]
      : [`+${compact}`]

  let parsed: PhoneNumber | undefined
  for (const candidate of candidates) {
    const attempt = parsePhoneNumberFromStringCore(candidate, country ? { defaultCountry: country } : {}, phoneMetadata)
    if (attempt?.isPossible() && attempt.isValid()) {
      parsed = attempt
      break
    }
  }

  if (!parsed) throw phoneError()
  const type = parsedType(parsed)
  if (type && !MOBILE_TYPES.has(type)) throw phoneError("Enter a valid mobile phone number")

  const e164 = parsed.number
  const national = parsed.nationalNumber
  const callingCode = parsed.countryCallingCode
  if (national.startsWith(callingCode) && national.length > DUPLICATE_COUNTRY_CODE_NATIONAL_LENGTH) {
    throw phoneError("Phone number contains a duplicate country code")
  }

  return {
    e164,
    countryCode: parsed.country || String(country || ""),
    callingCode,
    nationalNumber: national,
    digits: e164.replace(/\D/g, ""),
    isMobile: !type || MOBILE_TYPES.has(type),
  }
}

export function isStrictPhoneNumber(input: unknown, countryCode?: string | null) {
  try {
    normalizeStrictPhoneNumber(input, countryCode)
    return true
  } catch {
    return false
  }
}
