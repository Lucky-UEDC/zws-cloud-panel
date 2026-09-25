import { NextRequest } from "next/server"
import { POST as createPayment } from "@/app/api/payments/create/route"
import { paymentRequestId } from "@/lib/payments/trace"

function orderCreateRequest(request: NextRequest, body: unknown) {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.set("x-forwarded-host", request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") || "https")
  headers.set("x-request-id", request.headers.get("x-request-id") || paymentRequestId(request))
  return new NextRequest(new URL("/api/payments/create", request.url), {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...(body && typeof body === "object" ? body as Record<string, unknown> : {}),
      gateway: "razorpay",
      preferredGateway: "razorpay",
    }),
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const response = await createPayment(orderCreateRequest(request, body))
  const headers = new Headers(response.headers)
  headers.set("x-request-id", headers.get("x-request-id") || request.headers.get("x-request-id") || paymentRequestId(request))
  return new Response(response.body, { status: response.status, headers })
}
