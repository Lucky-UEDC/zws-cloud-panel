import { prisma } from "@/lib/db"
import { createPanelLog } from "@/lib/panel-log"

type AttemptInput = {
  orderId?: string | null
  invoiceId?: string | null
  paymentId?: string | null
  gateway: "phonepe" | "cashfree" | "manual" | "wallet" | "bypass" | string
  status: "started" | "success" | "failed" | "fallback" | string
  requestId?: string | null
  errorCode?: string | null
  safeErrorMessage?: string | null
  requestPayloadSafe?: Record<string, unknown> | null
  responsePayloadSafe?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}

export async function recordGatewayAttempt(input: AttemptInput) {
  const safeErrorMessage = input.safeErrorMessage ? String(input.safeErrorMessage).slice(0, 500) : null
  const row = await prisma.paymentGatewayAttempt.create({
    data: {
      orderId: input.orderId || null,
      invoiceId: input.invoiceId || null,
      paymentId: input.paymentId || null,
      gateway: input.gateway,
      status: input.status,
      requestId: input.requestId || null,
      errorCode: input.errorCode || null,
      safeErrorMessage,
      requestPayloadSafe: (input.requestPayloadSafe || null) as any,
      responsePayloadSafe: (input.responsePayloadSafe || null) as any,
      errorMessage: safeErrorMessage,
      metadata: (input.metadata || {}) as any,
    },
  }).catch(() => null)

  await createPanelLog({
    category: "Payment",
    level: input.status === "failed" ? "warn" : "info",
    message: `payment_${input.status}`,
    orderId: input.orderId || null,
    paymentId: input.paymentId || null,
    metadata: {
      invoiceId: input.invoiceId || null,
      gateway: input.gateway,
      requestId: input.requestId || null,
      errorCode: input.errorCode || null,
      safeErrorMessage,
    },
  }).catch(() => null)

  return row
}

export function safeGatewayError(error: any) {
  return {
    errorCode: String(error?.safeCode || error?.code || error?.statusCode || "gateway_error"),
    safeErrorMessage: String(error?.safeMessage || error?.message || "Payment gateway request failed").slice(0, 500),
  }
}
