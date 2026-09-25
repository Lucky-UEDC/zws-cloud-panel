import crypto from "node:crypto"
import { NextResponse } from "next/server"
import { safeJson } from "@/lib/safe-json"

export type PaymentStage =
  | "auth"
  | "validation"
  | "db_order"
  | "db_invoice"
  | "db_payment"
  | "gateway_init"
  | "redirect"
  | "status_poll"
  | "webhook"
  | "finalize"
  | "provision_queue"

export type PaymentErrorInput = {
  requestId: string
  code: string
  message: string
  httpStatus: number
  stage: PaymentStage
  retryable?: boolean
  details?: unknown
}
export function paymentRequestId(request?: Request | null) {
  const fromHeader = String(
    request?.headers.get("x-request-id")
    || request?.headers.get("x-correlation-id")
    || "",
  ).trim()
  if (fromHeader) return fromHeader.slice(0, 120)
  return `pay_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`
}

export function paymentErrorResponse(input: PaymentErrorInput) {
  return NextResponse.json(
    safeJson({
      success: false,
      ok: false,
      error: input.message,
      message: input.message,
      code: input.code,
      requestId: input.requestId,
      stage: input.stage,
      retryable: Boolean(input.retryable),
      httpStatus: input.httpStatus,
      details: input.details ?? null,
    }),
    {
      status: input.httpStatus,
      headers: {
        "x-request-id": input.requestId,
      },
    },
  )
}

export function paymentSuccessResponse<T extends Record<string, unknown>>(
  payload: T,
  input: { requestId: string; httpStatus?: number; code?: string; message?: string; stage?: PaymentStage },
) {
  return NextResponse.json(
    safeJson({
      success: true,
      ok: true,
      requestId: input.requestId,
      code: input.code || "ok",
      message: input.message || "Payment request processed.",
      stage: input.stage || "redirect",
      httpStatus: input.httpStatus || 200,
      ...payload,
    }),
    {
      status: input.httpStatus || 200,
      headers: {
        "x-request-id": input.requestId,
      },
    },
  )
}

export function paymentLog(event: string, payload: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      subsystem: "payment",
      event,
      ...payload,
    }),
  )
}
