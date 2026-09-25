"use client"

import { broadcastLogout, dedupedAuthToast, performSessionRefresh, redirectToLogin } from "@/lib/client/auth-session"

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = String(init.method || "GET").toUpperCase()
  const headers = new Headers(init.headers)
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
  }
  const requestInit = { credentials: "include" as RequestCredentials, ...init, headers }
  const response = await fetch(input, requestInit)
  if (response.status !== 401) return response

  const refresh = await performSessionRefresh()
  if (refresh.ok) {
    const retry = await fetch(input, requestInit)
    if (retry.status !== 401) return retry
  }

  if (refresh.final && refresh.status === 401 && typeof window !== "undefined") {
    dedupedAuthToast("Your session expired. Please sign in again.", "session_expired")
    broadcastLogout()
    redirectToLogin()
  }
  return response
}
