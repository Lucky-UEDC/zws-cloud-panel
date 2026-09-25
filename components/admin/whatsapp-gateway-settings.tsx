"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, KeyRound, Lock, RefreshCw, Save, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { readJsonResponse } from "@/lib/client/safe-json"
import { authFetch } from "@/lib/client/auth-fetch"

type PublicSettings = {
  enabled: boolean
  apiBaseUrl: string
  authType: "api_key" | "bearer" | "basic" | "none"
  apiKeyHeader: string
  basicUsername: string
  requestTimeoutMs: number
  retryEnabled: boolean
  maxRetries: number
  retryDelayMs: number
  defaultWabaId: string
  defaultSenderNumber: string
  defaultSenderNumberId: string
  connectionTestPath: string
  loggingEnabled: boolean
  mediaUrlPolicy: "public" | "any"
  apiKeyConfigured: boolean
  apiTokenConfigured: boolean
}

type SaveBody = Record<string, string | number | boolean | undefined>

export function WhatsAppGatewaySettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; httpStatus?: number | string; latencyMs?: number | string } | null>(null)

  const [enabled, setEnabled] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState("")
  const [authType, setAuthType] = useState<PublicSettings["authType"]>("bearer")
  const [apiKeyHeader, setApiKeyHeader] = useState("x-api-key")
  const [secret, setSecret] = useState("")
  const [secretConfigured, setSecretConfigured] = useState(false)
  const [basicUsername, setBasicUsername] = useState("")
  const [requestTimeoutMs, setRequestTimeoutMs] = useState(20000)
  const [retryEnabled, setRetryEnabled] = useState(true)
  const [maxRetries, setMaxRetries] = useState(2)
  const [retryDelayMs, setRetryDelayMs] = useState(1000)
  const [defaultWabaId, setDefaultWabaId] = useState("")
  const [defaultSenderNumber, setDefaultSenderNumber] = useState("")
  const [defaultSenderNumberId, setDefaultSenderNumberId] = useState("")
  const [connectionTestPath, setConnectionTestPath] = useState("/api/whatsapp/phone-numbers")
  const [loggingEnabled, setLoggingEnabled] = useState(true)
  const [mediaUrlPolicy, setMediaUrlPolicy] = useState<"public" | "any">("public")

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/whatsapp-gateway/settings", { headers: { "x-forwarded-for": "127.0.0.1" } })
    const body = (await readJsonResponse<{ settings?: PublicSettings }>(response)) || {}
    if (!response.ok) {
      dedupedAdminErrorToast({ message: String((body as { error?: string })?.error || "Could not load settings"), key: "gateway-settings" })
    }
    const settings = body.settings
    if (settings) {
      setEnabled(settings.enabled)
      setApiBaseUrl(settings.apiBaseUrl)
      setAuthType(settings.authType)
      setApiKeyHeader(settings.apiKeyHeader)
      setSecretConfigured(settings.authType === "basic" ? settings.apiTokenConfigured : Boolean(settings.apiKeyConfigured || settings.apiTokenConfigured))
      setBasicUsername(settings.basicUsername)
      setRequestTimeoutMs(settings.requestTimeoutMs)
      setRetryEnabled(settings.retryEnabled)
      setMaxRetries(settings.maxRetries)
      setRetryDelayMs(settings.retryDelayMs)
      setDefaultWabaId(settings.defaultWabaId)
      setDefaultSenderNumber(settings.defaultSenderNumber)
      setDefaultSenderNumberId(settings.defaultSenderNumberId)
      setConnectionTestPath(settings.connectionTestPath)
      setLoggingEnabled(settings.loggingEnabled)
      setMediaUrlPolicy(settings.mediaUrlPolicy)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const secretKey = useMemo(() => (authType === "api_key" ? "apiKey" : authType === "bearer" ? "apiToken" : authType === "basic" ? "apiToken" : null), [authType])
  const secretConfiguredForType = useMemo(() => {
    if (authType === "basic") return Boolean(secretConfigured) || Boolean(secret)
    return Boolean(secretConfigured) || Boolean(secret)
  }, [authType, secret, secretConfigured])

  function requireCurrentSecret(body: SaveBody) {
    if (!secret) return
    const key = secretKey
    if (key) body[key] = secret
  }

  async function save() {
    setSaving(true)
    try {
      const body: SaveBody = { enabled }
      if (apiBaseUrl.trim()) body.apiBaseUrl = apiBaseUrl.trim()
      body.authType = authType
      body.apiKeyHeader = apiKeyHeader.trim() || "x-api-key"
      body.basicUsername = basicUsername.trim()
      body.requestTimeoutMs = requestTimeoutMs
      body.retryEnabled = retryEnabled
      body.maxRetries = maxRetries
      body.retryDelayMs = retryDelayMs
      body.defaultWabaId = defaultWabaId.trim()
      body.defaultSenderNumber = defaultSenderNumber.trim()
      body.defaultSenderNumberId = defaultSenderNumberId.trim()
      body.connectionTestPath = connectionTestPath.trim() || "/api/whatsapp/phone-numbers"
      body.loggingEnabled = loggingEnabled
      body.mediaUrlPolicy = mediaUrlPolicy
      requireCurrentSecret(body)

      const response = await authFetch("/api/admin/whatsapp-gateway/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await readJsonResponse<{ settings?: PublicSettings }>(response)) || {}
      if (!response.ok) throw new Error(String((data as { error?: string })?.error || "Failed to save settings"))
      toast.success("Settings saved")
      setSecret("")
      const settings = data.settings
      if (settings) setSecretConfigured(settings.authType === "basic" ? settings.apiTokenConfigured : Boolean(settings.apiKeyConfigured || settings.apiTokenConfigured))
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Failed to save settings", key: "gateway-settings-save" })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await authFetch("/api/admin/whatsapp-gateway/test-connection", { method: "POST" })
      const body = (await readJsonResponse<{ result?: { success: boolean; message: string; httpStatus?: number; latencyMs?: number } }>(response)) || {}
      if (!response.ok) throw new Error(String((body as { error?: string })?.error || "Connection test failed"))
      setTestResult(body.result || null)
      if (body.result?.success) toast.success("Connection OK")
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
    } catch (error) {
      dedupedAdminErrorToast({ message: error instanceof Error ? error.message : "Sync failed", key: "gateway-sync" })
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const secretPlaceholder = secretConfiguredForType ? "************" : ""

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Settings2 className="h-4.5 w-4.5" />
          </div>
          <div>
            <CardTitle>Gateway Configuration</CardTitle>
            <CardDescription>Point ZWS Cloud at your external WhatsApp API provider. Secret values are encrypted at rest and never returned by the API.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Gateway enabled</p>
            <p className="text-xs text-muted-foreground">Sends and template creation are blocked while disabled.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="apiBaseUrl">API Base URL</Label>
            <Input id="apiBaseUrl" value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="https://api.provider.example.com" />
            <p className="text-xs text-muted-foreground">Must be an https endpoint reachable from the app container.</p>
          </div>

          <div className="space-y-2">
            <Label>Authentication type</Label>
            <Select value={authType} onValueChange={(value) => setAuthType(value as PublicSettings["authType"])}>
              <SelectTrigger aria-label="Authentication type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="api_key">API key header</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="basic">Basic (username + password)</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {authType === "basic" ? (
            <div className="space-y-2">
              <Label htmlFor="basicUsername">Basic username</Label>
              <Input id="basicUsername" value={basicUsername} onChange={(event) => setBasicUsername(event.target.value)} placeholder="username" />
            </div>
          ) : null}

          {authType === "api_key" ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="apiKeyHeader">API key header name</Label>
              <Input id="apiKeyHeader" value={apiKeyHeader} onChange={(event) => setApiKeyHeader(event.target.value)} placeholder="x-api-key" />
            </div>
          ) : null}

          {secretKey ? (
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="gatewaySecret">{authType === "basic" ? "Basic password" : authType === "api_key" ? "API key" : "Bearer token"}</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="gatewaySecret"
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={secretPlaceholder || `Enter ${authType === "basic" ? "password" : "secret"}`}
                  autoComplete="new-password"
                  className="pl-9"
                />
              </div>
              {secretConfiguredForType ? (
                <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> A secret is already configured. Leave blank to keep it (covering the field with asterisks also keeps it).
                </p>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground sm:col-span-2">
              <KeyRound className="mr-1 inline h-4 w-4" /> No authentication selected.
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold">Defaults</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="defaultWabaId">Default WABA ID</Label>
              <Input id="defaultWabaId" value={defaultWabaId} onChange={(event) => setDefaultWabaId(event.target.value)} placeholder="From sync" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultSenderNumber">Default sender number</Label>
              <Input id="defaultSenderNumber" value={defaultSenderNumber} onChange={(event) => setDefaultSenderNumber(event.target.value)} placeholder="whatsapp_phone_number" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultSenderNumberId">Default sender number ID</Label>
              <Input id="defaultSenderNumberId" value={defaultSenderNumberId} onChange={(event) => setDefaultSenderNumberId(event.target.value)} placeholder="whatsapp_phone_number_id" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 p-4">
          <h3 className="text-sm font-semibold">Behavior</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="requestTimeoutMs">Request timeout (ms)</Label>
              <Input id="requestTimeoutMs" type="number" min={2000} max={120000} value={requestTimeoutMs} onChange={(event) => setRequestTimeoutMs(Number(event.target.value) || 20000)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="connectionTestPath">Connection test path</Label>
              <Input id="connectionTestPath" value={connectionTestPath} onChange={(event) => setConnectionTestPath(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mediaUrlPolicy">Media URL policy</Label>
              <Select value={mediaUrlPolicy} onValueChange={(value) => setMediaUrlPolicy(value as "public" | "any")}>
                <SelectTrigger aria-label="Media URL policy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public only (SSRF guard)</SelectItem>
                  <SelectItem value="any">Accept any URL</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Public-only blocks private, loopback and link-local addresses.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Retry reads</p>
                <p className="text-xs text-muted-foreground">Idempotent GETs retried on transient errors.</p>
              </div>
              <Switch checked={retryEnabled} onCheckedChange={setRetryEnabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxRetries">Max reads retries</Label>
              <Input id="maxRetries" type="number" min={0} max={5} value={maxRetries} onChange={(event) => setMaxRetries(Math.max(0, Math.min(5, Number(event.target.value) || 0)))} disabled={!retryEnabled} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retryDelayMs">Retry delay (ms)</Label>
              <Input id="retryDelayMs" type="number" min={0} max={10000} value={retryDelayMs} onChange={(event) => setRetryDelayMs(Math.max(0, Math.min(10000, Number(event.target.value) || 0)))} disabled={!retryEnabled} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Detailed logging</p>
                <p className="text-xs text-muted-foreground">Trace connection checks and provider responses.</p>
              </div>
              <Switch checked={loggingEnabled} onCheckedChange={setLoggingEnabled} />
            </div>
          </div>
        </div>

        {!enabled ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <CircleAlert className="h-4 w-4 shrink-0" /> The gateway must be enabled before sends, retries or template submissions will work.
          </div>
        ) : null}

        {testResult ? (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-sm",
              testResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5",
            )}
          >
            {testResult.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
            <div className="min-w-0">
              <p className="font-medium">{testResult.message}</p>
              <p className="text-xs text-muted-foreground">HTTP {String(testResult.httpStatus ?? "—")} · {String(testResult.latencyMs ?? "—")}ms</p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button onClick={save} disabled={saving || !apiBaseUrl.trim()}>
            {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            Save Settings
          </Button>
          <Button variant="outline" onClick={testConnection} disabled={testing || !apiBaseUrl.trim()}>
            {testing ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            Test Connection
          </Button>
          <Button variant="outline" onClick={syncConnections} disabled={syncing || !apiBaseUrl.trim()}>
            {syncing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            Sync Connections
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}