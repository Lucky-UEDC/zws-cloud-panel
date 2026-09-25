import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { extractClientIp, getRequestContext } from "@/lib/request-context"
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookies"
import { hashSessionId } from "@/lib/auth/session-store"
import { deviceFingerprint } from "@/lib/auth/mfa/device"
import type { PayloadDetection } from "@/lib/security/input"

export type SecurityContext = {
  ip: string
  route: string
  method: string
  userAgent: string
  country: string | null
  asn: string | null
  deviceFingerprint: string | null
  sessionIdHash: string | null
}

export function securityJson(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, ok: false, code, error: message, message, ...extra }, { status })
}

export async function getSecurityContext(request: NextRequest | Request): Promise<SecurityContext> {
  const req = request as NextRequest
  const route = "nextUrl" in req ? req.nextUrl.pathname : new URL(request.url).pathname
  const userAgent = request.headers.get("user-agent") || ""
  const context = await getRequestContext(request).catch(() => null)
  const fallbackIp = extractClientIp(request)
  const rawSession = "cookies" in req
    ? req.cookies.get(SESSION_COOKIE_NAMES.client)?.value || req.cookies.get(SESSION_COOKIE_NAMES.admin)?.value || null
    : null
  const fp = context ? deviceFingerprint({
    ip: context.ip,
    city: context.city,
    region: context.region,
    country: context.country,
    timezone: context.timezone,
    asn: context.asn,
    provider: context.provider,
    proxy: context.proxy,
    vpn: context.vpn,
    tor: context.tor,
    relay: context.relay,
    browser: context.browser,
    browserVersion: context.browserVersion,
    os: context.os,
    osVersion: context.osVersion,
    deviceType: context.deviceType,
    platform: context.platform,
    cpuArchitecture: context.cpuArchitecture,
    userAgent: context.userAgent,
  }) : null

  return {
    ip: context?.ip || fallbackIp,
    route,
    method: request.method,
    userAgent,
    country: context?.country || null,
    asn: context?.asn || null,
    deviceFingerprint: fp,
    sessionIdHash: rawSession ? hashSessionId(rawSession) : null,
  }
}

export function activeBlockWhere(now = new Date()) {
  return {
    unblockedAt: null,
    OR: [
      { permanent: true },
      { blockedUntil: { gt: now } },
    ],
  }
}

export async function getActiveSecurityBlocks(ctx: SecurityContext) {
  const [ipBlock, deviceBlock] = await Promise.all([
    ctx.ip && ctx.ip !== "unknown"
      ? (prisma as any).blockedIp.findFirst({ where: { ip: ctx.ip, ...activeBlockWhere() } }).catch(() => null)
      : Promise.resolve(null),
    ctx.deviceFingerprint
      ? (prisma as any).blockedDevice.findFirst({ where: { deviceFingerprint: ctx.deviceFingerprint, ...activeBlockWhere() } }).catch(() => null)
      : Promise.resolve(null),
  ])
  return { ipBlock, deviceBlock }
}

export async function assertNotBlocked(ctx: SecurityContext) {
  const { ipBlock, deviceBlock } = await getActiveSecurityBlocks(ctx)
  if (deviceBlock) {
    await logSecurityEvent(ctx, "device_security_signal_logged", "warn", "logged", {
      deviceBlockId: deviceBlock.id || null,
      reason: deviceBlock.reason || "blocked_device",
    })
  }
  if (ipBlock?.permanent) {
    await logSecurityEvent(ctx, "blocked_request_denied", "warn", "denied", {
      ipBlockId: ipBlock?.id || null,
      reason: ipBlock?.reason || "ip_permanently_banned",
    })
    return {
      ok: false as const,
      response: securityJson("ip_permanently_banned", "IP permanently banned.", 403, {
        reason: ipBlock?.reason || "ip_permanently_banned",
        ruleTriggered: ipBlock?.attackType || "permanent_ip_ban",
        ip: ctx.ip,
        page: ctx.route,
      }),
    }
  }
  if (ipBlock) {
    await logSecurityEvent(ctx, "temporary_ip_block_bypassed", "warn", "logged", {
      ipBlockId: ipBlock.id || null,
      reason: ipBlock.reason || "temporary_ip_block",
    })
  }
  return { ok: true as const }
}

export async function logSecurityEvent(
  ctx: SecurityContext,
  eventType: string,
  severity: "info" | "warn" | "error" = "info",
  actionTaken?: string | null,
  metadata: Record<string, unknown> = {},
) {
  await (prisma as any).securityEvent.create({
    data: {
      eventType,
      severity,
      route: ctx.route,
      method: ctx.method,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      country: ctx.country,
      asn: ctx.asn,
      deviceFingerprint: ctx.deviceFingerprint,
      sessionIdHash: ctx.sessionIdHash,
      actionTaken: actionTaken || null,
      metadata,
    },
  }).catch(() => null)
}

