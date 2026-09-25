"use client"

import { readJsonResponse } from "@/lib/client/safe-json"

type AdminApiOptions = RequestInit & {
  redirectOnAuthError?: boolean
  timeoutMs?: number
}

export const DEFAULT_ADMIN_API_TIMEOUT_MS = 15_000

export class AdminApiError extends Error {
  status: number
  code?: string
  data: any

  constructor(message: string, input: { status: number; code?: string; data?: any }) {
    super(message)
    this.name = "AdminApiError"
    this.status = input.status
    this.code = input.code
    this.data = input.data
  }
}

function currentAdminReturnTo() {
  if (typeof window === "undefined") return "/admin"
  return `${window.location.pathname}${window.location.search || ""}`
}

export function adminLoginUrl() {
  const params = new URLSearchParams({ expired: "1", returnTo: currentAdminReturnTo() })
  return `/login?${params.toString()}`
}

export function isAdminAuthError(error: unknown) {
  if (!(error instanceof AdminApiError)) return false
  return (
    error.status === 401 ||
    error.code === "session_expired" ||
    error.code === "unauthenticated" ||
    error.code === "ADMIN_UNAUTHORIZED" ||
    error.code === "mfa_required" ||
    error.code === "recent_mfa_required"
  )
}

export function redirectToAdminLogin() {
  if (typeof window !== "undefined") window.location.assign(adminLoginUrl())
}

export async function adminApiJson<T = any>(url: string, options: AdminApiOptions = {}): Promise<T> {
  const { redirectOnAuthError = false, timeoutMs = DEFAULT_ADMIN_API_TIMEOUT_MS, ...fetchOptions } = options
  const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0
  const controller = timeoutEnabled ? new AbortController() : null
  const externalSignal = fetchOptions.signal
  let timedOut = false
  const timeoutId = controller
    ? window.setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    : null
  const abortFromExternalSignal = () => controller?.abort()
  if (externalSignal && controller) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true })
  }

  let response: Response
  try {
    response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...fetchOptions,
      signal: controller?.signal || externalSignal,
      headers: {
        ...(fetchOptions.body ? { "Content-Type": "application/json" } : {}),
        ...(fetchOptions.headers || {}),
      },
    })
  } catch (error) {
    if (timedOut) {
      throw new AdminApiError(`Admin request timed out after ${Math.round(timeoutMs / 1000)} seconds`, {
        status: 408,
        code: "request_timeout",
      })
    }
    throw error
  } finally {
    if (timeoutId != null) window.clearTimeout(timeoutId)
    if (externalSignal && controller) externalSignal.removeEventListener("abort", abortFromExternalSignal)
  }

  const data = await readJsonResponse<any>(response)

  if (!response.ok) {
    const code = String(data?.code || "")
    const message = String(data?.error || data?.message || `Admin request failed (${response.status})`)
    const error = new AdminApiError(message, { status: response.status, code, data })
    if (redirectOnAuthError && isAdminAuthError(error)) redirectToAdminLogin()
    throw error
  }

  return data as T
}

export function adminApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AdminApiError) return error.message || fallback
  if (error instanceof Error) return error.message || fallback
  return fallback
}
