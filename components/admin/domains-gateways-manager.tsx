"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authFetch } from "@/lib/client/auth-fetch"
import { readJsonResponse } from "@/lib/client/safe-json"

type DomainRow = {
  id: string
  domain: string
  displayName: string
  brandName?: string | null
  appBaseUrl: string
  isPrimary: boolean
  isActive: boolean
  canonicalRedirectEnabled: boolean
  defaultGateway?: string | null
  fallbackGateway?: string | null
  environmentMode: string
  allowedGatewayModes?: string[]
  metadata?: Record<string, any>
  notes?: string | null
  gatewayConfigs: GatewayRow[]
}

type GatewayRow = {
  id: string
  gateway: string
  enabled: boolean
  priority: number
  environment: string
  displayName?: string | null
  approvedPaymentDomain?: string | null
  webhookUrl?: string | null
  returnUrl?: string | null
  startUrl?: string | null
  extraConfig?: Record<string, unknown>
  credentials?: Record<string, string>
}

const defaultDomain = {
  domain: "",
  displayName: "",
  brandName: "",
  appBaseUrl: "",
  isPrimary: false,
  isActive: true,
  canonicalRedirectEnabled: false,
  defaultGateway: "cashfree",
  fallbackGateway: "phonepe",
  environmentMode: "production",
  allowedGatewayModes: ["cashfree", "phonepe", "manual", "wallet"],
  notes: "",
}

const gatewayOptions = [
  { value: "cashfree", label: "Cashfree" },
  { value: "phonepe", label: "PhonePe" },
  { value: "razorpay", label: "Razorpay" },
  { value: "paytm", label: "Paytm" },
  { value: "manual", label: "Manual" },
  { value: "wallet", label: "Wallet" },
]

const routingGatewayOptions = [{ value: "none", label: "None" }, ...gatewayOptions]

function routingBehavior(domain?: DomainRow | null) {
  const raw = domain?.metadata?.paymentRouting?.fallbackBehavior
  return String(raw || "default_init_fails")
}

