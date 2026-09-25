"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, CheckCircle2, ChevronRight, MessageSquare, Phone, PlugZap, RefreshCw, Send, Users, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

type OverviewData = {
  overview?: Record<string, unknown>
} & Record<string, unknown>

type Configured = { configured: boolean } & Record<string, unknown>

function maskBaseUrl(value: string) {
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return value || "Not configured"
  }
}

export function WhatsAppGatewayOverview() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null)
  const mountedRef = useRef(false)

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/whatsapp-gateway/overview", { headers: { "x-forwarded-for": "127.0.0.1" } })
    const body = (await readJsonResponse<OverviewData>(response)) || {}
    if (!response.ok) {
      dedupedAdminErrorToast({ message: String((body as { error?: string })?.error || "Could not load gateway overview"), key: "gateway-overview" })
    }
    setData(body.overview || null)
    setLoading(false)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const overview = useMemo(
    () => (data || {}) as Record<string, any>,
    [data],
  )
  const counts = (overview.counts || {}) as Record<string, number>
  const byStatus = (overview.byStatus || []) as Array<{ status: string; count: number }>
  const configured = (overview.configured || { configured: false }) as Configured
  const settings = (overview.settings || {}) as Record<string, unknown>
  const wabas = (overview.wabas || []) as unknown[]
  const lastMessageAt = overview.lastMessageAt as string | null

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await authFetch("/api/admin/whatsapp-gateway/test-connection", { method: "POST" })
      const body = (await readJsonResponse<{ result?: Record<string, unknown> }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Connection test failed"))
      setTestResult(body.result || null)
      if (body.result?.success) toast.success("Gateway connection works")
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Connection test failed", key: "gateway-test" })
    } finally {
      setTesting(false)
    }
  }

  async function syncConnections() {
    setSyncing(true)
    try {
      const response = await authFetch("/api/admin/whatsapp-gateway/connections", { method: "POST" })
      const body = (await readJsonResponse<{ result?: { success?: boolean; message?: string } }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Sync failed"))
      if (body.result?.success) toast.success(body.result.message || "Connections synced")
      else dedupedAdminErrorToast({ message: body.result?.message || "Sync failed", key: "gateway-sync" })
      void load()
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Sync failed", key: "gateway-sync" })
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <CardTitle>WhatsApp Gateway</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Badge variant={configured.configured ? "default" : "secondary"} className={cn(configured.configured ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "")}>
                {configured.configured ? "Configured" : "Not configured"}
              </Badge>
              <span className="hidden sm:inline">{settings.apiBaseUrl ? maskBaseUrl(String(settings.apiBaseUrl || "")) : "No base URL set"}</span>
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={syncConnections} disabled={syncing || !settings.apiBaseUrl}>
            {syncing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            Sync Connections
          </Button>
          <Button size="sm" onClick={testConnection} disabled={testing || !settings.apiBaseUrl}>
            {testing ? <Spinner className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
            Test Connection
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {testResult ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-sm",
              testResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5",
            )}
          >
            {testResult.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
            <div className="min-w-0">
              <p className="font-medium">{String(testResult.message || "Connection check")}</p>
              <p className="text-xs text-muted-foreground">HTTP {String(testResult.httpStatus ?? "—")} · {String(testResult.latencyMs ?? "—")}ms · {String(testResult.checkedAt || "").slice(0, 19).replace("T", " ")}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "WABAs", value: counts.wabas ?? 0, icon: Phone },
            { label: "Phone numbers", value: counts.phoneNumbers ?? 0, icon: Phone },
            { label: "Templates", value: counts.templates ?? 0, icon: Send },
            { label: "Contacts", value: counts.contacts ?? 0, icon: Users },
            { label: "Last 24h", value: counts.messages24h ?? 0, icon: Activity },
            { label: "Total sent", value: counts.messages ?? 0, icon: MessageSquare },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <div key={stat.label} className="rounded-lg border bg-background p-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-xs">{stat.label}</span>
                </div>
                <p className="mt-1 text-xl font-semibold">{stat.value}</p>
              </div>
            )
          })}
        </div>

        {byStatus.length ? (
          <div className="flex flex-wrap gap-2">
            {byStatus.map((row) => (
              <Badge key={row.status} variant="outline" className="capitalize">
                {row.status}: {row.count}
              </Badge>
            ))}
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">WhatsApp connections</h3>
            {lastMessageAt ? <span className="text-xs text-muted-foreground">Last message: {String(lastMessageAt).slice(0, 19).replace("T", " ")}</span> : null}
          </div>
          {wabas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No connections synced yet — configure the gateway and use <span className="font-medium">Sync Connections</span> (also available in Settings).
            </p>
          ) : (
            <div className="divide-y divide-border rounded-lg border">
              {wabas.map((waba: any, index: number) => (
                <div key={waba.id ?? index} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{waba.name || `Connection ${index + 1}`}</p>
                      <p className="truncate text-xs text-muted-foreground">{waba.whatsappBusinessAccountId || waba.externalId}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={waba.isActive ? "default" : "secondary"}>{waba.isActive ? "Active" : "Inactive"}</Badge>
                    {waba.lastSyncedAt ? <span className="hidden text-xs text-muted-foreground sm:inline">synced {String(waba.lastSyncedAt).slice(0, 10)}</span> : null}
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}