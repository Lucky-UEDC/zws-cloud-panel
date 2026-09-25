"use client"

import { toast } from "sonner"

const LOGOUT_EVENT = "zws:auth:logout"
const REFRESH_EVENT = "zws:auth:refresh"
const REFRESH_LOCK_KEY = "zws:auth:refresh-lock"
const AUTH_STORAGE_PREFIXES = ["auth", "session", "token", "user", "zws:auth", "zws:user"]
const REFRESH_LOCK_TTL_MS = 12_000
const REFRESH_WAIT_MS = 10_000
const AUTH_TOAST_TTL_MS = 30_000
const HEARTBEAT_MS = 5 * 60_000
const WAKE_REFRESH_AFTER_MS = 2 * 60_000

export type SessionRefreshResult = {
  ok: boolean
  final: boolean
  retryable: boolean
  status: number
}

let refreshPromise: Promise<SessionRefreshResult> | null = null
const tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const toastSeen = new Map<string, number>()

function hasWindow() {
  return typeof window !== "undefined"
}

function clearBrowserAuthState() {
  if (!hasWindow()) return
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of Object.keys(storage)) {
      if (AUTH_STORAGE_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) {
        storage.removeItem(key)
      }
    }
  }
}

function postBroadcast(name: string, payload: Record<string, unknown>) {
  if (!hasWindow()) return
  try {
    const channel = new BroadcastChannel(name)
    channel.postMessage(payload)
    channel.close()
  } catch {
    window.localStorage.setItem(name, JSON.stringify({ ...payload, at: Date.now() }))
    window.localStorage.removeItem(name)
  }
}

export function broadcastLogout() {
  postBroadcast(LOGOUT_EVENT, { type: "logout", at: Date.now() })
}

function broadcastRefresh(result: Record<string, unknown>) {
  postBroadcast(REFRESH_EVENT, { type: "refresh", at: Date.now(), ...result })
}

function readRefreshLock() {
  if (!hasWindow()) return null
  try {
    const parsed = JSON.parse(window.localStorage.getItem(REFRESH_LOCK_KEY) || "null") as { owner?: string; at?: number } | null
    if (!parsed?.owner || !parsed.at) return null
    if (Date.now() - parsed.at > REFRESH_LOCK_TTL_MS) {
      window.localStorage.removeItem(REFRESH_LOCK_KEY)
      return null
    }
    return parsed
  } catch {
    window.localStorage.removeItem(REFRESH_LOCK_KEY)
    return null
  }
}

function writeRefreshLock() {
  if (hasWindow()) window.localStorage.setItem(REFRESH_LOCK_KEY, JSON.stringify({ owner: tabId, at: Date.now() }))
}

function clearRefreshLock() {
  if (!hasWindow()) return
  const lock = readRefreshLock()
  if (!lock || lock.owner === tabId) window.localStorage.removeItem(REFRESH_LOCK_KEY)
}

function waitForPeerRefresh(timeoutMs = REFRESH_WAIT_MS) {
  if (!hasWindow()) return Promise.resolve<SessionRefreshResult | null>(null)
  return new Promise<SessionRefreshResult | null>((resolve) => {
    let settled = false
    let channel: BroadcastChannel | null = null
    const done = (result: SessionRefreshResult | null) => {
      if (settled) return
      settled = true
      channel?.close()
      window.removeEventListener("storage", onStorage)
      window.clearTimeout(timeout)
      resolve(result)
    }
    const parse = (payload: any) => {
      if (!payload || payload.type !== "refresh" || payload.owner === tabId) return null
      if (payload.state === "success") return { ok: true, final: false, retryable: false, status: 200 }
      if (payload.state === "failure") {
        const status = Number(payload.status || 0)
        return { ok: false, final: status === 401, retryable: status !== 401, status }
      }
      return null
    }
    const onMessage = (payload: any) => {
      const result = parse(payload)
      if (result) done(result)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REFRESH_EVENT || !event.newValue) return
      try {
        onMessage(JSON.parse(event.newValue))
      } catch {
        // Ignore malformed cross-tab messages.
      }
    }
    try {
      channel = new BroadcastChannel(REFRESH_EVENT)
      channel.onmessage = (event) => onMessage(event.data)
    } catch {
      window.addEventListener("storage", onStorage)
    }
    const timeout = window.setTimeout(() => done(null), timeoutMs)
  })
}

export function dedupedAuthToast(message: string, key = message, ttlMs = AUTH_TOAST_TTL_MS) {
  const normalized = key.trim().toLowerCase()
  const now = Date.now()
  const last = toastSeen.get(normalized) || 0
  if (now - last < ttlMs) return false
  toastSeen.set(normalized, now)
  toast.error(message)
  return true
}

