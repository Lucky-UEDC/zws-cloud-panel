"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { readJsonResponse } from "@/lib/client/safe-json"
import { TurnstileWidget, type TurnstileMode } from "@/components/security/turnstile-widget"

type CloudflareMode = "OFF" | "LOW" | "MEDIUM" | "HIGH" | "ENTERPRISE"

type SecurityStatus = {
  totalRequests?: number
  blockedRequests?: number
  captchaPasses?: number
  captchaFailures?: number
  averageRiskScore?: number
  ipBans?: number
  falsePositives?: number
  verificationApi?: "not_tested" | "reachable" | "failed"
  lastVerificationAt?: string | Date | null
  lastVerificationStatus?: string | null
}

type SecuritySettings = {
  enabled: boolean
  mode: CloudflareMode
  turnstileEnabled: boolean
  turnstileSiteKey: string
  turnstileSecretKey: string
  turnstileMode: TurnstileMode
  protectLogin: boolean
  protectRegister: boolean
  protectForgotPassword: boolean
  protectContact: boolean
  protectCheckout: boolean
  protectSupport: boolean
  protectOrders: boolean
  protectAdminLogin: boolean
  whitelistEnabled: boolean
  whitelistIPs: string[]
  whitelistCIDRs: string[]
  whitelistEmails: string[]
  whitelistCustomerIds: string[]
  rateLimitEnabled: boolean
  riskScoringEnabled: boolean
  botDetectionEnabled: boolean
  turnstileConfigured: boolean
  updatedAt?: string | Date
  status?: SecurityStatus
}

const DEFAULT_TURNSTILE_SITE_KEY = "0x4AAAAAADWxH2D7FCHNJm7H"
const DEFAULT_TURNSTILE_SECRET_KEY = "0x4AAAAAADWxHz2mIZT8AgKlat5NRdFUAXc"
const siteKeyPattern = /^0x[A-Za-z0-9_-]{20,120}$/
const secretKeyPattern = /^0x[A-Za-z0-9_-]{20,180}$/

const modeOptions: Array<{ value: CloudflareMode; label: string }> = [
  { value: "OFF", label: "OFF - Basic security only" },
  { value: "LOW", label: "LOW - Captcha only" },
  { value: "MEDIUM", label: "MEDIUM - Captcha + rate limit" },
  { value: "HIGH", label: "HIGH - Captcha + rate limit + risk scoring" },
  { value: "ENTERPRISE", label: "ENTERPRISE - Full protection" },
]

const protectOptions: Array<{ key: keyof SecuritySettings; label: string }> = [
  { key: "protectLogin", label: "Login" },
  { key: "protectRegister", label: "Register" },
  { key: "protectForgotPassword", label: "Forgot Password" },
  { key: "protectContact", label: "Contact Form" },
  { key: "protectCheckout", label: "Checkout" },
  { key: "protectSupport", label: "Support Tickets" },
  { key: "protectOrders", label: "Create Order" },
  { key: "protectAdminLogin", label: "Admin Login" },
]

function masked(value: string) {
  return value === "__MASKED__" || value.startsWith("••••")
}

function listText(value?: string[]) {
  return (value || []).join(", ")
}

function parseList(value: string) {
  return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean)
}

function validateDraft(settings: SecuritySettings | null) {
  if (!settings) return {}
  const errors: Record<string, string> = {}
  const siteKey = settings.turnstileSiteKey.trim()
  const secretKey = settings.turnstileSecretKey.trim()
  if (!["OFF", "LOW", "MEDIUM", "HIGH", "ENTERPRISE"].includes(settings.mode)) errors.mode = "Choose a valid security mode."
  if (!["managed", "invisible", "non_interactive"].includes(settings.turnstileMode)) errors.turnstileMode = "Choose a valid captcha mode."
  if (siteKey && !siteKeyPattern.test(siteKey)) errors.turnstileSiteKey = "Site key must start with 0x and use only key-safe characters."
  if (secretKey && !masked(secretKey) && !secretKeyPattern.test(secretKey)) errors.turnstileSecretKey = "Secret key must start with 0x and use only key-safe characters."
  if (settings.enabled && settings.mode !== "OFF" && !siteKey) errors.turnstileSiteKey = "Site key is required when Cloudflare protection is enabled."
  if (settings.enabled && settings.mode !== "OFF" && !secretKey) errors.turnstileSecretKey = "Secret key is required when Cloudflare protection is enabled."
  return errors
}

function statusLabel(settings: SecuritySettings | null) {
  if (!settings?.enabled || settings.mode === "OFF") return "OFF"
  return settings.turnstileConfigured ? settings.mode : "NEEDS KEYS"
}

function statusVariant(label: string): "default" | "destructive" | "outline" {
  if (label === "NEEDS KEYS") return "destructive"
  if (label === "OFF") return "outline"
  return "default"
}

function formatDate(value?: string | Date | null) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString()
}