export function DomainsGatewaysManager() {
  const [domains, setDomains] = useState<DomainRow[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [domainForm, setDomainForm] = useState(defaultDomain)
  const [gatewayForms, setGatewayForms] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [savingRouting, setSavingRouting] = useState(false)
  const [routingForm, setRoutingForm] = useState({
    defaultGateway: "none",
    fallbackGateway: "none",
    fallbackBehavior: "default_init_fails",
  })

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await authFetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } })
    const data = await readJsonResponse<any>(res)
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.message || "Request failed")
    return data
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api("/api/admin/domains")
      setDomains(data.domains || [])
      const first = data.domains?.[0]
      setSelectedId((current) => current || first?.id || "")
    } catch (error: any) {
      toast.error(error?.message || "Failed to load domains")
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const selected = domains.find((domain) => domain.id === selectedId) || null

  useEffect(() => {
    if (!selected) return
    setRoutingForm({
      defaultGateway: selected.defaultGateway || "none",
      fallbackGateway: selected.fallbackGateway || "none",
      fallbackBehavior: routingBehavior(selected),
    })
    setGatewayForms({})
  }, [selected])

  const enabledGatewaySet = useMemo(() => {
    return new Set((selected?.gatewayConfigs || []).filter((config) => config.enabled).map((config) => config.gateway))
  }, [selected])

  const routingValidation = useMemo(() => {
    if (!selected) return "Select a domain first."
    if (routingForm.defaultGateway !== "none" && !enabledGatewaySet.has(routingForm.defaultGateway)) return "Selected default gateway is disabled."
    if (routingForm.fallbackGateway !== "none" && !enabledGatewaySet.has(routingForm.fallbackGateway)) return "Selected fallback gateway is disabled."
    if (routingForm.defaultGateway !== "none" && routingForm.fallbackGateway !== "none" && routingForm.defaultGateway === routingForm.fallbackGateway) return "Second gateway cannot equal default gateway."
    return null
  }, [enabledGatewaySet, routingForm, selected])

  async function saveDomain() {
    try {
      await api("/api/admin/domains", { method: "POST", body: JSON.stringify(domainForm) })
      toast.success("Domain saved")
      setDomainForm(defaultDomain)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Failed to save domain")
    }
  }

  async function updateDomain(patch: Partial<DomainRow>) {
    if (!selected) return
    try {
      await api(`/api/admin/domains/${selected.id}`, { method: "PATCH", body: JSON.stringify(patch) })
      toast.success("Domain updated")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Failed to update domain")
    }
  }

  async function saveRouting() {
    if (!selected || routingValidation) return
    setSavingRouting(true)
    try {
      await api(`/api/admin/domains/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          defaultGateway: routingForm.defaultGateway,
          fallbackGateway: routingForm.fallbackGateway,
          fallbackBehavior: routingForm.fallbackBehavior,
        }),
      })
      toast.success("Payment routing saved")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Failed to save routing")
    } finally {
      setSavingRouting(false)
    }
  }

  function gatewayForm(gateway: string) {
    const existing = selected?.gatewayConfigs.find((config) => config.gateway === gateway)
    return gatewayForms[gateway] || {
      gateway,
      enabled: existing?.enabled || false,
      priority: existing?.priority || (gateway === "cashfree" ? 10 : 20),
      environment: existing?.environment || "production",
      displayName: existing?.displayName || (gateway === "cashfree" ? "Cashfree" : gateway === "phonepe" ? "PhonePe" : gateway),
      approvedPaymentDomain: existing?.approvedPaymentDomain || selected?.domain || "",
      webhookUrl: existing?.webhookUrl || "",
      returnUrl: existing?.returnUrl || "",
      startUrl: existing?.startUrl || "",
      credentials: existing?.credentials || {},
      extraConfig: existing?.extraConfig || {},
    }
  }

  function setGatewayForm(gateway: string, patch: Record<string, unknown>) {
    setGatewayForms((state) => ({ ...state, [gateway]: { ...gatewayForm(gateway), ...patch } }))
  }

  async function saveGateway(gateway: string) {
    if (!selected) return
    try {
      await api(`/api/admin/domains/${selected.id}/gateways`, { method: "POST", body: JSON.stringify(gatewayForm(gateway)) })
      toast.success("Gateway config saved")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Failed to save gateway")
    }
  }

  async function testGateway(gateway: string, testType = "credentials") {
    const existing = selected?.gatewayConfigs.find((config) => config.gateway === gateway)
    if (!existing) return toast.error("Save this gateway before testing.")
    try {
      const data = await api(`/api/admin/domain-gateways/${existing.id}/test`, { method: "POST", body: JSON.stringify({ testType }) })
      toast.success(data.message || "Gateway config present")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Gateway test failed")
    }
  }

  async function testRouting(testType: string) {
    if (!selected) return
    try {
      const data = await api(`/api/admin/domains/${selected.id}/routing-test`, { method: "POST", body: JSON.stringify({ testType }) })
      toast.success(data.message || "Routing test complete")
      console.info("[domain_routing_test]", data)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Routing test failed")
    }
  }

  return (
    <div className="space-y-6">
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Domains</CardTitle><CardDescription>Manage approved app and payment domains for one shared ZWS deployment.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_360px]">
          <div className="overflow-x-auto rounded-lg border border-border/40">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-muted-foreground"><tr><th className="p-3">Domain</th><th>Display name</th><th>Primary</th><th>Active</th><th>Default</th><th>Fallback</th><th>Environment</th><th>Actions</th></tr></thead>
              <tbody>{domains.map((domain) => <tr key={domain.id} className="border-t border-border/40"><td className="p-3 font-medium">{domain.domain}</td><td>{domain.displayName}</td><td>{domain.isPrimary ? "Yes" : "No"}</td><td>{domain.isActive ? "Active" : "Disabled"}</td><td>{domain.defaultGateway || "-"}</td><td>{domain.fallbackGateway || "-"}</td><td>{domain.environmentMode}</td><td><Button size="sm" variant={selectedId === domain.id ? "default" : "outline"} onClick={() => setSelectedId(domain.id)}>Select</Button></td></tr>)}</tbody>
            </table>
          </div>
          <div className="space-y-3 rounded-lg border border-border/40 p-3">
            <Field label="Domain" value={domainForm.domain} onChange={(domain) => setDomainForm({ ...domainForm, domain, appBaseUrl: domainForm.appBaseUrl || `https://${domain}` })} />
            <Field label="Display Name" value={domainForm.displayName} onChange={(displayName) => setDomainForm({ ...domainForm, displayName })} />
            <Field label="App Base URL" value={domainForm.appBaseUrl} onChange={(appBaseUrl) => setDomainForm({ ...domainForm, appBaseUrl })} />
            <div className="grid grid-cols-2 gap-2"><SwitchField label="Primary" checked={domainForm.isPrimary} onCheckedChange={(isPrimary) => setDomainForm({ ...domainForm, isPrimary })} /><SwitchField label="Active" checked={domainForm.isActive} onCheckedChange={(isActive) => setDomainForm({ ...domainForm, isActive })} /></div>
            <Button type="button" onClick={saveDomain}>Add Domain</Button>
          </div>
        </CardContent>
      </Card>

      {selected ? <Card className="glass border-border/40">
        <CardHeader><CardTitle>Domain: {selected.domain}</CardTitle><CardDescription>Credentials are encrypted at rest and never displayed after save.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <SwitchField label="Active domain" checked={selected.isActive} onCheckedChange={(isActive) => updateDomain({ isActive })} />
          <SwitchField label="Primary domain" checked={selected.isPrimary} onCheckedChange={(isPrimary) => updateDomain({ isPrimary })} />
          <div><Label>Environment</Label><Select value={selected.environmentMode || "production"} onValueChange={(environmentMode) => updateDomain({ environmentMode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="test">Test</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent></Select></div>
        </CardContent>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/40 bg-background/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Payment Routing</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Checkout tries the default gateway first. If it cannot create a payment session, the second gateway is used when fallback is enabled.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => testRouting("default_gateway")}>Test default gateway</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => testRouting("fallback_gateway")}>Test second gateway</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => testRouting("routing_decision")}>Test routing decision</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => testRouting("payment_initialization")}>Test payment initialization</Button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div><Label>Default gateway</Label><Select value={routingForm.defaultGateway} onValueChange={(defaultGateway) => setRoutingForm((state) => ({ ...state, defaultGateway }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{routingGatewayOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Second gateway</Label><Select value={routingForm.fallbackGateway} onValueChange={(fallbackGateway) => setRoutingForm((state) => ({ ...state, fallbackGateway }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{routingGatewayOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Fallback behavior</Label><Select value={routingForm.fallbackBehavior} onValueChange={(fallbackBehavior) => setRoutingForm((state) => ({ ...state, fallbackBehavior }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="disabled">Disabled</SelectItem><SelectItem value="default_init_fails">Use second gateway only if default initialization fails</SelectItem><SelectItem value="default_unavailable">Use second gateway if default is disabled/unavailable</SelectItem></SelectContent></Select></div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {gatewayOptions.map((item) => {
                const enabled = enabledGatewaySet.has(item.value)
                const config = selected.gatewayConfigs.find((gateway) => gateway.gateway === item.value)
                const lastTest = config?.extraConfig?.lastTestResult as any
                return <div key={item.value} className="rounded-md border border-border/40 p-3 text-sm"><div className="font-medium">{item.label}: <span className={enabled ? "text-emerald-400" : "text-muted-foreground"}>{enabled ? "Enabled" : "Disabled"}</span></div>{item.value === "phonepe" && config?.webhookUrl ? <p className="mt-1 text-xs text-muted-foreground">Webhook configured</p> : null}{lastTest ? <p className={lastTest.ok ? "mt-1 text-xs text-emerald-400" : "mt-1 text-xs text-destructive"}>Last test: {lastTest.ok ? "passed" : "failed"}</p> : null}</div>
              })}
            </div>
            {routingValidation ? <p className="mt-3 text-sm text-destructive">{routingValidation}</p> : null}
            <div className="mt-4">
              <Button type="button" disabled={Boolean(routingValidation) || savingRouting} onClick={saveRouting}>Save Routing</Button>
            </div>
          </div>
        </CardContent>
        <CardContent>
          <Tabs defaultValue="cashfree">
            <TabsList><TabsTrigger value="cashfree">Cashfree</TabsTrigger><TabsTrigger value="phonepe">PhonePe</TabsTrigger><TabsTrigger value="manual">Manual</TabsTrigger><TabsTrigger value="wallet">Wallet</TabsTrigger></TabsList>
            {["cashfree", "phonepe", "manual", "wallet"].map((gateway) => <TabsContent key={gateway} value={gateway}><GatewayForm gateway={gateway} value={gatewayForm(gateway)} onChange={(patch) => setGatewayForm(gateway, patch)} onSave={() => saveGateway(gateway)} onTest={(type) => testGateway(gateway, type)} /></TabsContent>)}
          </Tabs>
        </CardContent>
      </Card> : loading ? <p className="text-muted-foreground">Loading domains...</p> : null}
    </div>
  )
}

function GatewayForm({ gateway, value, onChange, onSave, onTest }: { gateway: string; value: any; onChange: (patch: Record<string, unknown>) => void; onSave: () => void; onTest: (type: string) => void }) {
  const lastTest = value.extraConfig?.lastTestResult as any
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <SwitchField label={`Enable ${gateway}`} checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
      <div><Label>Environment</Label><Select value={value.environment || "production"} onValueChange={(environment) => onChange({ environment })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sandbox">Test</SelectItem><SelectItem value="test">Test</SelectItem><SelectItem value="production">Production</SelectItem></SelectContent></Select></div>
      <Field label="Display Name" value={value.displayName || ""} onChange={(displayName) => onChange({ displayName })} />
      <Field label="Approved Payment Domain" value={value.approvedPaymentDomain || ""} onChange={(approvedPaymentDomain) => onChange({ approvedPaymentDomain })} />
      <Field label="Return URL" value={value.returnUrl || ""} onChange={(returnUrl) => onChange({ returnUrl })} />
      <Field label="Webhook URL" value={value.webhookUrl || ""} onChange={(webhookUrl) => onChange({ webhookUrl })} />
      <Field label="Start URL" value={value.startUrl || ""} onChange={(startUrl) => onChange({ startUrl })} />
      {gateway === "cashfree" ? <><Field label="App ID" value={value.credentials?.appId || ""} onChange={(appId) => onChange({ credentials: { ...(value.credentials || {}), appId } })} /><Field label="Secret Key (replace secret)" type="password" value={value.credentials?.secretKey || ""} onChange={(secretKey) => onChange({ credentials: { ...(value.credentials || {}), secretKey } })} /><Field label="API Version" value={value.credentials?.apiVersion || "2025-01-01"} onChange={(apiVersion) => onChange({ credentials: { ...(value.credentials || {}), apiVersion } })} /><Field label="Webhook Secret (replace secret)" type="password" value={value.credentials?.webhookSecret || ""} onChange={(webhookSecret) => onChange({ credentials: { ...(value.credentials || {}), webhookSecret } })} /></> : null}
      {gateway === "phonepe" ? <><Field label="Merchant ID" value={value.credentials?.merchantId || ""} onChange={(merchantId) => onChange({ credentials: { ...(value.credentials || {}), merchantId } })} /><Field label="Client ID" value={value.credentials?.clientId || ""} onChange={(clientId) => onChange({ credentials: { ...(value.credentials || {}), clientId } })} /><Field label="Client Secret (replace secret)" type="password" value={value.credentials?.clientSecret || ""} onChange={(clientSecret) => onChange({ credentials: { ...(value.credentials || {}), clientSecret } })} /><Field label="Client Version" value={value.credentials?.clientVersion || ""} onChange={(clientVersion) => onChange({ credentials: { ...(value.credentials || {}), clientVersion } })} /><Field label="Webhook Username" value={value.credentials?.webhookUsername || ""} onChange={(webhookUsername) => onChange({ credentials: { ...(value.credentials || {}), webhookUsername } })} /><Field label="Webhook Password (replace secret)" type="password" value={value.credentials?.webhookPassword || ""} onChange={(webhookPassword) => onChange({ credentials: { ...(value.credentials || {}), webhookPassword } })} /></> : null}
      {lastTest ? <div className="md:col-span-2 rounded-lg border border-border/40 bg-background/30 p-3 text-sm"><span className={lastTest.ok ? "text-emerald-400" : "text-destructive"}>{lastTest.ok ? "Last test passed" : "Last test failed"}</span><span className="text-muted-foreground"> · {lastTest.checkedAt}</span><p className="mt-1 text-muted-foreground">{lastTest.message}</p></div> : null}
      <div className="md:col-span-2 flex flex-wrap gap-3"><Button type="button" onClick={onSave}>Save {gateway}</Button><Button type="button" variant="outline" onClick={() => onTest("credentials")}>Test credentials</Button><Button type="button" variant="outline" onClick={() => onTest("payment_initialization")}>Test payment initialization</Button><Button type="button" variant="outline" onClick={() => onTest("webhook")}>Test webhook endpoint</Button></div>
    </div>
  )
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} /></div>
}

function SwitchField({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2"><Label>{label}</Label><Switch checked={Boolean(checked)} onCheckedChange={onCheckedChange} /></div>
}
