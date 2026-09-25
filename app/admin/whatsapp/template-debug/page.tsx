"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Bug, ChevronDown, FileJson, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { WHATSAPP_TEMPLATE_KEYS } from "@/lib/whatsapp/template-registry"
import { WhatsAppNav } from "@/components/admin/whatsapp-nav"
import { cn } from "@/lib/utils"

export default function WhatsAppTemplateDebugPage() {
  const [key, setKey] = useState<string>(WHATSAPP_TEMPLATE_KEYS.AUTH_LOGIN_OTP)
  const [language, setLanguage] = useState("en")
  const [variables, setVariables] = useState('{"first_name":"Asha","otp_code":"829201","ip":"103.48.12.9","city":"Mumbai","country":"India","browser":"Chrome","login_time":"09 May 2026, 18:40"}')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ key, language, variables })
    const response = await fetch(`/api/admin/whatsapp/template-debug?${params.toString()}`, { cache: "no-store" })
    setData(await readJsonResponse<any>(response))
    setLoading(false)
  }, [key, language, variables])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <WhatsAppNav />
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Template Debug</h1>
          <p className="text-sm text-muted-foreground">Inspect selected template, version, variables, cache state, and final render.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" />Render</Button>
          <Button variant="outline" onClick={() => setShowRaw((value) => !value)} className="gap-2"><FileJson className="h-4 w-4" />{showRaw ? "Hide Raw Logs" : "Show Raw Logs"}<ChevronDown className={cn("h-4 w-4 transition-transform", showRaw ? "rotate-180" : "rotate-0")} /></Button>
          <Button asChild variant="outline"><Link href="/admin/whatsapp/templates">Templates</Link></Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Bug className="h-4 w-4" />Render Input</CardTitle></CardHeader>
        <CardContent className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_120px]">
          <Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="Template key" />
          <Input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="Language" />
          <Textarea className="min-h-32 lg:col-span-2" value={variables} onChange={(event) => setVariables(event.target.value)} />
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Selection</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Template" value={data?.selectedTemplate?.key} />
            <Row label="Version" value={data?.selectedTemplate?.version || "-"} />
            <Row label="Version ID" value={data?.selectedTemplate?.versionId || "-"} />
            <Row label="Language" value={data?.selectedTemplate?.language} />
            <Row label="Duration" value={data?.renderDurationMs != null ? `${data.renderDurationMs} ms` : "-"} />
            <div className="flex items-center justify-between border-b border-border/40 py-2">
              <span className="text-muted-foreground">Cache</span>
              <Badge variant={data?.cacheHit ? "default" : "outline"}>{data?.cacheHit ? "hit" : "miss"}</Badge>
            </div>
            <Row label="Fallback" value={data?.fallbackReason || "-"} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Final Rendered Body</CardTitle></CardHeader>
          <CardContent>
            <pre className="hide-scrollbar max-h-[520px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded border border-border/50 bg-muted/30 p-4 text-sm">{data?.finalRenderedBody || ""}</pre>
          </CardContent>
        </Card>
      </div>
      {showRaw ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileJson className="h-4 w-4" />Raw Logs</CardTitle></CardHeader>
          <CardContent>
            <pre className="hide-scrollbar max-h-[520px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-muted/30 p-3 text-xs">{JSON.stringify(data || { loading }, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: any }) {
  return <div className="flex justify-between gap-3 border-b border-border/40 py-2"><span className="text-muted-foreground">{label}</span><span className="text-right">{value || "-"}</span></div>
}
