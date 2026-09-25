"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, FileJson, Inbox, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

export default function WhatsAppDeliveryReportsPage() {
  const [filters, setFilters] = useState({ search: "", status: "", campaignId: "", customerId: "" })
  const [data, setData] = useState<any>({ messageLogs: [] })
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)

  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "100" })
    for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim())
    return params.toString()
  }, [filters])

  const load = useCallback(async () => {
    setLoading(true)
    const response = await fetch(`/api/admin/whatsapp/logs?${query}`, { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }, [query])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => window.clearInterval(timer)
  }, [load])

  const rows = [...(data.messageLogs || []), ...(data.logs || []).filter((row: any) => row.event || row.status)].slice(0, 100)

  function update(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">WhatsApp Delivery Reports</h1>
          <p className="text-sm text-muted-foreground">Delivery, read, retry, and failure records across campaigns and customer messages.</p>
        </div>
        <Button asChild variant="outline" size="sm"><Link href="/admin/whatsapp/campaigns">Campaigns</Link></Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Search className="h-4 w-4" />Filters</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-3 md:grid-cols-4">
          <Field label="Search"><Input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="event or reason" /></Field>
          <Field label="Status"><Input value={filters.status} onChange={(event) => update("status", event.target.value)} placeholder="sent, delivered, failed" /></Field>
          <Field label="Campaign"><Input value={filters.campaignId} onChange={(event) => update("campaignId", event.target.value)} placeholder="campaign id" /></Field>
          <Field label="Customer"><Input value={filters.customerId} onChange={(event) => update("customerId", event.target.value)} placeholder="customer id" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Reports</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading delivery reports...</p> : null}
          {rows.map((row: any, index: number) => <DeliveryRow key={row.id || `${row.createdAt}-${index}`} row={row} />)}
          {!loading && !rows.length ? <DeliveryEmptyState /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
          <CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" />Raw Logs</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowRaw((value) => !value)} className="gap-2" data-slot="card-action">
            {showRaw ? "Hide Raw Logs" : "Show Raw Logs"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", showRaw ? "rotate-180" : "rotate-0")} />
          </Button>
        </CardHeader>
        {showRaw ? <CardContent><pre className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">{JSON.stringify(data || { loading }, null, 2)}</pre></CardContent> : null}
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}</div>
}

function DeliveryRow({ row }: { row: any }) {
  const event = row.event || row.messageType || row.category || "message"
  const status = row.status || row.level || "record"
  return (
    <div className="grid min-w-0 gap-3 rounded-lg border border-border/50 p-3 md:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{humanize(event)}</p>
        {row.failureReason ? <p className="mt-1 text-xs text-destructive">{row.failureReason}</p> : null}
      </div>
      <Badge variant={String(status).includes("fail") ? "destructive" : "outline"}>{status}</Badge>
      <Meta label="Campaign" value={row.campaignId || row.campaignLogId || "-"} />
      <Meta label="Customer" value={row.customerId || row.maskedPhone || row.toMasked || "-"} />
      <p className="text-sm text-muted-foreground">{formatDate(row.createdAt)}</p>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground md:hidden">{label}</p><p className="truncate text-sm">{value}</p></div>
}

function DeliveryEmptyState() {
  return (
    <Empty className="glass border border-dashed border-border/50 bg-background/40">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-6 w-6" /></EmptyMedia>
        <EmptyTitle>No delivery reports</EmptyTitle>
        <EmptyDescription>Delivery, read, retry, and failure events will appear once WhatsApp messages are processed.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild><Link href="/admin/whatsapp/campaigns" className="gap-2"><Plus className="h-4 w-4" />Create Campaign</Link></Button>
      </EmptyContent>
    </Empty>
  )
}

function humanize(value: string) {
  return String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString()
}
