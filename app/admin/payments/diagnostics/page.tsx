"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Check = { id: string; gateway?: string | null; check: string; status: string; code?: string | null; safeMessage?: string | null; latencyMs?: number | null }
type Run = { id: string; status: string; startedAt: string; completedAt?: string | null; summary: { total?: number; passed?: number; warnings?: number; failed?: number }; checks: Check[] }

export default function PaymentDiagnosticsPage() {
  const [run, setRun] = useState<Run | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const load = useCallback(async () => { const response = await fetch("/api/admin/payments/diagnostics", { cache: "no-store" }); const data = await response.json(); if (response.ok) setRun(data.run || null) }, [])
  useEffect(() => { void load() }, [load])
  async function execute() { setRunning(true); setError(""); try { const response = await fetch("/api/admin/payments/diagnostics", { method: "POST" }); const data = await response.json(); setRun(data.run || null); if (!response.ok) setError("One or more required payment diagnostics failed. Exact results are shown below.") } catch (next) { setError(next instanceof Error ? next.message : "Diagnostics failed") } finally { setRunning(false) } }
  const summary = run?.summary || {}
  return <div className="space-y-6 p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Payment Diagnostics</h1><p className="text-sm text-muted-foreground">Persisted, secret-safe checks for the payment data path and enabled gateways.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href="/admin/payments">Payments</Link></Button><Button onClick={execute} disabled={running}>{running ? "Running…" : "Run diagnostics"}</Button></div></div>
    {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
    <div className="grid gap-3 md:grid-cols-4">{[["Passed", summary.passed || 0], ["Warnings", summary.warnings || 0], ["Failed", summary.failed || 0], ["Total", summary.total || 0]].map(([label, value]) => <Card key={label}><CardContent className="p-4"><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle>Latest health report {run ? `— ${run.status}` : ""}</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Gateway</th><th>Check</th><th>Status</th><th>Code</th><th>Latency</th><th>Exact result</th></tr></thead><tbody>{run?.checks?.map((check) => <tr key={check.id} className="border-b border-border/30"><td className="py-2">{check.gateway || "platform"}</td><td>{check.check}</td><td className={check.status === "fail" ? "text-red-300" : check.status === "warn" ? "text-amber-200" : "text-emerald-300"}>{check.status}</td><td className="font-mono text-xs">{check.code || "-"}</td><td>{check.latencyMs == null ? "-" : `${check.latencyMs}ms`}</td><td>{check.safeMessage || "-"}</td></tr>)}</tbody></table></div></CardContent></Card>
  </div>
}
