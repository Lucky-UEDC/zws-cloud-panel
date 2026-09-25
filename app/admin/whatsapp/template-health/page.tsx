"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"

export default function WhatsAppTemplateHealthPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const response = await fetch("/api/admin/whatsapp/template-health", { cache: "no-store" })
    const next = await readJsonResponse<any>(response)
    if (response.ok) setData(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const healthy = Boolean(data?.ok)

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Template Health</h1>
          <p className="text-sm text-muted-foreground">Required WhatsApp templates, approved versions, translations, cache, and render diagnostics.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp/diagnostics">Diagnostics</Link></Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp/templates">Templates</Link></Button>
        </div>
      </div>

      {healthy ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Required templates healthy</AlertTitle>
          <AlertDescription>All required templates have active approved versions and English translations.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Template health degraded</AlertTitle>
          <AlertDescription>{(data?.missing || []).map((row: any) => row.key).join(", ") || "Template validation failed."}</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-4">
        <Metric title="Required" value={data?.required?.length || 0} />
        <Metric title="Missing" value={data?.missing?.length || 0} tone={data?.missing?.length ? "bad" : "good"} />
        <Metric title="Memory Cache" value={data?.cache?.memoryEntries || 0} />
        <Metric title="Redis Cache" value={data?.cache?.redisConfigured ? "online" : "offline"} tone={data?.cache?.redisConfigured ? "good" : "bad"} />
      </div>

      <Card>
        <CardHeader><CardTitle>Required Templates</CardTitle></CardHeader>
        <CardContent className="hide-scrollbar overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th className="py-2">Key</th><th>Status</th><th>Version</th><th>Translations</th><th>Issues</th></tr>
            </thead>
            <tbody>
              {(data?.required || []).map((row: any) => (
                <tr key={row.key} className="border-b border-border/40">
                  <td className="py-2 font-medium">{row.key}</td>
                  <td><Badge variant={row.ok ? "outline" : "destructive"}>{row.ok ? "OK" : row.status}</Badge></td>
                  <td>{row.activeVersion ? `v${row.activeVersion}` : "-"}</td>
                  <td>{row.translationCount || 0}{row.hasEnglishTranslation ? " incl. en" : ""}</td>
                  <td className="text-muted-foreground">{(row.missingReasons || []).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <LogPanel title="Recent Render Status" rows={data?.renderFailures || []} />
        <LogPanel title="Provider / Template Failures" rows={data?.failures || []} />
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading template health...</p> : null}
    </div>
  )
}

function Metric({ title, value, tone }: { title: string; value: any; tone?: "good" | "bad" }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent><p className={tone === "bad" ? "text-2xl font-semibold text-destructive" : tone === "good" ? "text-2xl font-semibold text-emerald-500" : "text-2xl font-semibold"}>{value}</p></CardContent>
    </Card>
  )
}

function LogPanel({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.slice(0, 10).map((row) => (
          <div key={row.id} className="rounded border border-border/40 p-3 text-sm">
            <p className="font-medium">{row.event || row.failureReason || row.errorCode || "event"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</p>
            {row.message ? <p className="mt-2 text-xs">{row.message}</p> : null}
          </div>
        ))}
        {!rows.length ? <p className="text-sm text-muted-foreground">No records.</p> : null}
      </CardContent>
    </Card>
  )
}
