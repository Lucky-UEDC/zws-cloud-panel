"use client"

type FrontendErrorPayload = {
  source: string
  name?: string
  message?: string
  digest?: string | null
  stack?: string | null
  path?: string
}

export function logFrontendError(payload: FrontendErrorPayload) {
  if (typeof window === "undefined") return

  const body = {
    ...payload,
    path: payload.path || `${window.location.pathname}${window.location.search}`,
    userAgent: window.navigator.userAgent,
  }

  fetch("/api/frontend-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => null)
}
