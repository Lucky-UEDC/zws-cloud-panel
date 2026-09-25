"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Clipboard, CreditCard, Eye, EyeOff, RefreshCw, Save, TestTube2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { authFetch } from "@/lib/client/auth-fetch"
import { readJsonResponse } from "@/lib/client/safe-json"

const providers = [
  { value: "razorpay", label: "Razorpay" },
  { value: "phonepe", label: "PhonePe" },
  { value: "cashfree", label: "Cashfree" },
]

type Gateway = {
  id: string
  code: string
  provider: string
  name: string
  displayName: string
  enabled: boolean
  mode: string
  priority: number
  failsafeEnabled: boolean
  credentials?: Record<string, string>
  callbackUrl?: string | null
  webhookUrl?: string | null
  lastHealthStatus?: string | null
  lastTestAt?: string | null
  lastWebhookStatus?: string | null
  lastPaymentStatus?: string | null
  lastError?: string | null
  missingCredentialFields?: string[]
  credentialsStatus?: string
  runtimeStatus?: string
  healthState?: "healthy" | "warning" | "error" | "disabled"
  createdAt?: string
  updatedAt?: string
}

function defaultGateway(code: string): Gateway {
  const provider = providers.find((item) => item.value === code)
  return {
    id: "",
    code,
    provider: code,
    name: provider?.label || code,
    displayName: provider?.label || code,
    enabled: false,
    mode: "test",
    priority: code === "razorpay" ? 10 : code === "phonepe" ? 20 : 30,
    failsafeEnabled: true,
    credentials: {},
  }
}

const PROVIDER_CREDENTIAL_FIELDS: Record<string, { secret: [string, string][]; normal: [string, string][] }> = {
  razorpay: {
    secret: [["keySecret", "Key Secret"], ["webhookSecret", "Webhook Secret"]],
    normal: [["keyId", "Key ID"]],
  },
  cashfree: {
    secret: [["secretKey", "Secret Key"], ["webhookSecret", "Webhook Secret"]],
    normal: [["appId", "App ID"], ["apiVersion", "API Version"], ["clientVersion", "Client Version"]],
  },
  phonepe: {
    secret: [["clientSecret", "Client Secret"], ["webhookPassword", "Webhook Password"]],
    normal: [["merchantId", "Merchant ID"], ["clientId", "Client ID"], ["clientVersion", "Client Version"], ["webhookUsername", "Webhook Username"]],
  },
}

const BRANDED_PROVIDERS = new Set(["razorpay", "cashfree"])
const MASK_ONLY_PATTERN = /^[•*]+$/
const THEME_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const MERCHANT_NAME_MAX_LENGTH = 120
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"]
const LOGO_MAX_SIZE = 5 * 1024 * 1024

function expandHex(value: string) {
  const trimmed = String(value || "").trim()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
  return trimmed
}

function credentialFields(provider: string) {
  return PROVIDER_CREDENTIAL_FIELDS[provider] || { secret: [], normal: [] }
}

function paymentGatewayError(data: any, fallback: string) {
  if (data?.code === "recent_mfa_required" || data?.code === "mfa_required") {
    return "Recent MFA is required because MFA enforcement is enabled. Verify MFA from Account Security, then retry."
  }
  return data?.error || data?.message || fallback
}

