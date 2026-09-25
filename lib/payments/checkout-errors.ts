import { NextResponse } from "next/server"
import { safeJson } from "@/lib/safe-json"
import { safeApiErrorMessage } from "@/lib/api-error-safe"
import { checkoutErrorLogObject, redactCheckoutValue } from "@/lib/payments/checkout-trace"

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function constraintFromError(error: any) {
  const target = error?.meta?.target
  if (Array.isArray(target)) return target.join(",")
  return stringOrNull(target)
    || stringOrNull(error?.meta?.constraint)
    || stringOrNull(error?.constraint)
    || stringOrNull(error?.cause?.constraint)
    || stringOrNull(error?.payload?.error?.field)
}

function sqlStateFromError(error: any) {
  return stringOrNull(error?.sqlState)
    || stringOrNull(error?.cause?.code)
    || stringOrNull(error?.payload?.error?.code)
    || stringOrNull(error?.meta?.code)
}

export function classifyCheckoutError(error: unknown, fallbackStage = "fatal") {
  const anyError = error as any
  const prismaCode = /^P\d{4}$/.test(String(anyError?.code || "")) ? String(anyError.code) : null
  const sqlState = sqlStateFromError(anyError)
  const constraint = constraintFromError(anyError)
  const message = String(anyError?.message || "Checkout failed.")
  const stage = stringOrNull(anyError?.checkoutStage) || fallbackStage
  const lower = message.toLowerCase()
  const isPersistence = Boolean(prismaCode || sqlState || constraint || lower.includes("foreign key") || lower.includes("unique constraint") || lower.includes("column") || lower.includes("relation"))

  return {
    code: stringOrNull(anyError?.checkoutCode)
      || (stage === "order_creation" ? "checkout_order_persistence_failed" : null)
      || (isPersistence ? "checkout_persistence_failed" : "checkout_failed"),
    stage,
    status: Number(anyError?.status || anyError?.httpStatus || (isPersistence ? 500 : 500)),
    retryable: Boolean(anyError?.retryable),
    reason: message,
    technical: {
      name: stringOrNull(anyError?.name),
      prismaCode,
      sqlState,
      constraint,
      model: stringOrNull(anyError?.meta?.modelName) || stringOrNull(anyError?.model),
      meta: redactCheckoutValue(anyError?.meta || null),
      stack: sanitizeStack(anyError?.stack),
    },
  }
}

export function checkoutTechnicalErrorResponse(input: {
  error: unknown
  requestId: string
  stage?: string | null
  status?: number
}) {
  const classified = classifyCheckoutError(input.error, input.stage || "fatal")
  const status = input.status || classified.status || 500
  const clientMessage = safeApiErrorMessage(input.error, "Checkout could not be completed. Please try again.")
  return NextResponse.json(
    safeJson({
      success: false,
      ok: false,
      code: classified.code,
      message: clientMessage,
      error: clientMessage,
      reason: clientMessage,
      requestId: input.requestId,
      retryable: classified.retryable,
      stage: classified.stage,
      httpStatus: status,
    }),
    { status, headers: { "x-request-id": input.requestId } },
  )
}

export function logCheckoutFatal(error: unknown, requestId: string, stage = "fatal") {
  console.error("[CheckoutPipeline][FATAL]", {
    requestId,
    stage,
    error: checkoutErrorLogObject(error),
  })
}

function sanitizeStack(stack: unknown) {
  const text = typeof stack === "string" ? stack : ""
  if (!text) return null
  return text
    .split("\n")
    .slice(0, 30)
    .map((line) => line.replace(/(secret|token|password|authorization|signature|cookie)=([^&\s]+)/gi, "$1=[redacted]"))
    .join("\n")
}
