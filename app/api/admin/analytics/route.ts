import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getAdminFromCookies } from '@/lib/server-auth'
import { activeBillableOrderWhere, paidServiceInvoiceWhere } from "@/lib/revenue-analytics"

function rangeWindow(range: string) {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === "yesterday") {
    const start = new Date(startOfToday)
    start.setDate(start.getDate() - 1)
    return { start, end: startOfToday, label: "Yesterday" }
  }
  if (range === "7d") return { start: new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000), end: null, label: "7 days" }
  if (range === "30d") return { start: new Date(startOfToday.getTime() - 29 * 24 * 60 * 60 * 1000), end: null, label: "30 days" }
  if (range === "365d") return { start: new Date(startOfToday.getTime() - 364 * 24 * 60 * 60 * 1000), end: null, label: "365 days" }
  if (range === "lifetime") return { start: null, end: null, label: "Lifetime" }
  return { start: startOfToday, end: null, label: "Today" }
}

function createdAtWhere(start: Date | null, end: Date | null) {
  if (!start && !end) return {}
  return { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
}

export async function GET(request: NextRequest) {
  const admin = await getAdminFromCookies()
  if (!admin?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const requestedRange = request.nextUrl.searchParams.get("range") || "today"
    const range = ["today", "yesterday", "7d", "30d", "365d", "lifetime"].includes(requestedRange) ? requestedRange : "today"
    const window = rangeWindow(range)
    const where = createdAtWhere(window.start, window.end)
    const today = rangeWindow("today")
    const week = rangeWindow("7d")

    // Fetch analytics data
    const [totalEvents, todayEvents, weekEvents, recentEvents, pageViews, eventsByType, trafficEvents, activeUsers, signups, conversions, orders, paymentAttempts, paymentSuccess, vmDeployments, devices, revenueRows, allPageViews] = await Promise.all([
      prisma.analyticsEvent.count({ where }),
      prisma.analyticsEvent.count({
        where: createdAtWhere(today.start, today.end),
      }),
      prisma.analyticsEvent.count({
        where: createdAtWhere(week.start, week.end),
      }),
      prisma.analyticsEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.analyticsEvent.findMany({
        where: {
          eventType: 'page_view',
          ...where,
        },
        select: { pagePath: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.analyticsEvent.findMany({
        where,
        select: { eventType: true, eventName: true },
      }),
      prisma.analyticsEvent.findMany({
        where,
        select: { trafficSource: true },
      }),
      (prisma as any).analyticsSession.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }).catch(() => 0),
      prisma.customer.count({ where: createdAtWhere(window.start, window.end) }).catch(() => 0),
      (prisma as any).analyticsConversion.count({ where }).catch(() => 0),
      prisma.order.count({ where: activeBillableOrderWhere(where) }).catch(() => 0),
      prisma.paymentAttempt.count({ where }).catch(() => 0),
      prisma.paymentAttempt.count({ where: { ...where, status: { in: ["success", "paid", "completed"] } as any } }).catch(() => 0),
      prisma.provisioningJob.count({ where: { ...where, status: "completed" } }).catch(() => 0),
      (prisma as any).analyticsDevice.findMany({ select: { device: true, browser: true, os: true, country: true } }).catch(() => []),
      prisma.invoice.findMany({ where: paidServiceInvoiceWhere({ start: window.start, end: window.end, field: "createdAt" }), select: { totalAmount: true, currency: true, createdAt: true } }).catch(() => []),
      (prisma as any).analyticsPageView.findMany({ where, select: { sessionId: true, path: true, referrer: true } }).catch(() => []),
    ])

    // Calculate top pages
    const pageViewCounts: Record<string, number> = {}
    pageViews.forEach((pv) => {
      if (pv.pagePath) {
        pageViewCounts[pv.pagePath] = (pageViewCounts[pv.pagePath] || 0) + 1
      }
    })
    const topPages = Object.entries(pageViewCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }))

    // Calculate event type distribution
    const eventTypeCounts: Record<string, number> = {}
    eventsByType.forEach((e) => {
      eventTypeCounts[e.eventType] = (eventTypeCounts[e.eventType] || 0) + 1
    })
    const eventDistribution = Object.entries(eventTypeCounts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
    const sourceCounts: Record<string, number> = { Facebook: 0, WhatsApp: 0, Google: 0, Direct: 0, Referral: 0 }
    const trafficSources = trafficEvents
      .reduce<Record<string, number>>((acc, event) => {
        const source = event.trafficSource || "Direct"
        acc[source] = (acc[source] || 0) + 1
        return acc
      }, sourceCounts)
    const countBy = (key: string) => Object.entries(devices.reduce((acc: Record<string, number>, row: any) => {
      const value = row?.[key] || "Unknown"
      acc[value] = (acc[value] || 0) + 1
      return acc
    }, {})).map(([name, count]) => ({ name, count })).sort((a: any, b: any) => b.count - a.count).slice(0, 10)
    const paymentSuccessRate = paymentAttempts > 0 ? Number(((paymentSuccess / paymentAttempts) * 100).toFixed(1)) : 0
    const vmDeploymentSuccess = orders > 0 ? Number(((vmDeployments / orders) * 100).toFixed(1)) : 0
    const revenueInrEquivalent = Number((revenueRows as any[]).reduce((sum, row) => sum + Number(row.totalAmount || 0), 0).toFixed(2))
    const revenue = revenueInrEquivalent
    const conversionRate = totalEvents > 0 ? Number(((orders / totalEvents) * 100).toFixed(2)) : 0
    const pageViewsBySession = allPageViews.reduce((acc: Record<string, number>, row: any) => {
      if (row.sessionId) acc[row.sessionId] = (acc[row.sessionId] || 0) + 1
      return acc
    }, {})
    const bounceSessions = Object.values(pageViewsBySession).filter((count: any) => Number(count) <= 1).length
    const bounceRate = Object.keys(pageViewsBySession).length ? Number(((bounceSessions / Object.keys(pageViewsBySession).length) * 100).toFixed(1)) : 0
    const referrers = Object.entries(allPageViews.reduce((acc: Record<string, number>, row: any) => {
      const referrer = row.referrer || "Direct"
      acc[referrer] = (acc[referrer] || 0) + 1
      return acc
    }, {})).map(([referrer, count]) => ({ referrer, count })).sort((a: any, b: any) => b.count - a.count).slice(0, 10)
    const days: Record<string, { date: string; traffic: number; conversions: number; revenue: number; sales: number }> = {}
    for (const event of recentEvents.concat(pageViews as any)) {
      const date = new Date(event.createdAt).toISOString().slice(0, 10)
      days[date] ||= { date, traffic: 0, conversions: 0, revenue: 0, sales: 0 }
      days[date].traffic += 1
    }
    for (const row of revenueRows as any[]) {
      const date = new Date(row.createdAt).toISOString().slice(0, 10)
      days[date] ||= { date, traffic: 0, conversions: 0, revenue: 0, sales: 0 }
      days[date].revenue += Number(row.totalAmount || 0)
      days[date].sales += 1
      days[date].conversions += 1
    }

    return NextResponse.json({
      range,
      rangeLabel: window.label,
      stats: {
        total: totalEvents,
        today: todayEvents,
        week: weekEvents,
        activeUsers,
        signups,
        conversions,
        orders,
        revenue,
        revenueInrEquivalent,
        revenueByCurrency: [{ currency: "INR", amount: revenueInrEquivalent }],
        conversionRate,
        bounceRate,
        paymentSuccessRate,
        vmDeploymentSuccess,
      },
      recentEvents,
      topPages,
      eventDistribution,
      trafficSources: Object.entries(trafficSources).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      realtimeVisitors: activeUsers,
      deviceStats: countBy("device"),
      browserStats: countBy("browser"),
      osStats: countBy("os"),
      countryStats: countBy("country"),
      referrers,
      liveUsers: {
        activeUsers,
        liveSessions: activeUsers,
        usersPerMinute: recentEvents.filter((event) => new Date(event.createdAt).getTime() >= Date.now() - 60_000).length,
      },
      charts: {
        traffic: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
        conversion: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
        sales: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
        countries: countBy("country"),
        devices: countBy("device"),
      },
    })
  } catch (error) {
    console.error('Analytics API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics data' },
      { status: 500 }
    )
  }
}
