export const CHECKOUT_RESUME_INTENT_KEY = "zws.checkout.resumeIntent.v1"

export type CheckoutResumeIntent = {
  url: string
  paymentRequested: boolean
  draft?: Record<string, unknown>
  createdAt: string
}

export function isCheckoutResumePath(path: string) {
  return (
    path.startsWith("/checkout") ||
    path.startsWith("/dedicated/checkout") ||
    path.startsWith("/offer/")
  )
}

export function safeClientReturnPath(value?: string | null) {
  const path = String(value || "")
  if (!path || !path.startsWith("/") || path.startsWith("//")) return ""
  return path
}

export function writeCheckoutResumeIntent(intent: Omit<CheckoutResumeIntent, "createdAt">) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(CHECKOUT_RESUME_INTENT_KEY, JSON.stringify({
      ...intent,
      createdAt: new Date().toISOString(),
    }))
  } catch {
    // Resume is a UX enhancement; checkout still works without sessionStorage.
  }
}

export function readCheckoutResumeIntent(): CheckoutResumeIntent | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(CHECKOUT_RESUME_INTENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CheckoutResumeIntent>
    if (!parsed || typeof parsed.url !== "string") return null
    return {
      url: parsed.url,
      paymentRequested: Boolean(parsed.paymentRequested),
      draft: parsed.draft && typeof parsed.draft === "object" && !Array.isArray(parsed.draft) ? parsed.draft as Record<string, unknown> : {},
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function clearCheckoutResumeIntent() {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(CHECKOUT_RESUME_INTENT_KEY)
  } catch {
    // Ignore storage failures.
  }
}
