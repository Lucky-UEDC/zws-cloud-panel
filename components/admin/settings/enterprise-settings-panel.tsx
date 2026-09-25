"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Activity, CheckCircle2, Copy, ExternalLink, PlugZap, Save, Send, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"

type Settings = Record<string, any>

const endpointBySection = {
  email: "/api/admin/email/smtp",
  infrastructure: "/api/admin/proxmox-nodes",
  analytics: "/api/admin/settings/analytics",
  integrations: "/api/admin/settings/integrations",
} as const

export function EnterpriseSettingsPanel({ section, compactHeader = false }: { section: keyof typeof endpointBySection; compactHeader?: boolean }) {
  const [settings, setSettings] = useState<Settings>({})
  const [saving, setSaving] = useState(false)
  const [runtimeConfig, setRuntimeConfig] = useState<any>(null)
  const [diagnostics, setDiagnostics] = useState<any>(null)
  const [canManageCustomScripts, setCanManageCustomScripts] = useState(false)
  const [testStatus, setTestStatus] = useState<string>("")

  useEffect(() => {
    fetch(endpointBySection[section], { cache: "no-store" })
      .then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(data?.error || "Failed to load settings")
        setSettings(data.settings || {})
        if (data.diagnostics) setDiagnostics(data.diagnostics)
        if (data.runtimeConfig) setRuntimeConfig(data.runtimeConfig)
        setCanManageCustomScripts(Boolean(data.canManageCustomScripts))
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load settings"))
  }, [section])

  function patch(key: string, value: any) {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(endpointBySection[section], {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to save settings")
      setSettings(data.settings || {})
      if (data.runtimeConfig) {
        setRuntimeConfig(data.runtimeConfig)
        broadcastRuntimeConfig(data.runtimeConfig)
      }
      toast.success("Settings saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setSaving(false)
    }
  }

  async function copyConfig() {
    await navigator.clipboard.writeText(JSON.stringify(settings, null, 2))
    toast.success("Configuration copied")
  }

  async function smtpTest() {
    const to = window.prompt("Test recipient email")
    if (!to) return
    const res = await fetch("/api/admin/email/smtp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, config: {
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpSecure: settings.smtpSecure,
        smtpUser: settings.smtpUser,
        smtpPass: settings.smtpPass,
        fromEmail: settings.smtpFrom,
      } }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data?.error || "SMTP test failed")
    toast.success(data?.message || "SMTP test sent")
  }

  async function smtpConnectionTest() {
    const res = await fetch("/api/admin/settings/smtp/check-connection", { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok || data?.checks?.auth?.ok === false) return toast.error(data?.checks?.auth?.error || data?.error || "Connection test failed")
    toast.success("SMTP connection is healthy")
  }

  async function proxmoxTest() {
    const res = await fetch("/api/admin/proxmox/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: settings.proxmoxHost,
        nodeName: settings.proxmoxNode,
        tokenId: settings.proxmoxTokenId,
        tokenSecret: settings.proxmoxTokenSecret,
        allowInsecureTls: settings.proxmoxVerifyTls === false,
      }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data?.error || "Proxmox test failed")
    toast.success("Proxmox connection healthy")
  }

  async function testAnalytics() {
    setTestStatus("Testing runtime analytics")
    try {
      const configResponse = await fetch("/api/runtime/config", { cache: "no-store" })
      const config = await readJsonResponse<any>(configResponse)
      if (!configResponse.ok) throw new Error(config?.error || "Runtime config unavailable")
      setRuntimeConfig(config)
      const opened = window.open("/", "_blank")
      setTimeout(() => {
        try {
          const target = opened
          const targetWindow = target?.window
          const gaId = String(config?.analytics?.gaId || "")
          const hasGtag = Boolean(targetWindow?.gtag)
          const activeId = String(targetWindow?.__ZWS_GA_ID || "")
          const scripts = Array.from(targetWindow?.document?.scripts || [])
          const hasScript = scripts.some((script) => script.src.includes("googletagmanager.com/gtag/js") && script.src.includes(gaId))
          if (!gaId) {
            setTestStatus("No GA ID configured")
            toast.message("Runtime analytics has no GA ID configured")
          } else if (hasGtag && activeId === gaId && hasScript) {
            setTestStatus(`Tag loaded: ${gaId}`)
            toast.success("Analytics tag loaded")
          } else {
            setTestStatus(`Runtime ID ${activeId || "not found"}; script ${hasScript ? "loaded" : "missing"}`)
            toast.error("Analytics tag not fully detected yet")
          }
        } catch {
          setTestStatus("Frontend opened; browser blocked same-window verification")
          toast.message("Frontend opened. Check Tag Assistant or console globals.")
        }
      }, 2500)
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : "Analytics test failed")
      toast.error(error instanceof Error ? error.message : "Analytics test failed")
    }
  }

  async function testIntegration(service: string) {
    const res = await fetch(`/api/admin/integrations/${encodeURIComponent(service)}/test`, { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok || data?.ok === false || data?.result?.ok === false) return toast.error(data?.result?.error || data?.error || "Integration test failed")
    toast.success("Integration test passed")
  }

  return (
    <div className="space-y-6">
      {!compactHeader ? (
        <div>
          <h1 className="text-3xl font-semibold">{titleFor(section)}</h1>
          <p className="mt-1 text-muted-foreground">Database-backed enterprise configuration with encrypted secret storage.</p>
        </div>
      ) : null}
      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>{titleFor(section)}</CardTitle>
          <CardDescription>Secrets are masked after save and are never returned raw to the browser.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {section === "email" ? <EmailFields settings={settings} patch={patch} /> : null}
          {section === "infrastructure" ? <InfrastructureFields settings={settings} patch={patch} /> : null}
          {section === "analytics" ? <AnalyticsFields settings={settings} patch={patch} canManageCustomScripts={canManageCustomScripts} /> : null}
          {section === "integrations" ? <IntegrationFields settings={settings} patch={patch} testIntegration={testIntegration} diagnostics={diagnostics} /> : null}
        </CardContent>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={save} disabled={saving} className="gap-2"><Save className="h-4 w-4" />Save</Button>
          <Button type="button" variant="outline" onClick={copyConfig} className="gap-2"><Copy className="h-4 w-4" />Copy config</Button>
          {section === "email" ? <Button type="button" variant="outline" onClick={smtpConnectionTest} className="gap-2"><PlugZap className="h-4 w-4" />Test connection</Button> : null}
          {section === "email" ? <Button type="button" variant="outline" onClick={smtpTest} className="gap-2"><Send className="h-4 w-4" />Test email</Button> : null}
          {section === "infrastructure" ? <Button type="button" variant="outline" onClick={proxmoxTest} className="gap-2"><PlugZap className="h-4 w-4" />Test Proxmox</Button> : null}
          {section === "analytics" ? <Button type="button" variant="outline" onClick={testAnalytics} className="gap-2"><ExternalLink className="h-4 w-4" />Test Analytics</Button> : null}
        </CardContent>
      </Card>
      {section === "analytics" ? <AnalyticsStatus runtimeConfig={runtimeConfig} settings={settings} testStatus={testStatus} /> : null}
    </div>
  )
}

