import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getAdminFromCookies } from "@/lib/server-auth"
import { canAccessAdminApi } from "@/lib/admin-rbac"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const admin = await getAdminFromCookies()
  if (!admin?.email || !canAccessAdminApi(admin.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const since = new Date(Date.now() - 5 * 60 * 1000)
  const oneMinute = new Date(Date.now() - 60 * 1000)
  const [activeUsers, usersPerMinute, recentEvents, topPages, sessions] = await Promise.all([
    (prisma as any).analyticsSession.count({ where: { lastSeenAt: { gte: since } } }).catch(() => 0),
    (prisma as any).analyticsSession.count({ where: { lastSeenAt: { gte: oneMinute } } }).catch(() => 0),
    prisma.analyticsEvent.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 25 }).catch(() => []),
    (prisma as any).analyticsPageView.findMany({ where: { createdAt: { gte: since } }, select: { path: true } }).catch(() => []),
    (prisma as any).analyticsSession.findMany({ where: { lastSeenAt: { gte: since } }, select: { country: true, device: true, browser: true, lastPath: true } }).catch(() => []),
  ])

  const pageCounts = topPages.reduce((acc: Record<string, number>, row: any) => {
    const path = row.path || "/"
    acc[path] = (acc[path] || 0) + 1
    return acc
  }, {})

  const countBy = (key: string) => Object.entries(sessions.reduce((acc: Record<string, number>, row: any) => {
    const value = row?.[key] || "Unknown"
    acc[value] = (acc[value] || 0) + 1
    return acc
  }, {})).map(([name, count]) => ({ name, count })).sort((a: any, b: any) => b.count - a.count)

  return NextResponse.json({
    activeUsers,
    usersPerMinute,
    liveSessions: activeUsers,
    countries: countBy("country"),
    devices: countBy("device"),
    browsers: countBy("browser"),
    recentEvents,
    topPages: Object.entries(pageCounts).map(([path, count]) => ({ path, count })).sort((a: any, b: any) => b.count - a.count),
    at: new Date().toISOString(),
  })
}
