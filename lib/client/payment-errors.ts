"use client"

export function paymentClientMessage(input: { code?: string | null; message?: string | null; fallback?: string }) {
  const code = String(input.code || "").toLowerCase()
  const message = String(input.message || "").trim()
  if (code === "login_required") return "Please login to continue checkout."
  if (code === "profile_incomplete") return "Please complete your billing profile before payment."
  if (code === "billing_address_required") return "Billing address is required before payment."
  if (code === "payment_init_failed" || code === "payment_start_failed") return "Payment could not be started. Please retry."
  if (code === "no_gateway_available") return "No payment gateway is available right now. Please try shortly."
  if (code === "gateway_unavailable") return message || "Selected payment gateway is currently unavailable. Please select another payment method."
  if (code === "gateway_not_ready") return "Payment gateway is not ready. Please retry shortly."
  if (code === "pricing_token_mismatch" || code === "pricing_token_required") return "Pricing was refreshed. Please review and retry."
  if (code === "wallet_insufficient") return "Insufficient wallet balance."
  if (message) return message
  return input.fallback || "Payment request failed."
}
