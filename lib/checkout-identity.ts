export type BillingAddressInput = {
  name?: string | null
  email?: string | null
  phone?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postalCode?: string | null
  pin?: string | null
  zip?: string | null
  gstin?: string | null
  panNumber?: string | null
}

export type NormalizedBillingAddress = {
  name: string | null
  email: string | null
  phone: string | null
  addressLine1: string
  addressLine2: string | null
  city: string
  state: string
  country: string
  postalCode: string
  gstin: string | null
  panNumber: string | null
}

export function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase()
}

function clean(value: unknown) {
  const text = String(value ?? "").trim()
  return text || null
}

const PLACEHOLDER_VALUES = new Set([
  "na",
  "n/a",
  "none",
  "null",
  "unknown",
  "placeholder",
  "test",
  "dummy",
  "-",
])

function isMeaningfulValue(value: unknown) {
  const text = clean(value)
  if (!text) return false
  return !PLACEHOLDER_VALUES.has(text.toLowerCase())
}

export function billingAddressFromCustomer(customer: any): BillingAddressInput {
  const jsonAddress = customer?.address && typeof customer.address === "object" && !Array.isArray(customer.address)
    ? customer.address
    : {}
  return {
    name: customer?.name || null,
    email: customer?.email || null,
    phone: customer?.phone || null,
    addressLine1: customer?.addressLine1 || jsonAddress.addressLine1 || jsonAddress.line1 || null,
    addressLine2: customer?.addressLine2 || jsonAddress.addressLine2 || jsonAddress.line2 || null,
    city: customer?.city || jsonAddress.city || null,
    state: customer?.state || jsonAddress.state || null,
    country: customer?.country || jsonAddress.country || null,
    postalCode: customer?.postalCode || jsonAddress.postalCode || jsonAddress.pin || jsonAddress.zip || null,
    gstin: customer?.gstin || null,
    panNumber: customer?.panNumber || null,
  }
}

export function normalizeBillingAddress(input: BillingAddressInput): NormalizedBillingAddress {
  const addressLine1 = clean(input.addressLine1)
  const city = clean(input.city)
  const state = clean(input.state)
  const country = clean(input.country)
  const postalCode = clean(input.postalCode || input.pin || input.zip)

  const missing = missingBillingAddressFields({
    addressLine1,
    city,
    state,
    country,
    postalCode,
    phone: input.phone,
  }, { requirePhone: false })

  if (missing.length) {
    throw Object.assign(new Error("Billing address is required before payment."), {
      code: "billing_address_required",
      status: 400,
      fields: missing,
    })
  }

  return {
    name: clean(input.name),
    email: input.email ? normalizeEmail(input.email) : null,
    phone: clean(input.phone),
    addressLine1: addressLine1!,
    addressLine2: clean(input.addressLine2),
    city: city!,
    state: state!,
    country: country!,
    postalCode: postalCode!,
    gstin: clean(input.gstin),
    panNumber: clean(input.panNumber),
  }
}

export function missingBillingAddressFields(
  input: BillingAddressInput,
  options: { requirePhone?: boolean } = {},
) {
  const requirePhone = Boolean(options.requirePhone)
  const missing = [
    ["addressLine1", isMeaningfulValue(input.addressLine1)],
    ["city", isMeaningfulValue(input.city)],
    ["state", isMeaningfulValue(input.state)],
    ["country", isMeaningfulValue(input.country)],
    ["postalCode", isMeaningfulValue(input.postalCode || input.pin || input.zip)],
  ]
  if (requirePhone) missing.push(["phone", isMeaningfulValue(input.phone)])
  return missing.filter(([, ok]) => !ok).map(([key]) => key)
}

export function hasCompleteBillingAddress(input: BillingAddressInput): boolean {
  try {
    normalizeBillingAddress(input)
    return true
  } catch {
    return false
  }
}

export function billingAddressProfilePatch(address: NormalizedBillingAddress) {
  return {
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    country: address.country,
    postalCode: address.postalCode,
    gstin: address.gstin,
    panNumber: address.panNumber,
    address: {
      line1: address.addressLine1,
      line2: address.addressLine2,
      city: address.city,
      state: address.state,
      country: address.country,
      postalCode: address.postalCode,
    },
  }
}
