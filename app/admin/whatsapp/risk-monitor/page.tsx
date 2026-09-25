"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, FileJson, Inbox, RefreshCw, ShieldAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

type QueueStats = {
  waiting?: number
  active?: number
  delayed?: number
  completed?: number
  failed?: number
  paused?: boolean
  prioritized?: number
  waitingChildren?: number
}

export default function WhatsAppRiskMonitorPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/risk-monitor", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => window.clearInterval(timer)
  }, [])

  const queues = useMemo(() => Object.entries((data?.queues || {}) as Record<string, QueueStats>), [data])
  const totals = useMemo(() => queues.reduce((sum, [, stats]) => ({
    completed: sum.completed + Number(stats.completed || 0),
    failed: sum.failed + Number(stats.failed || 0),
    delayed: sum.delayed + Number(stats.delayed || 0),
    waiting: sum.waiting + Number(stats.waiting || 0),
  }), { completed: 0, failed: 0, delayed: 0, waiting: 0 }), [queues])

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Risk Monitor</h1>
          <p className="text-sm text-muted-foreground">Queue pressure, failed sends, active suppressions, and campaign risk posture.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
          Refresh
        </Button>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Completed" value={totals.completed} />
        <Metric label="Failed" value={totals.failed} tone={totals.failed ? "bad" : "neutral"} />
        <Metric label="Delayed" value={totals.delayed} tone={totals.delayed ? "warn" : "neutral"} />
        <Metric label="Waiting" value={totals.waiting} />
        <Metric label="Queue Count" value={queues.length} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-accent" />
              Queue Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {queues.map(([name, stats]) => (
              <div key={name} className="grid min-w-0 gap-3 rounded-lg border border-border/50 p-3 md:grid-cols-[minmax(0,1fr)_repeat(5,minmax(64px,auto))] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">{stats.paused ? "Paused" : "Running"}</p>
                </div>
                <Cell label="Waiting" value={stats.waiting || 0} />
                <Cell label="Active" value={stats.active || 0} />
                <Cell label="Delayed" value={stats.delayed || 0} />
                <Cell label="Failed" value={stats.failed || 0} />
                <Cell label="Done" value={stats.completed || 0} />
              </div>
            ))}
            {!loading && !queues.length ? (
              <EmptyState title="No queue data" description="Queue risk details will appear after WhatsApp queues are configured." />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Risk Signals</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Signal label="Failures in 24h" value={data?.failures24h || 0} danger={Boolean(data?.failures24h)} />
            <Signal label="Active suppressions" value={data?.activeSuppressions || 0} />
            <Signal label="High-risk campaigns" value={(data?.highRisk || []).length} danger={(data?.highRisk || []).length > 0} />
            <Signal label="Risk rules" value={(data?.riskRules || []).length} />
          </CardContent>
        </Card>
      </div>

      {(data?.highRisk || []).length ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-400" />High-Risk Campaigns</CardTitle></CardHeader>
          <CardContent className="grid min-w-0 gap-3 xl:grid-cols-2">
            {data.highRisk.map((campaign: any) => (
              <div key={campaign.id} className="min-w-0 rounded-lg border border-border/50 p-3">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-medium">{campaign.name || campaign.id}</p>
                  <Badge variant="outline">{campaign.status || "campaign"}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">Risk {campaign.riskScore ?? 0} · Quality {campaign.qualityScore ?? "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

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

function Metric({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "bad" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className={cn("mt-2 truncate text-2xl font-semibold tabular-nums", tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-400" : "")}>{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}

function Cell({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground md:hidden">{label}</p><p className="tabular-nums">{value.toLocaleString()}</p></div>
}

function Signal({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0"><span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span><Badge variant={danger ? "destructive" : "outline"}>{value.toLocaleString()}</Badge></div>
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border border-dashed border-border/40 bg-background/25 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Inbox className="h-5 w-5" /></EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent />
    </Empty>
  )
}
