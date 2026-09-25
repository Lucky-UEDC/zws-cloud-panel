import { NextResponse } from "next/server"
import { safeJson } from "@/lib/safe-json"

export type ApiErrorCode =
  | "invalid_credentials"
  | "user_not_found"
  | "server_error"
  | "login_required"
  | "profile_incomplete"
  | "invalid_request"
  | "unauthorized"

type ApiResponseMeta = {
  requestId?: string | null
  retryable?: boolean
  stage?: string | null
}

export function apiError(
  code: ApiErrorCode | string,
  message: string,
  status = 400,
  details: unknown = null,
  meta: ApiResponseMeta = {},
) {
  const requestId = meta.requestId ? String(meta.requestId) : null
  return NextResponse.json(
    safeJson({
      ok: false,
      success: false,
      error: message,
      errorDetail: { code, message, details },
      code,
      message,
      requestId,
      retryable: Boolean(meta.retryable),
      stage: meta.stage || null,
      httpStatus: status,
    }),
    {
      status,
      headers: requestId
        ? { "x-request-id": requestId }
        : undefined,
    },
  )
}

export function apiSuccess<T extends Record<string, unknown>>(payload: T, status = 200, meta: ApiResponseMeta = {}) {
  const requestId = meta.requestId ? String(meta.requestId) : null
  return NextResponse.json(
    safeJson({
      ok: true,
      success: true,
      requestId,
      stage: meta.stage || null,
      httpStatus: status,
      ...payload,
    }),
    {
      status,
      headers: requestId
        ? { "x-request-id": requestId }
        : undefined,
    },
  )
}