function broadcastRuntimeConfig(runtimeConfig: any) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("runtime-config", { detail: runtimeConfig }))
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel("runtime-config")
    channel.postMessage(runtimeConfig)
    channel.close()
  }
}

function EmailFields({ settings, patch }: { settings: Settings; patch: (key: string, value: any) => void }) {
  return (
    <>
      <Field label="SMTP host" value={settings.smtpHost || ""} onChange={(value) => patch("smtpHost", value)} />
      <Field label="SMTP port" type="number" value={String(settings.smtpPort || 587)} onChange={(value) => patch("smtpPort", Number(value || 587))} />
      <SwitchField label="SMTP secure" checked={Boolean(settings.smtpSecure)} onChange={(value) => patch("smtpSecure", value)} />
      <Field label="SMTP user" value={settings.smtpUser || ""} onChange={(value) => patch("smtpUser", value)} />
      <Field label="SMTP password" type="password" value={settings.smtpPass || ""} onChange={(value) => patch("smtpPass", value)} />
      <Field label="SMTP from" value={settings.smtpFrom || ""} onChange={(value) => patch("smtpFrom", value)} />
    </>
  )
}

function InfrastructureFields({ settings, patch }: { settings: Settings; patch: (key: string, value: any) => void }) {
  const cloneLimitRows = Array.isArray(settings.nodeCloneLimits) ? settings.nodeCloneLimits : []
  function patchCloneLimit(nodeId: string, value: string) {
    patch("nodeCloneLimits", cloneLimitRows.map((row: any) => row.nodeId === nodeId ? { ...row, maxTasks: Number(value || 1) } : row))
  }

  return (
    <>
      <Field label="Proxmox host" value={settings.proxmoxHost || ""} onChange={(value) => patch("proxmoxHost", value)} />
      <Field label="Proxmox node" value={settings.proxmoxNode || ""} onChange={(value) => patch("proxmoxNode", value)} />
      <Field label="Token ID" value={settings.proxmoxTokenId || ""} onChange={(value) => patch("proxmoxTokenId", value)} />
      <Field label="Token secret" type="password" value={settings.proxmoxTokenSecret || ""} onChange={(value) => patch("proxmoxTokenSecret", value)} />
      <SwitchField label="Verify TLS" checked={settings.proxmoxVerifyTls !== false} onChange={(value) => patch("proxmoxVerifyTls", value)} />
      <Field label="VNC user" value={settings.proxmoxVncUser || ""} onChange={(value) => patch("proxmoxVncUser", value)} />
      <Field label="VNC password" type="password" value={settings.proxmoxVncPassword || ""} onChange={(value) => patch("proxmoxVncPassword", value)} />
      <Field label="RAM block threshold %" type="number" value={String(settings.ramThresholdPercent || 90)} onChange={(value) => patch("ramThresholdPercent", Number(value || 90))} />
      <SwitchField label="Maintenance mode" checked={Boolean(settings.maintenanceMode)} onChange={(value) => patch("maintenanceMode", value)} />
      <SwitchField label="Auto provisioning" checked={settings.autoProvisioningEnabled !== false} onChange={(value) => patch("autoProvisioningEnabled", value)} />
      <SwitchField label="Auto failover" checked={settings.autoFailover !== false} onChange={(value) => patch("autoFailover", value)} />
      {cloneLimitRows.length ? (
        <div className="space-y-3 md:col-span-2">
          <Label>Per-node clone limits</Label>
          <div className="grid gap-3 md:grid-cols-2">
            {cloneLimitRows.map((row: any) => (
              <div key={row.nodeId} className="grid gap-2 rounded-md border border-border/40 p-3">
                <div className="min-w-0 text-sm font-medium">{row.name || row.nodeName}</div>
                <div className="text-xs text-muted-foreground">Active {row.activeTasks || 0} · Queued {row.queuedTasks || 0}</div>
                <Input type="number" min={1} max={100} value={String(row.maxTasks ?? 2)} onChange={(event) => patchCloneLimit(row.nodeId, event.target.value)} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

function AnalyticsFields({
  settings,
  patch,
  canManageCustomScripts,
}: {
  settings: Settings
  patch: (key: string, value: any) => void
  canManageCustomScripts: boolean
}) {
  return (
    <>
      <Field label="Google Analytics ID" value={settings.googleAnalyticsId || ""} onChange={(value) => patch("googleAnalyticsId", value)} placeholder="G-XXXXXXXXXX" />
      <Field label="Meta Pixel ID" value={settings.metaPixelId || ""} onChange={(value) => patch("metaPixelId", value)} placeholder="123456789012345" />
      <Field label="Tawk property path" value={settings.tawkPropertyId || ""} onChange={(value) => patch("tawkPropertyId", value)} placeholder="propertyId/widgetId" />
      <Field label="Crisp website ID" value={settings.crispWebsiteId || ""} onChange={(value) => patch("crispWebsiteId", value)} placeholder="CRISP_WEBSITE_ID" />
      {canManageCustomScripts ? (
        <>
          <TextField label="Custom head script" value={settings.customHeadScript || ""} onChange={(value) => patch("customHeadScript", value)} />
          <TextField label="Custom body script" value={settings.customBodyScript || ""} onChange={(value) => patch("customBodyScript", value)} />
        </>
      ) : null}
    </>
  )
}

const integrationServices = [
  ["exchangeRates", "Exchange Rate API", [["provider", "Provider"], ["appId", "App ID"], ["apiKey", "API key"], ["url", "Endpoint URL"]]],
  ["geoIp", "GeoIP API", [["provider", "Provider"], ["apiKey", "API key"], ["endpoint", "Endpoint URL"], ["url", "Legacy URL"]]],
  ["googleOAuth", "Google OAuth", [["clientId", "Client ID"], ["clientSecret", "Client secret"]]],
  ["googleDriveBackups", "Google Drive Backups", [["enabled", "Enabled"], ["clientId", "Client ID"], ["clientSecret", "Client secret"], ["refreshToken", "Refresh token"], ["folderId", "Folder ID"], ["folderName", "Folder name"], ["scheduleInterval", "Schedule interval"]]],
  ["smtp", "SMTP", [["smtpHost", "Host"], ["smtpPort", "Port"], ["smtpSecure", "Secure"], ["smtpUser", "User"], ["smtpPass", "Password"], ["smtpFrom", "From email"]]],
  ["googleSearchConsole", "Google Search Console", [["siteUrl", "Site URL"], ["serviceAccountJson", "Service account JSON"]]],
  ["googleAnalytics", "Google Analytics", [["measurementId", "Measurement ID"]]],
  ["cloudflareAnalytics", "Cloudflare Analytics", [["accountId", "Account ID"], ["zoneId", "Zone ID"], ["apiToken", "API token"], ["email", "Account email"]]],
  ["whatsappApi", "WhatsApp API", [["provider", "Provider"], ["apiKey", "API key"], ["phoneNumberId", "Phone number ID"], ["webhookSecret", "Webhook secret"]]],
  ["telegramApi", "Telegram API", [["botUsername", "Bot username"], ["token", "Bot token"]]],
  ["backups", "Backups", [["provider", "Provider"], ["remote", "Rclone remote"], ["retentionDays", "Retention days"], ["scheduleInterval", "Schedule interval"], ["scope", "Scope"], ["config", "Rclone config"]]],
  ["redisOverrides", "Redis Overrides", [["url", "Redis URL"], ["tls", "TLS mode"]]],
] as const

function IntegrationFields({ settings, patch, testIntegration, diagnostics }: { settings: Settings; patch: (key: string, value: any) => void; testIntegration: (service: string) => void; diagnostics?: any }) {
  function update(service: string, key: string, value: string) {
    const normalized = key === "enabled" || key === "smtpSecure" ? value === "true" : key === "smtpPort" || key === "retentionDays" ? Number(value || 0) : value
    patch(service, { ...(settings[service] || {}), [key]: normalized })
  }
  return (
    <>
      {integrationServices.map(([service, title, fields]) => (
        <div key={service} className="space-y-3 rounded-lg border border-border/40 bg-background/35 p-4 md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{title}</h2>
            <Button type="button" size="sm" variant="outline" onClick={() => testIntegration(service)}>Test</Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {service === "googleOAuth" && diagnostics?.googleOAuth ? (
              <div className="md:col-span-2 space-y-2 rounded-md border border-border/40 bg-background/40 p-3 text-xs">
                <div><span className="text-muted-foreground">Login callback:</span> <code className="break-all">{diagnostics.googleOAuth.loginCallback}</code></div>
                <div><span className="text-muted-foreground">Drive callback:</span> <code className="break-all">{diagnostics.googleOAuth.driveCallback}</code></div>
              </div>
            ) : null}
            {fields.map(([key, label]) => (
              key === "enabled" || key === "smtpSecure" ? (
                <SwitchField key={key} label={label} checked={Boolean(settings[service]?.[key])} onChange={(value) => update(service, key, String(value))} />
              ) :
              key === "serviceAccountJson" ? (
                <TextField key={key} label={label} value={String(settings[service]?.[key] || "")} onChange={(value) => update(service, key, value)} />
              ) : (
                <Field key={key} label={label} type={/key|secret|token|password|json|url/i.test(key) && key !== "url" ? "password" : "text"} value={String(settings[service]?.[key] || "")} onChange={(value) => update(service, key, value)} />
              )
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

function AnalyticsStatus({ runtimeConfig, settings, testStatus }: { runtimeConfig: any; settings: Settings; testStatus: string }) {
  const [loadedId, setLoadedId] = useState("")
  useEffect(() => {
    const update = () => setLoadedId(String((window as any).__ZWS_GA_ID || ""))
    update()
    window.addEventListener("zws:runtime-analytics-updated", update)
    return () => window.removeEventListener("zws:runtime-analytics-updated", update)
  }, [])
  const analytics = runtimeConfig?.analytics || {}
  const currentId = analytics.gaId || settings.googleAnalyticsId || ""
  const active = Boolean(currentId || analytics.metaPixelId || analytics.tawkPropertyId || analytics.crispWebsiteId || analytics.customHeadScript || analytics.customBodyScript)
  const loaded = !currentId || loadedId === currentId
  return (
    <Card className="glass border-border/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Live Status</CardTitle>
        <CardDescription>Runtime tracking state from the active database config.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        <StatusRow label="Analytics Active" value={active ? "Active" : "Inactive"} ok={active} />
        <StatusRow label="Tag Loaded" value={loaded ? "Loaded" : "Pending"} ok={loaded} />
        <StatusRow label="Last Updated" value={analytics.updatedAt || settings.analyticsUpdatedAt || "Not updated"} />
        <StatusRow label="Current Runtime ID" value={currentId || "Not configured"} />
        {testStatus ? <StatusRow label="Test Analytics" value={testStatus} /> : null}
      </CardContent>
    </Card>
  )
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-sm font-medium">
        {ok === undefined ? null : ok ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
        <span className="truncate">{value}</span>
      </span>
    </div>
  )
}

function Field({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2 md:col-span-2">
      <Label>{label}</Label>
      <Textarea className="min-h-32 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function SwitchField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function titleFor(section: keyof typeof endpointBySection) {
  if (section === "email") return "Email Settings"
  if (section === "infrastructure") return "Infrastructure Settings"
  if (section === "integrations") return "Runtime Integrations"
  return "Analytics Settings"
}
