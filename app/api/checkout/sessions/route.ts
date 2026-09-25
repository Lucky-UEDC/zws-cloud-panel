import { NextRequest } from "next/server"
import { POST as createPayment } from "@/app/api/payments/create/route"
import { requireRateLimit, requireTurnstile, securityGate } from "@/lib/security/forms"
import { paymentLog, paymentRequestId } from "@/lib/payments/trace"

function paymentCreateRequest(request: NextRequest, body: unknown) {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.set("x-forwarded-host", request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") || "https")
  headers.set("x-request-id", request.headers.get("x-request-id") || paymentRequestId(request))
  return new NextRequest(new URL("/api/payments/create", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ ...(body && typeof body === "object" ? body as Record<string, unknown> : {}), prepareCheckoutOnly: true }),
  })
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") || paymentRequestId(request)
  const gate = await securityGate(request)
  if (!gate.ok) return gate.response
  const body = await request.json().catch(() => ({}))
  const captcha = await requireTurnstile(gate.ctx, (body as any)?.turnstileToken, "checkout")
  if (!captcha.ok) return captcha.response
  const rate = await requireRateLimit(gate.ctx, "checkout_session", 10, 60 * 60_000)
  if (!rate.ok) return rate.response
  paymentLog("checkout_session_prepare", {
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
  const headers = new Headers(response.headers)
  headers.set("x-request-id", String(snapshot?.requestId || requestId))
  return new Response(response.body, { status: response.status, headers })
}
