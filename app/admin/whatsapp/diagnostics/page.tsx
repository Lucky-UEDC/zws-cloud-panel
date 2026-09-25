"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ChevronDown, FileJson, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

export default function WhatsAppDiagnosticsPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/diagnostics", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 10000)
    return () => window.clearInterval(timer)
  }, [])

  const degraded = data?.degraded?.degradedMode
  const queueTotals = getQueueTotals(data)

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">WhatsApp Diagnostics</h1>
          <p className="text-sm text-muted-foreground">Session, worker, queue, crash, reconnect, and degraded-service details.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button variant="outline" onClick={() => setShowRaw((value) => !value)} className="gap-2"><FileJson className="h-4 w-4" />{showRaw ? "Hide Raw Logs" : "Show Raw Logs"}<ChevronDown className={cn("h-4 w-4 transition-transform", showRaw ? "rotate-180" : "rotate-0")} /></Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp/template-health">Template Health</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp">WhatsApp</Link></Button>
        </div>
      </div>

      {degraded ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Degraded WhatsApp operation</AlertTitle>
          <AlertDescription>{(data.degraded.reasons || []).join(" · ") || "Diagnostics found a degraded dependency."}</AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Diagnostics healthy</AlertTitle>
          <AlertDescription>Worker heartbeat, queues, and session state are available.</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Queue Health" value={queueTotals.configured ? "Online" : "Missing"} tone={queueTotals.configured ? "good" : "bad"} />
        <Metric label="Completed" value={queueTotals.completed} />
        <Metric label="Failed" value={queueTotals.failed} tone={queueTotals.failed ? "bad" : "neutral"} />
        <Metric label="Waiting" value={queueTotals.waiting} />
        <Metric label="Delayed" value={queueTotals.delayed} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Session Health</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status" value={data?.session?.status} />
            <Row label="Auth" value={data?.session?.authStatus} />
            <Row label="WA state" value={data?.session?.currentWAState} />
            <Row label="Reconnects" value={data?.session?.reconnectCount} />
            <Row label="Provider" value={data?.session?.evolution?.provider || "evolution"} />
            <Row label="Instance" value={data?.session?.sessionName || data?.session?.evolution?.settings?.instanceName || "-"} />
            <Row label="Worker heartbeat" value={data?.session?.workerHeartbeatAt ? new Date(data.session.workerHeartbeatAt).toLocaleString() : "-"} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Queue Health</CardTitle></CardHeader>
          <CardContent className="grid min-w-0 gap-3 md:grid-cols-2">
            {(data?.queues?.queues || []).map((queue: any) => (
              <div key={queue.name} className="rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{queue.name}</p>
                  <Badge variant={queue.configured ? "outline" : "destructive"}>{queue.configured ? "configured" : "missing"}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Active {queue.stats?.active || 0} · Waiting {queue.stats?.waiting || 0} · Failed {queue.stats?.failed || 0} · Delayed {queue.stats?.delayed || 0}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <LogPanel title="Reconnect / Session Logs" rows={data?.sessionLogs || []} />
        <LogPanel title="Queue Logs" rows={data?.queueLogs || []} />
        <LogPanel title="Error Logs" rows={data?.errorLogs || []} />
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading diagnostics...</p> : null}
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

function Row({ label, value }: { label: string; value: any }) {
  return <div className="flex justify-between gap-3 border-b border-border/40 py-2"><span className="text-muted-foreground">{label}</span><span className="text-right">{value || "-"}</span></div>
}

function LogPanel({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.slice(0, 12).map((row) => (
          <div key={row.id} className="rounded border border-border/40 p-3 text-sm">
            <p className="font-medium">{row.event || row.failureReason || row.status || "event"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</p>
            {row.reason || row.message ? <p className="mt-2 text-xs">{row.reason || row.message}</p> : null}
          </div>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">No records.</p> : null}
      </CardContent>
    </Card>
  )
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "good" | "bad" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="truncate text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <p className={cn("mt-2 truncate text-2xl font-semibold tabular-nums", tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-destructive" : "")}>{value}</p>
      </CardContent>
    </Card>
  )
}

function getQueueTotals(data: any) {
  const queues = data?.queues?.queues || []
  return queues.reduce((totals: any, queue: any) => ({
    configured: totals.configured || Boolean(queue.configured),
    completed: totals.completed + Number(queue.stats?.completed || 0),
    failed: totals.failed + Number(queue.stats?.failed || 0),
    waiting: totals.waiting + Number(queue.stats?.waiting || 0),
    delayed: totals.delayed + Number(queue.stats?.delayed || 0),
  }), { configured: false, completed: 0, failed: 0, waiting: 0, delayed: 0 })
}
