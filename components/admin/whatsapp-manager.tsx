"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { CheckCircle2, RefreshCw, Save, Send, TestTube2, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

type FailsafeSettings = {
  mode: "none" | "log_only" | "mark_failed" | "notify_admin"
  notifyAdminEmail: string
}

type Settings = {
  provider: "evolution"
  serverUrl: string
  instanceId: string
  instanceName: string
  webhookUrl: string
  testRecipient: string
  apiKeyConfigured: boolean
  instanceTokenConfigured: boolean
  webhookSecretConfigured: boolean
  enabled: boolean
  failsafe: FailsafeSettings
}

const DEFAULT_TEST_RECIPIENT = "+919348487611"

const emptySettings: Settings = {
  provider: "evolution",
  serverUrl: "",
  instanceId: "",
  instanceName: "",
  webhookUrl: "",
  testRecipient: DEFAULT_TEST_RECIPIENT,
  apiKeyConfigured: false,
  instanceTokenConfigured: false,
  webhookSecretConfigured: false,
  enabled: true,
  failsafe: { mode: "none", notifyAdminEmail: "" },
}

export function WhatsAppManager() {
  const [settings, setSettings] = useState<Settings>(emptySettings)
  const [secrets, setSecrets] = useState({ apiKey: "", instanceToken: "", webhookSecret: "" })
  const [status, setStatus] = useState<any>(null)
  const [connectionResult, setConnectionResult] = useState<any>(null)
  const [testMessageSent, setTestMessageSent] = useState(false)
  const [message, setMessage] = useState("MyRDPHub Evolution API test message.")
  const [busy, setBusy] = useState("")

  const connected = Boolean(connectionResult ? connectionResult.connected : status?.connected)
  const apiValid = Boolean(connectionResult ? connectionResult.apiValid : status?.evolution?.apiValid)
  const instanceFound = Boolean(connectionResult ? connectionResult.instanceFound : status?.evolution?.instanceFound)
  const instanceId = settings.instanceId || settings.instanceName
  const statusLabel = useMemo(() => {
    if (connectionResult?.status) return connectionResult.status
    if (!settings.serverUrl || !instanceId || !settings.apiKeyConfigured) return "Not Configured"
    return connected ? "Connected" : status?.healthReason || status?.runtimeStatus || "Disconnected"
  }, [connected, connectionResult, instanceId, settings.apiKeyConfigured, settings.serverUrl, status])

  const load = useCallback(async () => {
    setBusy("load")
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch("/api/admin/whatsapp/settings", { cache: "no-store" }),
        fetch("/api/admin/whatsapp/status", { cache: "no-store" }),
      ])
      const settingsData = await readJsonResponse<any>(settingsRes)
      const statusData = await readJsonResponse<any>(statusRes)
      if (!settingsRes.ok) throw new Error(settingsData?.error || "Failed to load WhatsApp settings")
      if (!statusRes.ok) throw new Error(statusData?.error || "Failed to load WhatsApp status")
      setSettings({ ...emptySettings, ...(settingsData.settings || {}), testRecipient: settingsData.settings?.testRecipient || DEFAULT_TEST_RECIPIENT })
      setStatus(statusData)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load WhatsApp")
    } finally {
      setBusy("")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function patch(key: keyof Settings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  function patchFailsafe(key: keyof FailsafeSettings, value: string) {
    setSettings((current) => ({ ...current, failsafe: { ...current.failsafe, [key]: value } }))
  }

  async function save() {
    setBusy("save")
    try {
      const res = await fetch("/api/admin/whatsapp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          instanceId,
          enabled: settings.enabled,
          failsafe: settings.failsafe,
          apiKey: secrets.apiKey || (settings.apiKeyConfigured ? "********" : ""),
          instanceToken: secrets.instanceToken || (settings.instanceTokenConfigured ? "********" : ""),
          webhookSecret: secrets.webhookSecret || (settings.webhookSecretConfigured ? "********" : ""),
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to save WhatsApp settings")
      setSettings({ ...emptySettings, ...(data.settings || {}), testRecipient: data.settings?.testRecipient || DEFAULT_TEST_RECIPIENT })
      setSecrets({ apiKey: "", instanceToken: "", webhookSecret: "" })
      setConnectionResult(null)
      toast.success("Evolution settings saved")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save WhatsApp settings")
    } finally {
      setBusy("")
    }
  }

  async function testConnection() {
    setBusy("connection")
    try {
      const res = await fetch("/api/admin/whatsapp/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverUrl: settings.serverUrl,
          instanceId,
          apiKey: secrets.apiKey || (settings.apiKeyConfigured ? "********" : ""),
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Failed to test Evolution connection")
      setConnectionResult(data.result)
      if (data.result?.status === "Connected") toast.success("Evolution API connected")
      else toast.warning(data.result?.status || "Evolution API disconnected")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to test Evolution connection")
    } finally {
      setBusy("")
    }
  }

  async function sendTest() {
    setBusy("test")
    try {
      const res = await fetch("/api/admin/whatsapp/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, phone: settings.testRecipient || DEFAULT_TEST_RECIPIENT }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.ok === false) throw new Error(data?.error || "Failed to send test message")
      setTestMessageSent(true)
      toast.success(`Test Message Sent: ${data.messageId || "accepted"}`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test message")
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">WhatsApp</h1>
          <p className="mt-1 text-muted-foreground">Evolution API instance status, webhook configuration, and delivery test.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={busy === "load"} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button variant="outline" onClick={() => void testConnection()} disabled={busy === "connection"} className="gap-2"><TestTube2 className="h-4 w-4" />Test Connection</Button>
          <Button onClick={() => void save()} disabled={busy === "save"} className="gap-2"><Save className="h-4 w-4" />Save</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatusCard label="Connected" value={statusLabel} ok={connected} />
        <StatusCard label="API Valid" value={apiValid ? "API Valid" : "Check API Key"} ok={apiValid} />
        <StatusCard label="Instance Found" value={instanceFound ? "Instance Found" : "Instance Missing"} ok={instanceFound} />
        <StatusCard label="Test Message" value={testMessageSent ? "Test Message Sent" : "Not sent"} ok={testMessageSent} />
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Evolution API Settings</CardTitle>
          <CardDescription>Secrets are encrypted in runtime integration storage and masked after save.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Server URL"><Input value={settings.serverUrl} onChange={(event) => patch("serverUrl", event.target.value)} placeholder="evolution-api-production-88a1.up.railway.app" /></Field>
          <Field label="Global API Key"><Input type="password" value={secrets.apiKey} onChange={(event) => setSecrets((current) => ({ ...current, apiKey: event.target.value }))} placeholder={settings.apiKeyConfigured ? "Configured" : "Paste global API key"} /></Field>
          <Field label="Instance ID"><Input value={instanceId} onChange={(event) => patch("instanceId", event.target.value)} placeholder="c301cf4e-e992-42cd-b298-20fc6758b489" /></Field>
          <Field label="Instance Token"><Input type="password" value={secrets.instanceToken} onChange={(event) => setSecrets((current) => ({ ...current, instanceToken: event.target.value }))} placeholder={settings.instanceTokenConfigured ? "Configured" : "Paste instance token"} /></Field>
          <Field label="Webhook URL"><Input value={settings.webhookUrl || ""} readOnly placeholder="https://domain.com/api/webhooks/evolution" /></Field>
          <Field label="Webhook Secret"><Input type="password" value={secrets.webhookSecret} onChange={(event) => setSecrets((current) => ({ ...current, webhookSecret: event.target.value }))} placeholder={settings.webhookSecretConfigured ? "Configured" : "Optional webhook secret"} /></Field>
          <Field label="Test Recipient"><Input value={settings.testRecipient || ""} onChange={(event) => patch("testRecipient", event.target.value)} placeholder={DEFAULT_TEST_RECIPIENT} /></Field>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Delivery & Failsafe</CardTitle>
          <CardDescription>Single master switch for all WhatsApp sends, plus optional provider-failure handling.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>WhatsApp delivery enabled</Label>
              <p className="text-sm text-muted-foreground">When off, no WhatsApp message is sent from any flow (settings, provisioning, notifications).</p>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={(checked) => setSettings((current) => ({ ...current, enabled: checked }))} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Failsafe on provider failure">
              <Select value={settings.failsafe.mode} onValueChange={(mode) => patchFailsafe("mode", mode as string)}>
                <SelectTrigger><SelectValue placeholder="Select failsafe mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (default behavior)</SelectItem>
                  <SelectItem value="log_only">Log only</SelectItem>
                  <SelectItem value="mark_failed">Mark as failed</SelectItem>
                  <SelectItem value="notify_admin">Notify admin by email</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Admin notification email">
              <Input value={settings.failsafe.notifyAdminEmail || ""} onChange={(event) => patchFailsafe("notifyAdminEmail", event.target.value)} placeholder="admin@yourdomain.com" />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Send Test Message</CardTitle>
          <CardDescription>Uses the configured test recipient and stores the result in WhatsApp logs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} />
          <Button onClick={() => void sendTest()} disabled={busy === "test" || !message.trim()} className="gap-2">
            <Send className="h-4 w-4" />
            {busy === "test" ? "Sending" : "Send Test Message"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StatusCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <Card className="glass border-border/40">
      <CardContent className="flex min-h-28 flex-col justify-between p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-amber-400" />}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Badge variant={ok ? "default" : "secondary"}>{ok ? "OK" : "Check"}</Badge>
          <span className="truncate text-sm font-medium">{value}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
