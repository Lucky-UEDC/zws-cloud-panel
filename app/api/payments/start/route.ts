import { NextRequest } from "next/server"
import { POST as createPayment } from "@/app/api/payments/create/route"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { paymentLog, paymentRequestId } from "@/lib/payments/trace"

function paymentCreateUrl(request: NextRequest) {
  return new URL("/api/payments/create", request.url)
}

function paymentCreateRequest(request: NextRequest, body: unknown) {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.set("x-forwarded-host", request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") || "https")
  headers.set("x-request-id", request.headers.get("x-request-id") || paymentRequestId(request))
  return new NextRequest(paymentCreateUrl(request), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || paymentRequestId(request)
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const body = await request.json().catch(() => ({}))
  const captcha = await requireTurnstile(gate.ctx, (body as any)?.turnstileToken, "checkout")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "payment_start", 10, 60 * 60_000)
  if (!rate.ok) return rate.response
  paymentLog("payments_start_forwarding", {
    requestId,
    stage: "validation",
    productId: typeof (body as any)?.productId === "string" ? (body as any).productId : null,
    purpose: (body as any)?.purpose || null,
    term: (body as any)?.term || null,
    hasPassword: Boolean((body as any)?.password),
  })
  const forwardedHeaders = new Headers(request.headers)
  forwardedHeaders.set("x-request-id", requestId)
  const forwardedRequest = new NextRequest(request.url, { method: request.method, headers: forwardedHeaders })
  const response = await createPayment(paymentCreateRequest(forwardedRequest, body))
  const snapshot = await response.clone().json().catch(() => null)
  paymentLog("payments_start_response", {
    requestId,
    stage: "redirect",
    status: response.status,
    success: snapshot?.success ?? null,
    gateway: snapshot?.gateway || null,
    orderId: snapshot?.orderId || null,
    invoiceId: snapshot?.invoiceId || null,
    gatewayOrderId: snapshot?.gatewayOrderId || snapshot?.cashfreeOrderId || null,
    hasPaymentSessionId: Boolean(snapshot?.paymentSessionId || snapshot?.payment_session_id),
    hasPaymentUrl: Boolean(snapshot?.paymentUrl || snapshot?.payment_url || snapshot?.checkoutUrl || snapshot?.checkout_url || snapshot?.redirectUrl || snapshot?.redirect_url),
  })
  const headers = new Headers(response.headers)
  headers.set("x-request-id", String(snapshot?.requestId || requestId))
  return new Response(response.body, { status: response.status, headers })
}
