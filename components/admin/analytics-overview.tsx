"use client"

import { Activity, Eye, Calendar, Clock, MousePointerClick, CreditCard, Server, Users } from "lucide-react"
import { formatCurrency } from "@/lib/currency-format"

interface AnalyticsEvent {
  id: string
  eventType: string
  eventName: string
  pagePath: string | null
  createdAt: string
  properties: Record<string, unknown>
  trafficSource?: string | null
  utmSource?: string | null
  utmMedium?: string | null
}

interface AnalyticsData {
  range: string
  rangeLabel: string
  stats: {
    total: number
    today: number
    week: number
    activeUsers?: number
    signups?: number
    conversions?: number
    orders?: number
    paymentSuccessRate?: number
    vmDeploymentSuccess?: number
    revenue?: number
    revenueInrEquivalent?: number
    revenueByCurrency?: Array<{ currency: string; amount: number }>
  }
  recentEvents: AnalyticsEvent[]
  topPages: Array<{ path: string; count: number }>
  eventDistribution: Array<{ type: string; count: number }>
  trafficSources: Array<{ source: string; count: number }>
  deviceStats?: Array<{ name: string; count: number }>
  browserStats?: Array<{ name: string; count: number }>
  countryStats?: Array<{ name: string; count: number }>
}

export function AnalyticsOverview({ data }: { data: AnalyticsData }) {
  function formatTime(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleString("en-IN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getEventTypeColor(type: string) {
    switch (type) {
      case "page_view":
        return "text-blue-400 bg-blue-400/10"
      case "interaction":
        return "text-cyan-400 bg-cyan-400/10"
      case "auth":
        return "text-amber-400 bg-amber-400/10"
      case "payment":
        return "text-[var(--text-selected)] bg-[var(--accent-subtle)]"
      default:
        return "text-muted-foreground bg-muted/30"
    }
  }

  const statItems = [
    {
      label: "Total Events",
      value: data.stats.total.toLocaleString(),
      icon: Activity,
      color: "text-accent",
      bgColor: "bg-[var(--accent-subtle)]",
    },
    {
      label: "Today",
      value: data.stats.today.toLocaleString(),
      icon: Calendar,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
    },
    {
      label: "This Week",
      value: data.stats.week.toLocaleString(),
      icon: Clock,
      color: "text-blue-400",
      bgColor: "bg-blue-400/10",
    },
    {
      label: "Active Users",
      value: (data.stats.activeUsers || 0).toLocaleString(),
      icon: Users,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
    },
    {
      label: "Orders",
      value: (data.stats.orders || 0).toLocaleString(),
      icon: CreditCard,
      color: "text-violet-400",
      bgColor: "bg-violet-400/10",
    },
    {
      label: "Sales INR",
      value: formatCurrency(data.stats.revenueInrEquivalent || data.stats.revenue || 0, "INR"),
      icon: CreditCard,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
    },
    {
      label: "VM Success",
      value: `${data.stats.vmDeploymentSuccess || 0}%`,
      icon: Server,
      color: "text-cyan-400",
      bgColor: "bg-cyan-400/10",
    },
  ]

  return (
    <div className="min-w-0 max-w-full space-y-8 overflow-x-hidden">
      {/* Stats cards */}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-7">
        {statItems.map((item) => (
          <div
            key={item.label}
            className="glass min-w-0 rounded-xl p-5 transition-all hover:scale-[1.02]"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="min-w-0 truncate text-sm text-muted-foreground">{item.label}</span>
              <div className={`rounded-lg p-2 ${item.bgColor}`}>
                <item.icon className={`h-4 w-4 ${item.color}`} />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <MiniBreakdown title="Devices" rows={data.deviceStats || []} />
        <MiniBreakdown title="Browsers" rows={data.browserStats || []} />
        <MiniBreakdown title="Countries" rows={data.countryStats || []} />
      </div>

      <div className="grid min-w-0 gap-8 lg:grid-cols-2">
        <div className="glass min-w-0 rounded-xl p-5">
          <div className="mb-4 flex items-center gap-2">
            <MousePointerClick className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Traffic Sources</h2>
          </div>
          <div className="space-y-3">
            {data.trafficSources.map((item) => {
              const total = data.trafficSources.reduce((sum, source) => sum + source.count, 0)
              const percentage = total > 0 ? (item.count / total) * 100 : 0
              return (
                <div key={item.source}>
                  <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">{item.source}</span>
                    <span className="text-sm text-muted-foreground">{item.count.toLocaleString()} ({percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/20"><div className="h-full rounded-full bg-accent/80" style={{ width: `${percentage}%` }} /></div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Pages */}
        <div className="glass min-w-0 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Top Pages</h2>
          </div>
          <div className="space-y-2">
            {data.topPages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No page views recorded yet
              </p>
            ) : (
              data.topPages.map((page, index) => (
                <div
                  key={page.path}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/20 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/30 text-xs font-medium">
                      {index + 1}
                    </span>
                    <span className="min-w-0 max-w-[200px] truncate font-mono text-sm">
                      {page.path}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {page.count.toLocaleString()} views
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Event Distribution */}
        <div className="glass min-w-0 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <MousePointerClick className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold">Event Types</h2>
          </div>
          <div className="space-y-3">
            {data.eventDistribution.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No events recorded yet
              </p>
            ) : (
              data.eventDistribution.map((item) => {
                const total = data.eventDistribution.reduce((sum, e) => sum + e.count, 0)
                const percentage = total > 0 ? (item.count / total) * 100 : 0

                return (
                  <div key={item.type}>
                    <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm capitalize">{item.type.replace(/_/g, " ")}</span>
                      <span className="text-sm text-muted-foreground">
                        {item.count.toLocaleString()} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted/20">
                      <div
                        className="h-full rounded-full bg-accent/80 transition-[width] duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Recent Events */}
      <div className="glass min-w-0 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Recent Events</h2>
        </div>
        <div className="max-w-full overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border/40">
                <th className="w-[88px] pb-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="pb-3 text-left font-medium text-muted-foreground">Event</th>
                <th className="hidden pb-3 text-left font-medium text-muted-foreground sm:table-cell">Page</th>
                <th className="w-[112px] pb-3 text-right font-medium text-muted-foreground">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground">
                    No events recorded yet
                  </td>
                </tr>
              ) : (
                data.recentEvents.map((event) => (
                  <tr key={event.id} className="border-b border-border/20">
                    <td className="py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] uppercase ${getEventTypeColor(
                          event.eventType
                        )}`}
                      >
                        {event.eventType}
                      </span>
                    </td>
                    <td className="min-w-0 truncate py-3 pr-3 font-medium">
                      {event.eventName.replace(/_/g, " ")}
                    </td>
                    <td className="hidden min-w-0 truncate py-3 pr-3 font-mono text-xs text-muted-foreground sm:table-cell">
                      {event.pagePath || "-"}
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {formatTime(event.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MiniBreakdown({ title, rows }: { title: string; rows: Array<{ name: string; count: number }> }) {
  return (
    <div className="glass min-w-0 rounded-xl p-5">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="space-y-2">
        {rows.length ? rows.slice(0, 5).map((row) => (
          <div key={row.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-muted-foreground">{row.name}</span>
            <span className="font-medium tabular-nums">{row.count.toLocaleString()}</span>
          </div>
        )) : <p className="text-sm text-muted-foreground">No data</p>}
      </div>
    </div>
  )
}
