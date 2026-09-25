import { NextResponse } from "next/server"
import { safeErrorForLog } from "@/lib/log-redaction"
import { safeApiErrorMessage } from "@/lib/api-error-safe"

export function safeApiError(code: string, message: string, status = 500, reason = "server_error") {
  return NextResponse.json({ success: false, reason, code, error: message, message }, { status })
}

export function withSafeApiRoute<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try {
      return await handler(...args)
    } catch (error: any) {
      console.error("[api] route_failed", safeErrorForLog(error))
      return safeApiError(
        error?.code || "server_error",
        safeApiErrorMessage(error, "Internal server error"),
        error?.status || 500,
      )
    }
  }
}