export default function PaymentGatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [primaryDomain, setPrimaryDomain] = useState<any>(null)
  const [form, setForm] = useState<Gateway>(defaultGateway("razorpay"))
  const [drafts, setDrafts] = useState<Record<string, Gateway>>({})
  const [revealedCredentials, setRevealedCredentials] = useState<Record<string, boolean>>({})
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [logoState, setLogoState] = useState<{ uploading: boolean; error: string | null }>({ uploading: false, error: null })
  const selected = useMemo(() => gateways.find((item) => item.code === form.code) || null, [gateways, form.code])

  async function load() {
    const res = await authFetch("/api/admin/payments/gateways", { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(paymentGatewayError(data, "Failed to load payment gateways"))
      return
    }
    const nextGateways = (data.gateways || []) as Gateway[]
    setGateways(nextGateways)
    setPrimaryDomain(data.primaryDomain || null)
    setDrafts((current) => {
      const next = { ...current }
      for (const gateway of nextGateways) {
        if (!next[gateway.code]) next[gateway.code] = { ...gateway, credentials: gateway.credentials || {} }
      }
      return next
    })
    const current = nextGateways.find((item) => item.code === form.code) || nextGateways[0]
    if (current) {
      setForm((existing) => drafts[current.code] || { ...current, credentials: current.credentials || existing.credentials || {} })
    }
  }

  useEffect(() => {
    void load()
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("payment-runtime-sync") : null
    channel?.addEventListener("message", () => void load())
    const onStorage = (event: StorageEvent) => {
      if (event.key === "payment-runtime-sync") void load()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      channel?.close()
      window.removeEventListener("storage", onStorage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function selectGateway(code: string) {
    const found = gateways.find((item) => item.code === code)
    setDrafts((current) => ({ ...current, [form.code]: form }))
    setForm(drafts[code] || (found ? { ...found, credentials: found.credentials || {} } : defaultGateway(code)))
  }

  function updateCredential(key: string, value: string) {
    setForm((current) => {
      const next = { ...current, credentials: { ...(current.credentials || {}), [key]: value } }
      setDrafts((draft) => ({ ...draft, [next.code]: next }))
      return next
    })
  }

  async function revealCredential(key: string) {
    const cacheKey = `${form.code}:${key}`
    const revealing = !revealedCredentials[cacheKey]
    if (revealing) {
      if (!form.id) {
        toast.error("Save this gateway first, then reveal its credentials.")
        return
      }
      const res = await authFetch(`/api/admin/payment-gateways/${form.id}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: key }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.ok === false) {
        toast.error(paymentGatewayError(data, "Could not reveal credential"))
        return
      }
      setRevealedValues((current) => ({ ...current, [cacheKey]: String(data.value || "") }))
    }
    setRevealedCredentials((current) => ({ ...current, [cacheKey]: revealing }))
  }

  function updateForm(patch: Partial<Gateway>) {
    setForm((current) => {
      const next = { ...current, ...patch }
      setDrafts((draft) => ({ ...draft, [next.code]: next }))
      return next
    })
  }

  async function save() {
    if (!form.id) {
      toast.error("Gateway ID is missing. Refresh gateways before saving.")
      return
    }
    const errors = validateForm()
    if (Object.keys(errors).length) {
      toast.error(`Cannot save: ${Object.values(errors).join(" ")}`)
      return
    }
    const payload = {
      ...form,
      credentials: stripMaskedSecrets(form.credentials || {}),
    }
    const res = await authFetch(`/api/admin/payment-gateways/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(paymentGatewayError(data, "Failed to save gateway"))
      return
    }
    toast.success("✓ Gateway settings saved")
    const nextGateway = { ...data.gateway, credentials: data.gateway?.credentials || {} }
    setForm(nextGateway)
    setDrafts((current) => ({ ...current, [nextGateway.code]: nextGateway }))
    setGateways((current) => current.map((gateway) => gateway.code === nextGateway.code ? nextGateway : gateway))
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("payment-runtime-sync")
      channel.postMessage({ type: "payment-gateways:update", gateway: nextGateway.code, at: Date.now() })
      channel.close()
    }
    localStorage.setItem("payment-runtime-sync", String(Date.now()))
    await load()
  }

  async function testGateway(id?: string, testType = "credentials") {
    if (!id) return toast.error("Save this gateway before testing.")
    const res = await authFetch(`/api/admin/payment-gateways/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testType }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok || data?.ok === false) return toast.error(paymentGatewayError(data, "Gateway test failed"))
    toast.success(data?.message || "Gateway test passed")
    await load()
  }

  async function copy(value?: string | null) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    toast.success("Copied")
  }

  function currentLogo() {
    return String(form.credentials?.logoUrl || form.credentials?.logo || "").trim()
  }

  async function uploadLogo(file?: File | null) {
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoState({ uploading: false, error: "Unsupported file type. Allowed: PNG, JPG, WEBP, SVG." })
      toast.error("✕ Unable to upload logo")
      return
    }
    if (file.size > LOGO_MAX_SIZE) {
      setLogoState({ uploading: false, error: "Logo must be 5 MB or smaller." })
      toast.error("✕ Unable to upload logo")
      return
    }
    setLogoState({ uploading: true, error: null })
    try {
      const body = new FormData()
      body.append("logo", file)
      const res = await authFetch("/api/admin/payment-gateways/logo", { method: "POST", body })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.ok === false) {
        setLogoState({ uploading: false, error: paymentGatewayError(data, "Unable to upload logo") })
        toast.error("✕ Unable to upload logo")
        return
      }
      updateCredential("logoUrl", String(data.logoUrl || ""))
      updateCredential("logo", String(data.logoUrl || ""))
      setLogoState({ uploading: false, error: null })
      toast.success("✓ Logo uploaded")
    } catch {
      setLogoState({ uploading: false, error: "Unable to upload logo" })
      toast.error("✕ Unable to upload logo")
    }
  }

  function removeLogo() {
    updateCredential("logoUrl", "")
    updateCredential("logo", "")
    setLogoState({ uploading: false, error: null })
  }

  function validateForm(): Record<string, string> {
    const errors: Record<string, string> = {}
    const merchantName = String(form.credentials?.merchantName || "").trim()
    if (merchantName.length > MERCHANT_NAME_MAX_LENGTH) {
      errors.merchantName = `Merchant name must be at most ${MERCHANT_NAME_MAX_LENGTH} characters.`
    }
    const themeColor = String(form.credentials?.themeColor || "").trim()
    if (themeColor && !THEME_COLOR_PATTERN.test(themeColor)) {
      errors.themeColor = "Must be a valid hex color like #00C7E8."
    }
    if (!Number.isInteger(form.priority) || (form.priority || 0) < 1) {
      errors.priority = "Priority must be a valid integer ≥ 1."
    }
    return errors
  }

  function stripMaskedSecrets(credentials: Record<string, string>) {
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(credentials || {})) {
      if (typeof value === "string" && MASK_ONLY_PATTERN.test(value)) continue
      next[key] = value
    }
    return next
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Payment Gateways</h1>
          <p className="mt-1 text-sm text-muted-foreground">Configure gateway priority, credentials, and failover for invoice payments.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
      </div>

      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
        <AlertTriangle className="mr-2 inline h-4 w-4" />
        Live credentials will charge real customers. Test mode is recommended before production.
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Gateway Status</CardTitle>
          <CardDescription>Lower priority numbers are attempted first. Failsafe allows the next enabled gateway to be tried when this gateway fails.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {providers.map((provider) => {
            const gateway = gateways.find((item) => item.code === provider.value) || defaultGateway(provider.value)
            const active = form.code === provider.value
            return (
              <button key={provider.value} type="button" onClick={() => selectGateway(provider.value)} className={`rounded-lg border p-4 text-left transition-colors ${active ? "border-teal-300/60 bg-teal-400/10" : "border-border/40 bg-background/35 hover:border-accent/40"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{gateway.displayName || provider.label}</div>
                  <span className={gateway.enabled ? "text-xs text-emerald-300" : "text-xs text-muted-foreground"}>{gateway.enabled ? "Enabled" : "Disabled"}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{gateway.mode === "production" ? "Live" : "Test"} · Priority {gateway.priority}</p>
                <p className="mt-2 text-xs text-muted-foreground">Credentials: {gateway.credentialsStatus || (gateway.missingCredentialFields?.length ? "incomplete" : "configured")}</p>
                <p className="mt-1 text-xs text-muted-foreground">Runtime: {gateway.runtimeStatus || (gateway.enabled ? "ready" : "disabled")}</p>
                <p className={`mt-1 text-xs ${gateway.healthState === "healthy" ? "text-emerald-300" : gateway.healthState === "error" ? "text-red-300" : gateway.healthState === "disabled" ? "text-muted-foreground" : "text-amber-200"}`}>Health: {gateway.healthState || gateway.lastHealthStatus || "warning"}</p>
                <p className="mt-2 text-xs text-muted-foreground">Webhook: {gateway.lastWebhookStatus || "Not received"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Payment: {gateway.lastPaymentStatus || "No payment yet"}</p>
                {gateway.lastError ? <p className="mt-2 text-xs text-red-200">{gateway.lastError}</p> : null}
              </button>
            )
          })}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />{form.displayName || form.name}</CardTitle>
            <CardDescription>Secrets are encrypted before storage and masked after save.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="Gateway">
              <Select value={form.code} onValueChange={selectGateway}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{providers.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Display name"><Input value={form.displayName || form.name} onChange={(event) => updateForm({ name: event.target.value, displayName: event.target.value })} /></Field>
            <Field label="Mode">
              <Select value={form.mode} onValueChange={(mode) => updateForm({ mode })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="test">Test</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Priority"><Input type="number" min={1} value={form.priority} onChange={(event) => updateForm({ priority: Number(event.target.value || 100) })} /></Field>
            <Toggle label="Enabled" checked={form.enabled} onChange={(enabled) => updateForm({ enabled, active: enabled } as any)} />
            <Toggle label="Failsafe enabled" checked={form.failsafeEnabled} onChange={(failsafeEnabled) => updateForm({ failsafeEnabled })} />
            <Preview label="Callback URL" value={form.callbackUrl || `${primaryDomain?.appBaseUrl || ""}/payment/status?order_id={order_id}`} onCopy={copy} />
            <Preview label="Webhook URL" value={form.webhookUrl || `${primaryDomain?.appBaseUrl || ""}/api/payments/webhook?gateway=${form.code}`} onCopy={copy} />
            <Info label="Credentials status" value={form.credentialsStatus || (form.missingCredentialFields?.length ? `Missing ${form.missingCredentialFields.join(", ")}` : "configured")} />
            <Info label="Runtime status" value={form.runtimeStatus || (form.enabled ? "ready" : "disabled")} />
            <Info label="Health state" value={form.healthState || "warning"} />
            <Info label="Last webhook status" value={form.lastWebhookStatus || "Not received"} />
            <Info label="Last payment status" value={form.lastPaymentStatus || "No payment yet"} />
            <Info label="Last health status" value={form.lastHealthStatus || "unknown"} />
            <Info label="Last test" value={form.lastTestAt ? new Date(form.lastTestAt).toLocaleString() : "Never tested"} />
            <Info label="Last error" value={form.lastError || "-"} />
          </CardContent>
        </Card>

        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Credentials</CardTitle>
            <CardDescription>{form.mode === "production" ? "Production mode uses live credentials." : "Test mode uses test credentials."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {credentialFields(form.code).normal.map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="text"
                  autoComplete="off"
                  value={form.credentials?.[key] || ""}
                  onChange={(event) => updateCredential(key, event.target.value)}
                />
              </Field>
            ))}

            {credentialFields(form.code).secret.map(([key, label]) => {
              const cacheKey = `${form.code}:${key}`
              const reveal = Boolean(revealedCredentials[cacheKey])
              const stored = form.credentials?.[key] || ""
              const shownValue = reveal ? (revealedValues[cacheKey] ?? stored) : stored
              return (
                <Field key={key} label={label}>
                  <div className="flex w-full gap-2">
                    <Input
                      type={reveal ? "text" : "password"}
                      autoComplete="off"
                      value={shownValue}
                      onChange={(event) => updateCredential(key, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => void revealCredential(key)}
                      aria-label={reveal ? "Hide secret" : "Show secret"}
                      title={reveal ? "Hide secret" : "Show secret"}
                    >
                      {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </Field>
              )
            })}

            {BRANDED_PROVIDERS.has(form.code) ? (
              <div className="space-y-4 rounded-lg border border-border/40 bg-background/20 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Merchant branding</p>
                <Field label="Merchant Name">
                  <Input
                    type="text"
                    autoComplete="off"
                    maxLength={MERCHANT_NAME_MAX_LENGTH}
                    value={form.credentials?.merchantName || ""}
                    onChange={(event) => updateCredential("merchantName", event.target.value)}
                    placeholder="ZWS CLOUD"
                  />
                  <p className="text-xs text-muted-foreground">Used for merchant branding in supported gateways, e.g. Razorpay checkout.</p>
                </Field>

                <Field label="Theme Color">
                  <div className="flex w-full items-center gap-2">
                    <label
                      className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border/50"
                      title="Pick a color"
                      aria-label="Pick a color"
                    >
                      <span className="absolute inset-0" style={{ backgroundColor: expandHex(form.credentials?.themeColor || "#00C7E8") }} />
                      <input
                        type="color"
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        value={expandHex(form.credentials?.themeColor || "#00C7E8")}
                        onChange={(event) => updateCredential("themeColor", event.target.value.toUpperCase())}
                      />
                    </label>
                    <Input
                      type="text"
                      className="font-mono"
                      maxLength={9}
                      value={form.credentials?.themeColor || ""}
                      onChange={(event) => updateCredential("themeColor", event.target.value)}
                      placeholder="#00C7E8"
                    />
                  </div>
                </Field>

                <Field label="Logo">
                  {currentLogo() ? (
                    <div className="space-y-2">
                      <div className="flex max-h-32 items-center justify-center overflow-hidden rounded-lg border border-border/40 bg-background/30 p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={currentLogo()} alt="Merchant logo preview" className="max-h-24 max-w-full object-contain" />
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <LogoUploadButton uploading={logoState.uploading} onFile={(file) => void uploadLogo(file)} label="Upload Logo" />
                        <Button type="button" variant="outline" size="sm" onClick={removeLogo} className="gap-2">
                          <Trash2 className="h-4 w-4" />Remove Logo
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="rounded-lg border border-dashed border-border/50 bg-background/20 px-3 py-8 text-center text-sm text-muted-foreground">
                        No logo uploaded
                      </p>
                      {logoState.error ? <p className="text-xs text-red-300">{logoState.error}</p> : null}
                      <LogoUploadButton uploading={logoState.uploading} onFile={(file) => void uploadLogo(file)} label="Upload Logo" />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">PNG, JPG, WEBP or SVG up to 5 MB. Stored securely and reused across merchant branding.</p>
                </Field>
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={save} className="gap-2"><Save className="h-4 w-4" />Save credentials</Button>
              <Button type="button" variant="outline" onClick={() => testGateway(selected?.id || form.id)} className="gap-2"><TestTube2 className="h-4 w-4" />Test connection</Button>
              {form.code !== "razorpay" ? <Button type="button" variant="outline" onClick={() => testGateway(selected?.id || form.id, "webhook")} className="gap-2 sm:col-span-2"><TestTube2 className="h-4 w-4" />Test webhook</Button> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}

function LogoUploadButton({ uploading, onFile, label }: { uploading: boolean; onFile: (file: File) => void; label: string }) {
  return (
    <label className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent/5 disabled:pointer-events-none disabled:opacity-50">
      <Upload className="h-4 w-4" />
      <span>{uploading ? "Uploading..." : label}</span>
      <input
        type="file"
        accept={LOGO_TYPES.join(",")}
        className="sr-only"
        disabled={uploading}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ""
        }}
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 p-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={onChange} /></div>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/40 bg-background/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p></div>
}

function Preview({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCopy(value)}><Clipboard className="h-3.5 w-3.5" /></Button>
      </div>
      <p className="mt-1 break-all text-sm font-medium">{value || "-"}</p>
    </div>
  )
}