export function TurnstileSettingsCard({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<SecuritySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [testToken, setTestToken] = useState("")
  const [verificationApi, setVerificationApi] = useState<SecurityStatus["verificationApi"]>("not_tested")
  const errors = useMemo(() => validateDraft(settings), [settings])
  const readySiteKey = Boolean(settings?.turnstileSiteKey && siteKeyPattern.test(settings.turnstileSiteKey))
  const currentStatus = statusLabel(settings)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/security/settings", { cache: "no-store" })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Unable to load Cloudflare security settings")
      setSettings({
        ...data.settings,
        enabled: Boolean(data.settings?.enabled),
        mode: data.settings?.mode || "OFF",
        turnstileSiteKey: data.settings?.turnstileSiteKey || DEFAULT_TURNSTILE_SITE_KEY,
        turnstileSecretKey: data.settings?.turnstileSecretKey || DEFAULT_TURNSTILE_SECRET_KEY,
        whitelistIPs: data.settings?.whitelistIPs || [],
        whitelistCIDRs: data.settings?.whitelistCIDRs || [],
        whitelistEmails: data.settings?.whitelistEmails || [],
        whitelistCustomerIds: data.settings?.whitelistCustomerIds || [],
      })
      setVerificationApi(data.settings?.status?.verificationApi || "not_tested")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load Cloudflare security settings")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function update<K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current)
    if (key === "turnstileSiteKey" || key === "turnstileSecretKey") {
      setTestToken("")
      setVerificationApi("not_tested")
    }
  }

  function updateProtectionEnabled(value: boolean) {
    setSettings((current) => current ? {
      ...current,
      enabled: value,
      mode: value ? (current.mode === "OFF" ? "LOW" : current.mode) : "OFF",
    } : current)
  }

  async function save() {
    if (!settings) return
    if (Object.keys(errors).length) return toast.error("Fix the Cloudflare security validation errors before saving.")
    setSaving(true)
    try {
      const res = await fetch("/api/admin/security/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Unable to save Cloudflare security settings")
      setSettings(data.settings)
      setTestToken("")
      setVerificationApi(data.settings?.status?.verificationApi || "not_tested")
      toast.success("Cloudflare security settings saved")
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zws-turnstile-settings-saved", { detail: data.settings }))
      }
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save Cloudflare security settings")
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    if (!settings) return
    if (Object.keys(errors).length) return toast.error("Fix the Turnstile key validation errors before testing.")
    setTesting(true)
    try {
      const res = await fetch("/api/admin/security/turnstile/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteKey: settings.turnstileSiteKey,
          secretKey: settings.turnstileSecretKey,
          token: testToken,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Turnstile verification failed")
      setVerificationApi("reachable")
      setSettings((current) => current ? {
        ...current,
        status: {
          ...current.status,
          verificationApi: "reachable",
          lastVerificationAt: new Date().toISOString(),
          lastVerificationStatus: "success",
        },
      } : current)
      setTestToken("")
      toast.success("Turnstile connection verified")
    } catch (error) {
      setVerificationApi("failed")
      setSettings((current) => current ? {
        ...current,
        status: {
          ...current.status,
          verificationApi: "failed",
          captchaFailures: (current.status?.captchaFailures || 0) + 1,
          lastVerificationAt: new Date().toISOString(),
          lastVerificationStatus: "failed",
        },
      } : current)
      toast.error(error instanceof Error ? error.message : "Turnstile verification failed")
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="glass border-border/40">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Cloudflare Security</CardTitle>
            <CardDescription>Runtime controls for Turnstile, rate limits, bot signals, page protection, and trusted users.</CardDescription>
          </div>
          <Badge variant={statusVariant(currentStatus)}>{currentStatus}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? <p className="text-sm text-muted-foreground">Loading Cloudflare security settings...</p> : null}
        {settings ? (
          <>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
              <StatusTile label="Total Requests" value={String(settings.status?.totalRequests || 0)} />
              <StatusTile label="Blocked Requests" value={String(settings.status?.blockedRequests || 0)} />
              <StatusTile label="Captcha Passes" value={String(settings.status?.captchaPasses || 0)} />
              <StatusTile label="Captcha Failures" value={String(settings.status?.captchaFailures || 0)} />
              <StatusTile label="Risk Score" value={String(settings.status?.averageRiskScore || 0)} />
              <StatusTile label="IP Bans" value={String(settings.status?.ipBans || 0)} />
              <StatusTile label="False Positives" value={String(settings.status?.falsePositives || 0)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/40 p-3">
                <div>
                  <Label htmlFor="cloudflare-enabled">Cloudflare Protection</Label>
                  <p className="mt-1 text-xs text-muted-foreground">When off, Turnstile, Cloudflare rate limits, bot signals, and risk checks are bypassed.</p>
                </div>
                <Switch id="cloudflare-enabled" checked={settings.enabled && settings.mode !== "OFF"} onCheckedChange={updateProtectionEnabled} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cloudflare-mode">Security Mode</Label>
                <Select value={settings.mode || "OFF"} onValueChange={(value) => update("mode", value as CloudflareMode)}>
                  <SelectTrigger id="cloudflare-mode" aria-invalid={Boolean(errors.mode)}>
                    <SelectValue placeholder="OFF" />
                  </SelectTrigger>
                  <SelectContent>
                    {modeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                {errors.mode ? <p className="text-xs text-destructive">{errors.mode}</p> : null}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Site Key" error={errors.turnstileSiteKey} help="This key is safe to expose to public forms through runtime config.">
                <Input id="turnstile-site-key" value={settings.turnstileSiteKey} onChange={(event) => update("turnstileSiteKey", event.target.value.trim())} placeholder="0x..." aria-invalid={Boolean(errors.turnstileSiteKey)} />
              </Field>
              <Field label="Secret Key" error={errors.turnstileSecretKey} help="Stored encrypted and masked after save. Existing masked secrets are preserved.">
                <div className="relative">
                  <Input id="turnstile-secret-key" type={showSecret ? "text" : "password"} value={settings.turnstileSecretKey} onChange={(event) => update("turnstileSecretKey", event.target.value.trim())} placeholder="0x..." className="pr-10" aria-invalid={Boolean(errors.turnstileSecretKey)} />
                  <button type="button" onClick={() => setShowSecret((value) => !value)} className="absolute inset-y-0 right-2 flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label={showSecret ? "Hide Turnstile secret key" : "Show Turnstile secret key"}>
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <div className="space-y-2">
                <Label htmlFor="turnstile-mode">Captcha Mode</Label>
                <Select value={settings.turnstileMode || "managed"} onValueChange={(value) => update("turnstileMode", value as TurnstileMode)}>
                  <SelectTrigger id="turnstile-mode" aria-invalid={Boolean(errors.turnstileMode)}>
                    <SelectValue placeholder="Managed" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="managed">Managed</SelectItem>
                    <SelectItem value="invisible">Invisible</SelectItem>
                    <SelectItem value="non_interactive">Non-interactive</SelectItem>
                  </SelectContent>
                </Select>
                {errors.turnstileMode ? <p className="text-xs text-destructive">{errors.turnstileMode}</p> : null}
              </div>
              <div className="space-y-2 rounded-lg border border-border/40 p-3">
                <Label>Per Page Protection</Label>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {protectOptions.map((option) => (
                    <label key={String(option.key)} className="flex items-center gap-2 rounded-md border border-border/30 px-3 py-2 text-sm">
                      <Checkbox checked={Boolean(settings[option.key])} onCheckedChange={(value) => update(option.key, Boolean(value) as any)} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border/40 p-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="whitelist-enabled">Trusted Users</Label>
                  <Switch id="whitelist-enabled" checked={settings.whitelistEnabled} onCheckedChange={(value) => update("whitelistEnabled", value)} />
                </div>
                <Field label="Emails"><Input value={listText(settings.whitelistEmails)} onChange={(event) => update("whitelistEmails", parseList(event.target.value))} placeholder="client@example.com, admin@example.com" /></Field>
                <Field label="Customer IDs"><Input value={listText(settings.whitelistCustomerIds)} onChange={(event) => update("whitelistCustomerIds", parseList(event.target.value))} placeholder="customer ids separated by commas" /></Field>
                <Field label="IP Addresses"><Input value={listText(settings.whitelistIPs)} onChange={(event) => update("whitelistIPs", parseList(event.target.value))} placeholder="203.0.113.10, 198.51.100.20" /></Field>
                <Field label="CIDR Ranges"><Input value={listText(settings.whitelistCIDRs)} onChange={(event) => update("whitelistCIDRs", parseList(event.target.value))} placeholder="203.0.113.0/24" /></Field>
              </div>
              <div className="space-y-3 rounded-lg border border-border/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={verificationApi === "reachable" ? "default" : verificationApi === "failed" ? "destructive" : "outline"}>
                    Verification API: {verificationApi === "not_tested" ? "Not tested" : verificationApi}
                  </Badge>
                  <span className="text-sm text-muted-foreground">Last check: {formatDate(settings.status?.lastVerificationAt)}</span>
                </div>
                <TurnstileWidget value={testToken} onChange={setTestToken} action="admin_turnstile_test" enabled={readySiteKey} siteKey={settings.turnstileSiteKey} mode={settings.turnstileMode} />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={testConnection} variant="outline" disabled={testing || !readySiteKey || !settings.turnstileSecretKey || !testToken || Object.keys(errors).length > 0}>
                    {testing ? "Testing..." : "Test Connection"}
                  </Button>
                  <Button onClick={save} disabled={saving || Object.keys(errors).length > 0}>
                    {saving ? "Saving..." : "Save Settings"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Field({ label, children, error, help }: { label: string; children: React.ReactNode; error?: string; help?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  )
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/35 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  )
}
