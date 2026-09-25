"use client"

import { useEffect, useState } from "react"
import type React from "react"
import { AlertTriangle, Bot, FileSearch, Gauge, Search, TrendingUp } from "lucide-react"
import { readJsonResponse } from "@/lib/client/safe-json"

export default function SeoIntelligencePage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    fetch("/api/admin/seo-intelligence", { cache: "no-store" })
      .then(readJsonResponse)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load SEO intelligence"))
  }, [])
  if (error) return <div className="p-8 text-destructive">{error}</div>
  if (!data) return <div className="p-6 text-muted-foreground">Loading SEO intelligence...</div>
  const totals = data.searchConsole?.totals || {}
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">SEO Intelligence</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search visibility, crawler activity, indexing health, and SEO alerts.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric title="Indexed Pages" value={data.indexedPages || 0} icon={<FileSearch className="h-4 w-4" />} />
        <Metric title="Keywords" value={data.searchConsole?.keywords?.length || 0} icon={<Search className="h-4 w-4" />} />
        <Metric title="Clicks" value={totals.clicks || 0} icon={<TrendingUp className="h-4 w-4" />} />
        <Metric title="Impressions" value={totals.impressions || 0} icon={<Gauge className="h-4 w-4" />} />
        <Metric title="Crawl Errors" value={data.crawlErrors || 0} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Ranking Keywords" rows={data.searchConsole?.keywords || []} columns={["keyword", "clicks", "impressions", "ctr", "position"]} />
        <Table title="Top SEO Pages" rows={data.searchConsole?.topPages || data.seoPages || []} columns={data.searchConsole?.topPages?.length ? ["page", "clicks", "impressions", "ctr", "position"] : ["path", "title", "robots"]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Crawler Activity" icon={<Bot className="h-4 w-4" />}>{(data.crawlerCounts || []).map((row: any) => <Row key={row.name} label={row.name} value={row.count} />)}{!data.crawlerCounts?.length ? <p className="text-sm text-muted-foreground">No crawler hits recorded today</p> : null}</Panel>
        <Panel title="Core Web Vitals" icon={<Gauge className="h-4 w-4" />}><Row label="Status" value={data.coreWebVitals?.status || "not configured"} /><Row label="LCP" value={data.coreWebVitals?.lcp || "-"} /><Row label="INP" value={data.coreWebVitals?.inp || "-"} /><Row label="CLS" value={data.coreWebVitals?.cls || "-"} /></Panel>
        <Panel title="SEO Alerts" icon={<AlertTriangle className="h-4 w-4" />}>{(data.alerts || []).map((alert: any) => <p key={alert.type} className="rounded-md border border-border/40 p-2 text-sm text-muted-foreground">{alert.message}</p>)}{!data.alerts?.length ? <p className="text-sm text-muted-foreground">No active alerts</p> : null}</Panel>
      </div>
    </div>
  )
}

function Metric({ title, value, icon }: { title: string; value: string | number; icon: React.ReactNode }) {
  return <div className="glass rounded-lg p-4"><div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{title}</span>{icon}</div><div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div></div>
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="glass rounded-lg p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2><div className="space-y-2">{children}</div></div>
}

function Row({ label, value }: { label: string; value: unknown }) {
  return <div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate text-muted-foreground">{label}</span><span className="font-medium">{String(value)}</span></div>
}

function Table({ title, rows, columns }: { title: string; rows: any[]; columns: string[] }) {
  return <div className="glass overflow-hidden rounded-lg p-4"><h2 className="mb-3 text-sm font-semibold">{title}</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{columns.map((column) => <th key={column} className="border-b border-border/40 py-2 text-left capitalize text-muted-foreground">{column}</th>)}</tr></thead><tbody>{rows.length ? rows.slice(0, 12).map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className="max-w-[260px] truncate border-b border-border/20 py-2">{String(row[column] ?? "")}</td>)}</tr>) : <tr><td colSpan={columns.length} className="py-6 text-center text-muted-foreground">No data</td></tr>}</tbody></table></div></div>
}
