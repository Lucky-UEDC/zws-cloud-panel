import { NextResponse } from "next/server"
import { getAdminFromCookies } from "@/lib/server-auth"
import { isAdminLikeRole } from "@/lib/admin-rbac"
import { extractClientIp } from "@/lib/request-context"

export const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
}

export function statusFromError(error: unknown) {
  const status = (error as { status?: unknown })?.status
  return typeof status === "number" ? status : 500
}

export function jsonError(error: unknown, fallback = "Unexpected error") {
  const message = error instanceof Error ? error.message : fallback
  return NextResponse.json({ ok: false, error: message }, { status: statusFromError(error), headers: noStoreHeaders })
}

export function jsonOk(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status, headers: noStoreHeaders })
}

export async function requireGatewayAdmin(request: Request) {
  const token = process.env.WHATSAPP_ADMIN_TOKEN
  const authorization = request.headers.get("authorization")

  if (authorization) {
    if (token && authorization === `Bearer ${token}`) return
    const error = new Error("Unauthorized")
    ;(error as Error & { status?: number }).status = 401
    throw error
  }

  const admin = await getAdminFromCookies()
  if (admin?.email && isAdminLikeRole(admin.role)) return

  const error = new Error("Unauthorized")
  ;(error as Error & { status?: number }).status = 401
  throw error
}

export function badRequest(message: string): never {
  const error = new Error(message)
  ;(error as Error & { status?: number }).status = 400
  throw error
}

const gatewayRateLimit = new Map<string, { count: number; resetAt: number }>()

export function rateLimitGateway(request: Request, limit = 60, windowMs = 60_000) {
  const key = `whatsapp-gateway:${extractClientIp(request)}`
  const now = Date.now()
  const current = gatewayRateLimit.get(key)
  if (!current || current.resetAt <= now) {
    gatewayRateLimit.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  current.count += 1
  if (current.count > limit) {
    const error = new Error("Too many requests. Please slow down.")
    ;(error as Error & { status?: number }).status = 429
    throw error
  }
}

export const GATEWAY_HEADERS = noStoreHeaders