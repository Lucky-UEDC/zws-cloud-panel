"use client"

import { useEffect, useState } from "react"
import { RefreshCw, TestTube2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"

type TestingState = {
  report?: Record<string, Record<string, string>>
  latestValidation?: any
  runtime?: any
}

export default function PaymentTestingPage() {
  const [state, setState] = useState<TestingState>({})
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/payments/testing", { cache: "no-store" })
      const data = await readJsonResponse<TestingState & { ok?: boolean; error?: string }>(res)
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Unable to load payment test report")
      setState(data || {})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const validationOutput = state.latestValidation?.output && typeof state.latestValidation.output === "object"
    ? Object.entries(state.latestValidation.output)
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Payment Testing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Runtime checkout, webhook, fallback, and validation status.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className="h-4 w-4" />Refresh
        </Button>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TestTube2 className="h-5 w-5" />PAYMENT SYSTEM TEST REPORT</CardTitle>
          <CardDescription>Latest live runtime signals and the most recent post-save validation run.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(state.report || {}).map(([section, rows]) => (
            <div key={section} className="rounded-lg border border-border/40 bg-background/35 p-4">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">{section}</h2>
              <div className="mt-3 space-y-2">
                {Object.entries(rows).map(([label, result]) => (
                  <div key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span>{label}</span>
                    <span className={result === "PASS" ? "text-emerald-300" : "text-red-300"}>{result}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6">
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Validation Job</CardTitle>
            <CardDescription>Queued after every gateway credential save.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status" value={state.latestValidation?.status || "No run yet"} />
            <Row label="Gateway" value={state.latestValidation?.gateway || "-"} />
            <Row label="Started" value={state.latestValidation?.startedAt || "-"} />
            <Row label="Completed" value={state.latestValidation?.completedAt || "-"} />
            {state.latestValidation?.errorMessage ? <Row label="Error" value={state.latestValidation.errorMessage} danger /> : null}
            {validationOutput.map(([command, result]: any) => (
              <Row key={command} label={command} value={result?.status || "pending"} danger={result?.status === "failed"} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${danger ? "text-red-300" : "text-foreground"}`}>{value}</span>
    </div>
  )
}
