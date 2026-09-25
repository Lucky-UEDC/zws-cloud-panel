import { AdminDashboardStats } from "@/components/admin/admin-dashboard-stats"
import { AdminRecentActivity } from "@/components/admin/admin-recent-activity"
import { AdminQuickActions } from "@/components/admin/admin-quick-actions"
import { getAdminDashboardData } from "@/lib/admin-dashboard"
import { getSetting, type PlatformSettings } from "@/lib/settings"

export default async function AdminDashboardPage() {
  const [data, platform] = await Promise.all([
    getAdminDashboardData(),
    getSetting<PlatformSettings>("platform_settings").catch(() => null),
  ])

  return (
    <div className="min-w-0 max-w-full space-y-8 overflow-x-hidden">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <span className="rounded-full border border-border/40 bg-background/60 px-3 py-1 text-xs font-medium uppercase tracking-wide">
            {platform?.environmentMode === "production" ? "PRODUCTION" : "TEST"}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground">
          Welcome back. Here&apos;s an overview of your {platform?.appName || "cloud"} business.
        </p>
      </div>

      <AdminDashboardStats stats={data.stats} />

      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <AdminRecentActivity
          orders={data.recentOrders}
          payments={data.recentPayments}
          events={data.analyticsEvents}
        />
        <AdminQuickActions />
      </div>
    </div>
  )
}
