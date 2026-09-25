"use client"

import { useEffect, useState } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type HealthPayload = {
  gateways?: Array<{
    id: string
    gateway: string
    enabled: boolean
    priority: number
    credentials: { publicKeyPresent: boolean; secretPresent: boolean; webhookSecretPresent: boolean }
    runtime: { ok: boolean; code: string; reason: string; missingFields: string[] }
    webhook: { configured: boolean; lastStatus: string | null }
    lastPayment: { status: string; amount: string | number; currency: string; createdAt: string } | null
    lastError: string | null
    lastValidation: { status: string; errorMessage: string | null; createdAt: string } | null
    apiLatency: number | null
  }>
  cards: {
    pendingInvoices: number
    failedWebhooks: number
    signatureFailures: number
    pendingPayments: number
    stuckPayments: number
    failedProvisioningTriggers: number
    failedWalletCredits: number
    webhookRetries: number
    webhookLatencyMs: number
    lastWebhookAt: string | null
  }
  latestEvents: Array<{
    id: string
    gateway: string
    eventId: string
    status: string
    createdAt: string
    processedAt: string | null
    errorMessage?: string | null
  }>
}

export default function AdminPaymentHealthPage() {
  const [data, setData] = useState<HealthPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/payments/health", { cache: "no-store" })
      const json = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(json?.error || "Failed to load payment health")
      setData(json)
    } catch (err: any) {
      setError(err?.message || "Failed to load payment health")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const cards = data?.cards

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment Health</h1>
          <p className="text-sm text-muted-foreground">Webhook reliability, reconciliation backlog, and fulfillment trigger health.</p>
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</Button>
      </div>

      {error ? <Card><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Pending Invoices" value={cards?.pendingInvoices ?? 0} />
        <Metric label="Pending Payments" value={cards?.pendingPayments ?? 0} />
        <Metric label="Stuck Payments" value={cards?.stuckPayments ?? 0} />
        <Metric label="Failed Webhooks" value={cards?.failedWebhooks ?? 0} />
        <Metric label="Signature Failures" value={cards?.signatureFailures ?? 0} />
        <Metric label="Webhook Retries" value={cards?.webhookRetries ?? 0} />
        <Metric label="Wallet Credit Failures" value={cards?.failedWalletCredits ?? 0} />
        <Metric label="Provisioning Trigger Failures" value={cards?.failedProvisioningTriggers ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gateway Runtime</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 text-left text-muted-foreground">
                <th className="py-2">Gateway</th>
                <th>Enabled</th>
                <th>Priority</th>
                <th>Credentials</th>
                <th>Runtime</th>
                <th>Webhook</th>
                <th>Last Payment</th>
                <th>Last Error</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {(data?.gateways || []).map((row) => (
                <tr key={row.id} className="border-b border-border/20 align-top">
                  <td className="py-2 font-medium capitalize">{row.gateway}</td>
                  <td>{row.enabled ? "Yes" : "No"}</td>
                  <td>{row.priority}</td>
                  <td className="text-xs">
                    key {row.credentials.publicKeyPresent ? "yes" : "no"} · secret {row.credentials.secretPresent ? "yes" : "no"} · webhook {row.credentials.webhookSecretPresent ? "yes" : "no"}
                  </td>
                  <td className={row.runtime.ok ? "text-emerald-300" : "text-amber-200"}>{row.runtime.code}<div className="max-w-xs text-xs text-muted-foreground">{row.runtime.reason}</div></td>
                  <td>{row.webhook.configured ? "Configured" : "Missing"}<div className="text-xs text-muted-foreground">{row.webhook.lastStatus || "-"}</div></td>
                  <td>{row.lastPayment ? `${row.lastPayment.status} ${row.lastPayment.amount} ${row.lastPayment.currency}` : "-"}</td>
                  <td className="max-w-xs break-words text-xs text-muted-foreground">{row.lastError || row.lastValidation?.errorMessage || "-"}</td>
                  <td>{row.apiLatency == null ? "-" : `${row.apiLatency} ms`}</td>
                </tr>
              ))}
              {!data?.gateways?.length ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">{loading ? "Loading..." : "No gateways found."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Latency</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Average processing latency: <span className="font-medium">{cards?.webhookLatencyMs ?? 0} ms</span></p>
          <p>Last webhook: <span className="font-medium">{cards?.lastWebhookAt ? new Date(cards.lastWebhookAt).toLocaleString() : "-"}</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Webhook Events</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 text-left text-muted-foreground">
                <th className="py-2">Time</th>
                <th>Gateway</th>
                <th>Event</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(data?.latestEvents || []).map((row) => (
                <tr key={row.id} className="border-b border-border/20 align-top">
                  <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.gateway}</td>
                  <td className="font-mono text-xs">{row.eventId}</td>
                  <td>{row.status}</td>
                  <td className="max-w-xs break-words text-xs text-muted-foreground">{row.errorMessage || "-"}</td>
                </tr>
              ))}
              {!data?.latestEvents?.length ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground">{loading ? "Loading..." : "No events found."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold leading-none">{value}</p>
      </CardContent>
    </Card>
  )
}
