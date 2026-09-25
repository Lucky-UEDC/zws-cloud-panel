import { NextResponse } from "next/server"
import { canManageCms, canManageSettings } from "@/lib/admin-rbac"
import { getAdminFromCookies } from "@/lib/server-auth"
import { prisma } from "@/lib/db"
import { getSearchConsoleSummary } from "@/lib/search-console"
import { NO_CACHE_HEADERS } from "@/lib/http-cache"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || (!canManageCms(admin.role) && !canManageSettings(admin.role))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [seoPages, crawlEvents, errors404, searchConsole] = await Promise.all([
    (prisma as any).seoPage.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }).catch(() => []),
    (prisma as any).analyticsEvent.findMany({
      where: { createdAt: { gte: since }, OR: [
        { userAgent: { contains: "googlebot", mode: "insensitive" } },
        { userAgent: { contains: "bingbot", mode: "insensitive" } },
        { userAgent: { contains: "facebookexternalhit", mode: "insensitive" } },
        { userAgent: { contains: "twitterbot", mode: "insensitive" } },
      ] },
      select: { userAgent: true, path: true, createdAt: true },
      take: 200,
    }).catch(() => []),
    (prisma as any).analyticsEvent.count({ where: { createdAt: { gte: since }, eventName: { contains: "404" } } }).catch(() => 0),
    getSearchConsoleSummary().catch((error) => ({ configured: false, error: error instanceof Error ? error.message : "Search Console unavailable", keywords: [], topPages: [], totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 } })),
  ])
  const crawlerCounts = crawlEvents.reduce((acc: Record<string, number>, row: any) => {
    const ua = String(row.userAgent || "").toLowerCase()
    const key = ua.includes("googlebot") ? "googlebot" : ua.includes("bingbot") ? "bingbot" : ua.includes("facebook") ? "facebook crawler" : ua.includes("twitterbot") ? "twitter crawler" : "search.google.com"
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const alerts = [
    ...(errors404 > 10 ? [{ type: "404_spike", severity: "warning", message: `${errors404} 404-like events in the last 24 hours` }] : []),
    ...(!searchConsole.configured ? [{ type: "search_console_missing", severity: "info", message: "Search Console credentials are not configured" }] : []),
  ]
  return NextResponse.json({
    indexedPages: seoPages.filter((page: any) => !String(page.robots || "").includes("noindex")).length,
    seoPages: seoPages.slice(0, 20),
    crawlerCounts: Object.entries(crawlerCounts).map(([name, count]) => ({ name, count })),
    crawlErrors: errors404,
    coreWebVitals: { status: "not_configured", lcp: null, inp: null, cls: null },
    searchConsole,
    alerts,
  }, { headers: NO_CACHE_HEADERS })
}
