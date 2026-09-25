"use client"

import { useEffect, useMemo, useState } from "react"
import { HeartPulse, Inbox, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

export default function WhatsAppQueueHealthPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/queue", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const queues = useMemo(() => Object.entries(data?.queues || {}) as Array<[string, any]>, [data])
  const totals = queues.reduce((sum, [, stats]) => ({
    waiting: sum.waiting + Number(stats.waiting || 0),
    active: sum.active + Number(stats.active || 0),
    delayed: sum.delayed + Number(stats.delayed || 0),
    failed: sum.failed + Number(stats.failed || 0),
  }), { waiting: 0, active: 0, delayed: 0, failed: 0 })

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">WhatsApp Queue Health</h1>
          <p className="text-sm text-muted-foreground">Queue depth, delayed jobs, retries, and pacing pressure.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Waiting" value={totals.waiting} />
        <Metric label="Active" value={totals.active} />
        <Metric label="Delayed" value={totals.delayed} />
        <Metric label="Failed" value={totals.failed} danger={totals.failed > 0} />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><HeartPulse className="h-4 w-4 text-accent" />Queues</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-3 xl:grid-cols-2">
          {queues.map(([name, stats]) => (
            <div key={name} className="min-w-0 rounded-lg border border-border/50 p-4">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <p className="min-w-0 truncate font-medium">{name}</p>
                <Badge variant={stats.paused ? "destructive" : "outline"}>{stats.paused ? "paused" : "running"}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
                <QueueStat label="Waiting" value={stats.waiting || 0} />
                <QueueStat label="Active" value={stats.active || 0} />
                <QueueStat label="Delayed" value={stats.delayed || 0} />
                <QueueStat label="Failed" value={stats.failed || 0} />
              </div>
            </div>
          ))}
          {!loading && !queues.length ? <QueueEmptyState /> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <Card><CardContent className="p-4"><p className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</p><p className={cn("mt-2 text-2xl font-semibold tabular-nums", danger ? "text-destructive" : "")}>{value.toLocaleString()}</p></CardContent></Card>
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-md bg-muted/20 p-2"><p className="truncate text-[11px] text-muted-foreground">{label}</p><p className="truncate font-medium tabular-nums">{value.toLocaleString()}</p></div>
}

function QueueEmptyState() {
  return (
    <Empty className="col-span-full border border-dashed border-border/40 bg-background/25 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-5 w-5" /></EmptyMedia>
        <EmptyTitle className="text-base">No queue data</EmptyTitle>
        <EmptyDescription>Queue health will appear after WhatsApp queues are configured.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
