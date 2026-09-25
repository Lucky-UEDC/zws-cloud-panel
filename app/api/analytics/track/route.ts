import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { UAParser } from "ua-parser-js"
import { prisma, isDatabaseAvailable } from "@/lib/db"
import { detectCrawler, extractUtmFromPath, normalizeTrafficSource } from "@/lib/analytics-attribution"
import { truncateLargeString } from "@/lib/string-safety"
import { getAppUrl } from "@/lib/runtime-site-url"
import { getRequestContext } from "@/lib/request-context"

function hashIp(value: string | null | undefined) {
  const ip = String(value || "").trim()
  if (!ip) return null
  const salt = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || ""
  if (!salt) return null
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex")
}

function conversionType(eventType: string, eventName: string) {
  const key = `${eventType}:${eventName}`.toLowerCase()
  if (/order.*conversion|checkout.*complete|order_created|order_paid/.test(key)) return "order"
  if (/payment.*success|payment_attempt|payment/.test(key)) return "payment"
  if (/vm.*deploy|deployment|provision/.test(key)) return "vm_deployment"
  if (/signup|register/.test(key)) return "signup"
  return null
}

export async function POST(request: NextRequest) {
  try {
    // Check if database is configured
    if (!isDatabaseAvailable()) {
      // Silent success when database is not configured
      return NextResponse.json({ success: true, message: "Analytics disabled - no database" })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: true, message: "Analytics event ignored" })
    }
    const { event_type, event_name, properties = {} } = body
    const allowedEventTypes = new Set(["page_view", "custom", "interaction", "checkout", "payment", "auth"])

    if (!event_type || !event_name || !allowedEventTypes.has(String(event_type))) {
      return NextResponse.json(
        { error: "valid event_type and event_name are required" },
        { status: 400 }
      )
    }

    // Get request metadata
    const userAgent = truncateLargeString(request.headers.get("user-agent") || "") || ""
    const parsedUa = UAParser(userAgent)
    const referer = truncateLargeString(request.headers.get("referer") || "") || ""
    const context = await getRequestContext(request).catch(() => null)
    const ipHash = hashIp(truncateLargeString(context?.ip && context.ip !== "unknown" ? context.ip : null, 255))

    // Generate or get session ID from cookie
    const sessionId = request.cookies.get("zws_session_id")?.value || crypto.randomUUID()
    const pagePath = properties.page_path || new URL(referer || getAppUrl()).pathname
    const page = truncateLargeString(properties.page || properties.title || "", 255) || null
    const path = truncateLargeString(properties.path || pagePath, 2048) || "/"
    const pathUtm = extractUtmFromPath(pagePath)
    const referrerUtm = extractUtmFromPath(referer)
    const utmSource = truncateLargeString(properties.utm_source || properties.utmSource || pathUtm.utmSource || referrerUtm.utmSource || "", 120) || null
    const utmMedium = truncateLargeString(properties.utm_medium || properties.utmMedium || pathUtm.utmMedium || referrerUtm.utmMedium || "", 120) || null
    const trafficSource = normalizeTrafficSource({ utmSource, utmMedium, referrer: referer } as any)
    const crawler = detectCrawler(userAgent)
    const device = context?.deviceType || parsedUa.device.type || "desktop"
    const browser = context?.browser || parsedUa.browser.name || "Unknown"
    const os = context?.os || parsedUa.os.name || "Unknown"
    const country = truncateLargeString(properties.country || context?.country || "", 120) || null
    const city = truncateLargeString(properties.city || context?.city || "", 120) || null
    const userId = truncateLargeString(properties.user_id || properties.userId || "", 120) || null

    // Insert analytics event using Prisma
    const event = await prisma.analyticsEvent.create({
      data: {
        userId,
        eventType: event_type,
        eventName: event_name,
        page,
        path,
        pagePath,
        referrer: referer,
        utmSource,
        utmMedium,
        trafficSource,
        sessionId,
        device,
        browser,
        os,
        userAgent,
        ipAddress: null,
        ipHash,
        country,
        city,
        metadata: {
          ...properties,
          ip_hash: ipHash,
          user_agent: userAgent,
          request_context: context ? {
            geoSource: context.geoSource,
            country: context.country,
            city: context.city,
            region: context.region,
            timezone: context.timezone,
            asn: context.asn,
            provider: context.provider,
            proxy: context.proxy,
            vpn: context.vpn,
            tor: context.tor,
            relay: context.relay,
          } : null,
        },
        properties: {
          ...properties,
          utm_source: utmSource,
          utm_medium: utmMedium,
          traffic_source: trafficSource,
          crawler,
          timestamp: new Date().toISOString(),
        },
      },
    })

    await (prisma as any).analyticsSession.upsert({
      where: { sessionId },
      update: {
        userId,
        ipHash,
        userAgent,
        device,
        browser,
        os,
        country,
        city,
        referrer: referer,
        lastPath: path,
        lastSeenAt: new Date(),
      },
      create: {
        sessionId,
        userId,
        ipHash,
        userAgent,
        device,
        browser,
        os,
        country,
        city,
        referrer: referer,
        firstPath: path,
        lastPath: path,
      },
    })

    await (prisma as any).analyticsDevice.upsert({
      where: { sessionId },
      update: { userId, ipHash, userAgent, device, browser, os, country, city, lastSeenAt: new Date() },
      create: { sessionId, userId, ipHash, userAgent, device, browser, os, country, city },
    })

    if (event_type === "page_view") {
      await (prisma as any).analyticsPageView.create({
        data: {
          userId,
          sessionId,
          page,
          path,
          referrer: referer,
          trafficSource,
          utmSource,
          utmMedium,
          device,
          browser,
          os,
          country,
          city,
          metadata: { ...properties, crawler, proxy: context?.proxy || false, vpn: context?.vpn || false, tor: context?.tor || false, asn: context?.asn || null, provider: context?.provider || null },
        },
      })
    }

    const conversion = conversionType(event_type, event_name)
    if (conversion) {
      await (prisma as any).analyticsConversion.create({
        data: {
          userId,
          sessionId,
          eventId: event.id,
          conversionType: conversion,
          orderId: truncateLargeString(properties.order_id || properties.orderId || "", 120) || null,
          paymentId: truncateLargeString(properties.payment_id || properties.paymentId || "", 120) || null,
          vpsInstanceId: truncateLargeString(properties.vps_id || properties.vpsInstanceId || "", 120) || null,
          amount: properties.amount === undefined ? null : Number(properties.amount),
          currency: truncateLargeString(properties.currency || "", 12) || null,
          source: trafficSource,
          metadata: properties,
        },
      })
    }

    const response = NextResponse.json({ success: true })
    
    // Set session cookie if not exists
    if (!request.cookies.get("zws_session_id")) {
      response.cookies.set("zws_session_id", sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24,
      })
    }

    return response
  } catch (error) {
    console.error("Analytics tracking error:", error)
    // Silent fail - analytics should not break UX
    return NextResponse.json({ success: true })
  }
}
