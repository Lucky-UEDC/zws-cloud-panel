"use client"

import { useEffect, useMemo, useState } from "react"
import type React from "react"
import { Activity, BarChart3, Globe2, MonitorSmartphone, MousePointerClick, ShoppingCart, TrendingUp, Users } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { readJsonResponse } from "@/lib/client/safe-json"
import { AnalyticsSkeleton } from "@/components/skeletons"

const RANGE_OPTIONS = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["365d", "365 days"], ["lifetime", "Lifetime"]]

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<any>(null)
  const [realtime, setRealtime] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [range, setRange] = useState("today")

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/admin/analytics?range=${encodeURIComponent(range)}`, { cache: "no-store" })
      .then(readJsonResponse)
      .then((payload) => { if (alive) setData(payload) })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Failed to load analytics") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range])

  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const res = await fetch("/api/admin/analytics/realtime", { cache: "no-store" })
        const payload = await readJsonResponse<any>(res)
        if (alive) setRealtime(payload)
      } catch {}
    }
    tick()
    const id = window.setInterval(tick, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const stats = data?.stats || {}
  const live = realtime || data?.liveUsers || {}
  const chartRows = useMemo(() => data?.charts?.traffic?.length ? data.charts.traffic : [{ date: "No data", traffic: 0, conversions: 0, revenue: 0, sales: 0 }], [data])

  if (loading) return <AnalyticsSkeleton />
  if (error || !data) return <div className="p-8 text-destructive">Error: {error || "Failed to load analytics"}</div>

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Realtime traffic, attribution, conversions, and revenue intelligence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setRange(value)} className={`rounded-md border px-3 py-1.5 text-sm ${range === value ? "border-primary bg-primary text-primary-foreground" : "border-border/40 bg-background hover:bg-muted/30"}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <Metric title="Live Users" value={live.activeUsers || 0} icon={<Users className="h-4 w-4" />} />
        <Metric title="Traffic Today" value={stats.today || 0} icon={<Activity className="h-4 w-4" />} />
        <Metric title="Orders Today" value={stats.orders || 0} icon={<ShoppingCart className="h-4 w-4" />} />
        <Metric title="Conversion Rate" value={`${stats.conversionRate || 0}%`} icon={<TrendingUp className="h-4 w-4" />} />
        <Metric title="Bounce Rate" value={`${stats.bounceRate || 0}%`} icon={<MousePointerClick className="h-4 w-4" />} />
        <Metric title="Revenue" value={`₹${Number(stats.revenue || 0).toLocaleString("en-IN")}`} icon={<BarChart3 className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Traffic">
          <ResponsiveContainer width="100%" height={240}><AreaChart data={chartRows}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="traffic" stroke="#22c55e" fill="#22c55e33" /></AreaChart></ResponsiveContainer>
        </Panel>
        <Panel title="Conversions">
          <ResponsiveContainer width="100%" height={240}><BarChart data={chartRows}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="conversions" fill="#38bdf8" /></BarChart></ResponsiveContainer>
        </Panel>
        <Panel title="Sales">
          <ResponsiveContainer width="100%" height={240}><AreaChart data={chartRows}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="revenue" stroke="#f59e0b" fill="#f59e0b33" /></AreaChart></ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Breakdown title="Top Countries" icon={<Globe2 className="h-4 w-4" />} rows={realtime?.countries || data.countryStats || []} />
        <Breakdown title="Top Devices" icon={<MonitorSmartphone className="h-4 w-4" />} rows={realtime?.devices || data.deviceStats || []} />
        <Breakdown title="Top Browsers" icon={<MousePointerClick className="h-4 w-4" />} rows={realtime?.browsers || data.browserStats || []} />
        <Breakdown title="Top Landing Pages" icon={<Activity className="h-4 w-4" />} rows={data.topPages || []} labelKey="path" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Breakdown title="Traffic Sources" rows={data.trafficSources || []} labelKey="source" />
        <Breakdown title="Top Referrers" rows={(data.referrers || []).map((row: any) => ({ name: row.referrer, count: row.count }))} />
      </div>
    </div>
  )
}

function Metric({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) {
  return <div className="glass rounded-lg p-4"><div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{title}</span>{icon}</div><div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div></div>
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="glass rounded-lg p-4"><h2 className="mb-3 text-sm font-semibold">{title}</h2>{children}</div>
}

function Breakdown({ title, rows, icon, labelKey = "name" }: { title: string; rows: any[]; icon?: React.ReactNode; labelKey?: string }) {
  return <div className="glass rounded-lg p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold">{icon}{title}</div><div className="space-y-2">{rows.length ? rows.slice(0, 8).map((row) => <div key={`${row[labelKey] || row.name}-${row.count}`} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate text-muted-foreground">{row[labelKey] || row.name || "Unknown"}</span><span className="font-medium tabular-nums">{Number(row.count || 0).toLocaleString()}</span></div>) : <p className="text-sm text-muted-foreground">No data yet</p>}</div></div>
}