export async function performSessionRefresh(): Promise<SessionRefreshResult> {
  if (refreshPromise) return refreshPromise

  const peerLock = readRefreshLock()
  if (peerLock && peerLock.owner !== tabId) {
    const peerResult = await waitForPeerRefresh()
    if (peerResult) return peerResult
  }

  refreshPromise = (async () => {
    writeRefreshLock()
    broadcastRefresh({ owner: tabId, state: "started" })
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      })
      if (response.ok) {
        broadcastRefresh({ owner: tabId, state: "success", status: response.status })
        return { ok: true, final: false, retryable: false, status: response.status }
      }
      const result = { ok: false, final: response.status === 401, retryable: response.status !== 401, status: response.status }
      broadcastRefresh({ owner: tabId, state: "failure", status: response.status })
      return result
    } catch {
      const result = { ok: false, final: false, retryable: true, status: 0 }
      broadcastRefresh({ owner: tabId, state: "failure", status: 0 })
      return result
    } finally {
      clearRefreshLock()
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export function redirectToLogin() {
  if (!hasWindow()) return
  const next = window.location.pathname + window.location.search
  window.location.href = `/login?next=${encodeURIComponent(next)}`
}

function isHeartbeatPath() {
  if (!hasWindow()) return false
  const path = window.location.pathname
  return path.startsWith("/admin") || path.startsWith("/support-agent") || path.startsWith("/client-area")
}

async function heartbeatRefresh(reason: string) {
  if (!isHeartbeatPath()) return
  const result = await performSessionRefresh()
  if (result.final && result.status === 401) {
    dedupedAuthToast("Your session expired. Please sign in again.", "session_expired")
    broadcastLogout()
    redirectToLogin()
  } else if (!result.ok && result.retryable) {
    console.warn("[AUTH] session heartbeat retryable failure", { reason, status: result.status })
  }
}

export function installAuthRefreshListener() {
  if (!hasWindow()) return () => {}
  const handler = () => window.dispatchEvent(new CustomEvent("zws:auth-refreshed"))
  let channel: BroadcastChannel | null = null
  const onStorage = (event: StorageEvent) => {
    if (event.key === REFRESH_EVENT && event.newValue) handler()
  }
  try {
    channel = new BroadcastChannel(REFRESH_EVENT)
    channel.onmessage = handler
  } catch {
    window.addEventListener("storage", onStorage)
  }
  return () => {
    channel?.close()
    window.removeEventListener("storage", onStorage)
  }
}

export function installSessionHeartbeat() {
  if (!hasWindow()) return () => {}
  let lastRefreshAt = Date.now()
  const run = (reason: string) => {
    lastRefreshAt = Date.now()
    void heartbeatRefresh(reason)
  }
  const interval = window.setInterval(() => run("interval"), HEARTBEAT_MS)
  const onWake = () => {
    if (document.visibilityState === "visible" && Date.now() - lastRefreshAt > WAKE_REFRESH_AFTER_MS) run("visibility")
  }
  const onFocus = () => {
    if (Date.now() - lastRefreshAt > WAKE_REFRESH_AFTER_MS) run("focus")
  }
  document.addEventListener("visibilitychange", onWake)
  window.addEventListener("focus", onFocus)
  return () => {
    window.clearInterval(interval)
    document.removeEventListener("visibilitychange", onWake)
    window.removeEventListener("focus", onFocus)
  }
}

export function installLogoutListener(redirectTo = "/login") {
  if (!hasWindow()) return () => {}
  const handler = () => {
    clearBrowserAuthState()
    window.dispatchEvent(new CustomEvent("zws:disconnect-websockets"))
    if (!window.location.pathname.startsWith("/login")) window.location.assign(redirectTo)
  }
  let channel: BroadcastChannel | null = null
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOGOUT_EVENT) handler()
  }
  try {
    channel = new BroadcastChannel(LOGOUT_EVENT)
    channel.onmessage = handler
  } catch {
    window.addEventListener("storage", onStorage)
  }
  window.addEventListener("zws:auth-invalidated", handler)
  return () => {
    channel?.close()
    window.removeEventListener("storage", onStorage)
    window.removeEventListener("zws:auth-invalidated", handler)
  }
}

export async function logoutEverywhere(endpoint = "/api/auth/logout", redirectTo = "/login") {
  await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } }).catch(() => null)
  clearBrowserAuthState()
  window.dispatchEvent(new CustomEvent("zws:disconnect-websockets"))
  broadcastLogout()
  window.location.assign(redirectTo)
}
