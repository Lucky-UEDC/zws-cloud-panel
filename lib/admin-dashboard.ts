import { prisma } from "@/lib/db"
import { activeServiceWhere, getActiveBillableOrderCount, getDashboardRevenueTotal } from "@/lib/revenue-analytics"
import { cachedJson } from "@/lib/runtime-cache"
import { safeJson } from "@/lib/safe-json"

export type AdminDashboardData = {
  stats: {
    customers: number
    products: number
    orders: number
    payments: number
    revenue: number
    openTickets: number
    vms: number
    activeVms: number
    computeNodes: number
    ipPools: number
  }
  recentOrders: any[]
  recentPayments: any[]
  analyticsEvents: any[]
}

function value<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback
}

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  return cachedJson("admin:dashboard:v2", 20, async () => safeJson(await loadAdminDashboardData()))
}

async function loadAdminDashboardData(): Promise<AdminDashboardData> {
  const results = await Promise.allSettled([
    prisma.customer.count(),
    prisma.product.count({ where: { isActive: true } }),
    getActiveBillableOrderCount(),
    prisma.payment.count({ where: { status: "completed" } }),
    getDashboardRevenueTotal(),
    prisma.supportTicket.count({ where: { status: { not: "closed" } } }),
    prisma.vpsInstance.count(),
    prisma.vpsInstance.count({ where: activeServiceWhere() }).catch(() => 0),
    (prisma as any).proxmoxNode?.count?.().catch(() => 0) ?? Promise.resolve(0),
    (prisma as any).ipPool?.count?.().catch(() => 0) ?? Promise.resolve(0),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.analyticsEvent.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ])

  return {
    stats: {
      customers: value(results[0], 0),
      products: value(results[1], 0),
      orders: value(results[2], 0),
      payments: value(results[3], 0),
      revenue: value(results[4], 0),
      openTickets: value(results[5], 0),
      vms: value(results[6], 0),
      activeVms: value(results[7], 0),
      computeNodes: value(results[8], 0),
      ipPools: value(results[9], 0),
    },
    recentOrders: value(results[10], []),
    recentPayments: value(results[11], []),
    analyticsEvents: value(results[12], []),
  }
}
