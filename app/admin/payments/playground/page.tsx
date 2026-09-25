"use client"

import { useEffect, useState } from "react"
import { Activity, CreditCard, FileText, RefreshCw, RotateCcw, Send, ShieldCheck, TestTube2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"

const actions = [
  ["load_gateway", "Load gateway", Activity],
  ["validate_gateway", "Validate gateway", ShieldCheck],
  ["generate_order", "Generate order", FileText],
  ["generate_invoice", "Generate invoice", FileText],
  ["create_razorpay_order", "Create Razorpay order", CreditCard],
  ["create_checkout_session", "Create checkout session", Send],
  ["open_checkout", "Open checkout", CreditCard],
  ["webhook_simulator", "Webhook simulator", TestTube2],
  ["refund_simulator", "Refund simulator", RotateCcw],
] as const

export default function PaymentPlaygroundPage() {
  const [runs, setRuns] = useState<any[]>([])
  const [loading, setLoading] = useState<string | null>(null)

  async function load() {
    const res = await fetch("/api/admin/payments/playground", { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (res.ok) setRuns(data.runs || [])
  }

  async function run(action: string) {
    setLoading(action)
    try {
      await fetch("/api/admin/payments/playground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      await load()
    } finally {
      setLoading(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment Playground</h1>
          <p className="text-sm text-muted-foreground">Run isolated gateway diagnostics and inspect the exact result for each step.</p>
        </div>
        <Button type="button" variant="outline" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map(([action, label, Icon]) => (
            <Button key={action} type="button" variant="outline" onClick={() => run(action)} disabled={Boolean(loading)} className="justify-start gap-2">
              <Icon className="h-4 w-4" />{loading === action ? "Running..." : label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Runs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 text-left text-muted-foreground">
                <th className="py-2">Time</th>
                <th>Action</th>
                <th>Status</th>
                <th>Gateway</th>
                <th>Reason</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {runs.flatMap((run) => (run.checks || []).map((check: any) => (
                <tr key={check.id} className="border-b border-border/20 align-top">
                  <td className="py-2">{new Date(check.createdAt).toLocaleString()}</td>
                  <td>{check.check}</td>
                  <td className={check.status === "pass" ? "text-emerald-300" : "text-red-300"}>{check.status.toUpperCase()}</td>
                  <td>{check.gateway || "-"}</td>
                  <td className="max-w-xl break-words">{check.safeMessage || check.code}</td>
                  <td>{check.latencyMs == null ? "-" : `${check.latencyMs} ms`}</td>
                </tr>
              )))}
              {!runs.length ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">No playground runs yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
