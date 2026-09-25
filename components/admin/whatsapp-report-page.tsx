"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { BarChart3, ChevronDown, FileJson, Inbox, Plus, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

export function WhatsAppReportPage({ title, description, endpoint, dataKey }: { title: string; description: string; endpoint: string; dataKey?: string }) {
  const [data, setData] = useState<any>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let delay = 5000
    let timer: number

    async function load() {
      if (!mounted) return
      setLoading(true)
      try {
        const prevData = data
        const response = await fetch(endpoint, { cache: "no-store" })
        const next = await readJsonResponse<any>(response)
        if (mounted && response.ok) {
          const changed = JSON.stringify(next) !== JSON.stringify(prevData)
          setData(next)
          delay = changed ? 5000 : Math.min(delay * 1.5, 30000)
        }
      } catch {
        delay = Math.min(delay * 2, 30000)
      } finally {
        if (mounted) setLoading(false)
      }
      if (mounted) timer = window.setTimeout(() => void load(), delay)
    }

    void load()
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint])

  const items = dataKey ? data?.[dataKey] : null
  const summary = getSummaryMetrics(data)
  const sections = getReadableSections(data, dataKey)

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setShowRaw((value) => !value)}>
          <FileJson className="h-4 w-4" />
          {showRaw ? "Hide Raw Logs" : "Show Raw Logs"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", showRaw ? "rotate-180" : "rotate-0")} />
        </Button>
      </div>

      {Array.isArray(items) ? (
        items.length ? <RecordGrid items={items} /> : <ReportEmptyState title={title} description={description} />
      ) : (
        <div className="space-y-6">
          {loading && !data ? <LoadingCard /> : null}
          {summary.length ? <SummaryGrid metrics={summary} /> : null}
          {sections.length ? <ReadableSections sections={sections} /> : !loading ? <ReportEmptyState title={title} description={description} /> : null}
        </div>
      )}

      {showRaw ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" />Raw Logs</CardTitle></CardHeader>
          <CardContent>
            <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">{JSON.stringify(data || { loading }, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ReportEmptyState({ title, description }: { title: string; description: string }) {
  const label = title.toLowerCase()
  const cta = getCta(title)
  return (
    <Empty className="glass border border-dashed border-border/50 bg-background/40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>No {label} yet</EmptyTitle>
        <EmptyDescription>{emptyCopy(title, description)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link href={cta.href} className="gap-2"><Plus className="h-4 w-4" />{cta.label}</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading report...
      </CardContent>
    </Card>
  )
}

function RecordGrid({ items }: { items: any[] }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      {items.map((item: any) => (
        <Card key={item.id || item.name || JSON.stringify(item).slice(0, 40)}>
          <CardHeader><CardTitle className="truncate text-base">{item.name || item.event || item.status || item.id || "Record"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {item.status ? <Badge>{String(item.status)}</Badge> : null}
              {item.category ? <Badge variant="outline">{String(item.category)}</Badge> : null}
              {item.type ? <Badge variant="outline">{String(item.type)}</Badge> : null}
            </div>
            <KeyValueList data={item} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function SummaryGrid({ metrics }: { metrics: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.slice(0, 5).map((metric) => (
        <Card key={metric.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-medium uppercase text-muted-foreground">{humanize(metric.label)}</p>
              <BarChart3 className="h-4 w-4 shrink-0 text-accent" />
            </div>
            <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{metric.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ReadableSections({ sections }: { sections: Array<{ label: string; value: any }> }) {
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
      {sections.map((section) => (
        <Card key={section.label}>
          <CardHeader><CardTitle className="text-base">{humanize(section.label)}</CardTitle></CardHeader>
          <CardContent>
            {Array.isArray(section.value) ? (
              section.value.length ? <div className="space-y-3">{section.value.slice(0, 8).map((row, index) => <ReadableRow key={row?.id || `${section.label}-${index}`} row={row} />)}</div> : <p className="text-sm text-muted-foreground">No records.</p>
            ) : (
              <KeyValueList data={section.value} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ReadableRow({ row }: { row: any }) {
  if (!row || typeof row !== "object") return <p className="rounded-lg border border-border/40 p-3 text-sm">{String(row)}</p>
  return (
    <div className="rounded-lg border border-border/40 p-3 text-sm">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{row.name || row.event || row.status || row.id || "Record"}</p>
        {row.status || row.level ? <Badge variant="outline">{String(row.status || row.level)}</Badge> : null}
      </div>
      <KeyValueList data={row} compact />
    </div>
  )
}

function KeyValueList({ data, compact = false }: { data: any; compact?: boolean }) {
  const entries = Object.entries(data || {}).filter(([, value]) => value == null || typeof value !== "object").slice(0, compact ? 5 : 8)
  if (!entries.length) return <p className="text-sm text-muted-foreground">No readable fields.</p>
  return (
    <div className={cn("grid min-w-0 gap-2 text-sm", compact ? "mt-2" : "")}>
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 justify-between gap-3 border-b border-border/30 py-1.5 last:border-0">
          <span className="shrink-0 text-muted-foreground">{humanize(key)}</span>
          <span className="min-w-0 truncate text-right">{formatValue(value)}</span>
        </div>
      ))}
    </div>
  )
}

function getSummaryMetrics(data: any) {
  if (!data || typeof data !== "object") return []
  const candidates: Array<{ label: string; value: string | number }> = []
  function visit(prefix: string, value: any) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "number" || typeof child === "boolean") candidates.push({ label: prefix ? `${prefix} ${key}` : key, value: formatValue(child) })
    }
  }
  visit("", data)
  for (const [key, value] of Object.entries(data)) visit(key, value)
  return candidates
}

function getReadableSections(data: any, dataKey?: string) {
  if (!data || typeof data !== "object") return []
  return Object.entries(data)
    .filter(([key, value]) => key !== dataKey && value && typeof value === "object")
    .slice(0, 6)
    .map(([label, value]) => ({ label, value }))
}

function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatValue(value: any) {
  if (value == null || value === "") return "-"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return value.toLocaleString()
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString()
  return String(value)
}

function emptyCopy(title: string, fallback: string) {
  if (title === "Automation Flows") return "Create onboarding and OTP automation journeys for your users."
  if (title === "Broadcast Audiences") return "Build reusable consent-aware recipient segments for campaigns and lifecycle messages."
  if (title === "WhatsApp Queue Health") return "Queue status will appear here once WhatsApp jobs are available."
  return fallback
}

function getCta(title: string) {
  if (title === "Automation Flows") return { label: "Create Flow", href: "/admin/whatsapp/automation-flows" }
  if (title === "Broadcast Audiences") return { label: "Create Audience", href: "/admin/whatsapp/broadcast-audiences" }
  if (title.includes("Campaign")) return { label: "Create Campaign", href: "/admin/whatsapp/campaigns" }
  return { label: "Open WhatsApp", href: "/admin/whatsapp" }
}