export async function logAttack(ctx: SecurityContext, detection: PayloadDetection, field?: string | null, actionTaken = "rejected") {
  const attackType = detection.attackTypes[0] || "malicious_payload"
  await (prisma as any).attackLog.create({
    data: {
      attackType,
      route: ctx.route,
      method: ctx.method,
      field: field || null,
      payloadHash: detection.hash,
      payloadSample: detection.sample,
      normalizedSample: detection.normalized.slice(0, 500),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      country: ctx.country,
      asn: ctx.asn,
      deviceFingerprint: ctx.deviceFingerprint,
      sessionIdHash: ctx.sessionIdHash,
      actionTaken,
      metadata: { attackTypes: detection.attackTypes },
    },
  }).catch(() => null)
  await logSecurityEvent(ctx, `attack_${attackType}`, "error", actionTaken, { field, attackTypes: detection.attackTypes })
}

export async function logSuspiciousRequest(
  ctx: SecurityContext,
  reason: string,
  severity: "info" | "warn" | "error" = "warn",
  actionTaken?: string | null,
  metadata: Record<string, unknown> = {},
  identifier?: string | null,
) {
  await (prisma as any).suspiciousRequest.create({
    data: {
      reason,
      severity,
      route: ctx.route,
      method: ctx.method,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      country: ctx.country,
      asn: ctx.asn,
      deviceFingerprint: ctx.deviceFingerprint,
      sessionIdHash: ctx.sessionIdHash,
      identifier: identifier || null,
      actionTaken: actionTaken || null,
      metadata,
    },
  }).catch(() => null)
  await logSecurityEvent(ctx, `suspicious_${reason}`, severity, actionTaken || "logged", metadata)
}

export async function blockSecurityContext(
  ctx: SecurityContext,
  reason = "abuse",
  attackType = reason,
  metadata: Record<string, unknown> = {},
) {
  const common = {
    reason,
    attackType,
    country: ctx.country,
    asn: ctx.asn,
    userAgent: ctx.userAgent,
    sessionIdHash: ctx.sessionIdHash,
    permanent: true,
    metadata: { route: ctx.route, method: ctx.method, ...metadata },
  }
  await Promise.all([
    ctx.ip && ctx.ip !== "unknown"
      ? (prisma as any).blockedIp.create({ data: { ...common, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint } }).catch(() => null)
      : Promise.resolve(null),
    ctx.deviceFingerprint
      ? (prisma as any).blockedDevice.create({ data: { ...common, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint } }).catch(() => null)
      : Promise.resolve(null),
    ctx.sessionIdHash
      ? (prisma as any).session.updateMany({ where: { sessionIdHash: ctx.sessionIdHash, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => null)
      : Promise.resolve(null),
    ctx.sessionIdHash
      ? (prisma as any).userLoginSession.updateMany({ where: { sessionIdHash: ctx.sessionIdHash, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => null)
      : Promise.resolve(null),
  ])
  await logSuspiciousRequest(ctx, reason, "error", "blocked", metadata)
}

export async function blockContext(ctx: SecurityContext, detection: PayloadDetection, reason = "malicious_payload") {
  const attackType = detection.attackTypes[0] || reason
  const common = {
    reason,
    attackType,
    payloadHash: detection.hash,
    payloadSample: detection.sample,
    country: ctx.country,
    asn: ctx.asn,
    userAgent: ctx.userAgent,
    sessionIdHash: ctx.sessionIdHash,
    permanent: true,
    metadata: { route: ctx.route, method: ctx.method, attackTypes: detection.attackTypes },
  }
  await Promise.all([
    ctx.ip && ctx.ip !== "unknown"
      ? (prisma as any).blockedIp.create({ data: { ...common, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint } }).catch(() => null)
      : Promise.resolve(null),
    ctx.deviceFingerprint
      ? (prisma as any).blockedDevice.create({ data: { ...common, ip: ctx.ip, deviceFingerprint: ctx.deviceFingerprint } }).catch(() => null)
      : Promise.resolve(null),
    ctx.sessionIdHash
      ? (prisma as any).session.updateMany({ where: { sessionIdHash: ctx.sessionIdHash, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => null)
      : Promise.resolve(null),
    ctx.sessionIdHash
      ? (prisma as any).userLoginSession.updateMany({ where: { sessionIdHash: ctx.sessionIdHash, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => null)
      : Promise.resolve(null),
  ])
  await logSecurityEvent(ctx, "context_blocked", "error", "blocked", { reason, attackType })
}

export async function rejectDetectedPayload(ctx: SecurityContext, detection: PayloadDetection, field?: string | null) {
  await logAttack(ctx, detection, field, "blocked")
  await blockContext(ctx, detection, "malicious_payload")
  return securityJson("payload_rejected", "Request rejected by security validation.", 400, { field: field || undefined })
}
