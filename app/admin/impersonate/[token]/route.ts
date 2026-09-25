import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { issueSession } from "@/lib/auth/session-store"
import { LEGACY_SESSION_COOKIE_NAMES, SESSION_COOKIE_NAMES, SESSION_COOKIE_OPTIONS } from "@/lib/auth/session-cookies"
import { getSetting, type SecuritySettings } from "@/lib/settings"
import { extractClientIp } from "@/lib/request-context"
import { consumeAdminCustomerImpersonationToken } from "@/lib/admin-customer-impersonation"
import { createPanelLog } from "@/lib/panel-log"

export const dynamic = "force-dynamic"

function publicUrl(request: NextRequest, path: string) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim()
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
  if (host && !/^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/i.test(host)) {
    return new URL(path, `${forwardedProto || "https"}://${host}`)
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  if (configured) {
    try {
      const base = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`)
      if (!/^(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/i.test(base.host)) {
        return new URL(path, base)
      }
    } catch {}
  }

  return new URL(path, request.url)
}

function failRedirect(request: NextRequest, reason: string) {
  const url = publicUrl(request, "/login")
  url.searchParams.set("impersonation", reason)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) return failRedirect(request, "missing")

  const consumed = await consumeAdminCustomerImpersonationToken({
    token,
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent"),
  })

  if (!consumed.ok) {
    await createPanelLog({
      category: "Security",
      level: "warn",
      message: "customer_impersonation_failed",
      metadata: { reason: consumed.reason },
    }).catch(() => null)
    return failRedirect(request, consumed.reason)
  }

  const customer = await prisma.customer.findUnique({
    where: { id: consumed.customer.id },
    select: { id: true, email: true, name: true, status: true },
  })
  if (!customer) return failRedirect(request, "customer_not_found")

  const security = await getSetting<SecuritySettings>("security_settings").catch(() => ({ sessionTimeoutMinutes: 43200 } as SecuritySettings))
  const issued = await issueSession({
    userId: customer.id,
    role: "client",
    email: customer.email,
    sessionMinutes: security.sessionTimeoutMinutes,
    request,
    assuranceLevel: "FULLY_AUTHENTICATED",
    mfaVerifiedAt: new Date(),
  })

  await createPanelLog({
    category: "Security",
    message: "customer_impersonation_session_created",
    actorType: "admin",
    actorId: consumed.admin.id,
    actorEmail: consumed.admin.email,
    customerId: customer.id,
    metadata: { impersonationTokenId: consumed.row.id },
  }).catch(() => null)

  const response = NextResponse.redirect(publicUrl(request, "/client-area"))
  response.cookies.set(SESSION_COOKIE_NAMES.client, issued.sessionId, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: issued.ttlSeconds,
  })
  response.cookies.delete(SESSION_COOKIE_NAMES.admin)
  response.cookies.delete(LEGACY_SESSION_COOKIE_NAMES.admin)
  response.cookies.delete(LEGACY_SESSION_COOKIE_NAMES.client)
  return response
}
