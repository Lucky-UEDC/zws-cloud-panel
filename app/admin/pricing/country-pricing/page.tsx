"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Globe2, Save, Search, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { readJsonResponse } from "@/lib/client/safe-json"

type CountryOption = { code: string; name: string; flag: string; currency: string; label: string }
type GlobalSettings = { enabled: boolean; defaultMarkupPercent: number; originCountry: "IN"; originCurrency: "INR" }

type CountryRow = {
  id: string
  countryCode: string
  currency: string
  markupValue: number
  roundingRule: string
  enabled: boolean
  customOverride?: boolean
  overrideActive?: boolean
  baseInr?: number
  convertedValue?: number | null
  markedUpInr?: number
  effectiveMarkup?: number
  exchangeRate?: number | null
  effectivePricePreview?: string | null
  stale?: boolean
  updatedAt?: string
}

const roundingOptions = [
  ["nearest_0_99", "Nearest .99"],
  ["nearest_0_49", "Nearest .49"],
  ["nearest_integer", "Nearest integer"],
  ["custom_decimal", "Custom decimal"],
]

const defaultGlobal: GlobalSettings = { enabled: false, defaultMarkupPercent: 40, originCountry: "IN", originCurrency: "INR" }

export default function AdminCountryPricingPage() {
  const [rows, setRows] = useState<CountryRow[]>([])
  const [countries, setCountries] = useState<CountryOption[]>([])
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(defaultGlobal)
  const [selectedCode, setSelectedCode] = useState("US")
  const [countryQuery, setCountryQuery] = useState("")
  const [markupValue, setMarkupValue] = useState(40)
  const [roundingRule, setRoundingRule] = useState("nearest_0_99")
  const [enabled, setEnabled] = useState(true)
  const [mfaConfigured, setMfaConfigured] = useState(true)
  const pendingStepUpAction = useRef<null | (() => Promise<unknown>)>(null)
  const [stepUp, setStepUp] = useState({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })

  const selectedCountry = useMemo(() => countries.find((country) => country.code === selectedCode) || countries[0], [countries, selectedCode])
  const filteredCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase()
    const list = q
      ? countries.filter((country) => [country.code, country.name, country.currency].some((value) => value.toLowerCase().includes(q)))
      : countries
    return list.slice(0, 80)
  }, [countries, countryQuery])

  async function load() {
    const [countryRes, rowsRes, globalRes] = await Promise.all([
      fetch("/api/admin/pricing/countries", { cache: "no-store" }),
      fetch("/api/admin/pricing/country-pricing", { cache: "no-store" }),
      fetch("/api/admin/pricing/global", { cache: "no-store" }),
    ])
    const [countryData, rowsData, globalData] = await Promise.all([
      readJsonResponse<any>(countryRes),
      readJsonResponse<any>(rowsRes),
      readJsonResponse<any>(globalRes),
    ])
    if (countryRes.ok) setCountries(countryData.countries || [])
    if (rowsRes.ok) setRows(rowsData.countries || [])
    if (globalRes.ok) {
      setGlobalSettings({ ...defaultGlobal, ...(globalData.settings || {}) })
      setMfaConfigured(globalData.security?.mfaConfigured !== false)
    }
  }

  useEffect(() => {
    void load()
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  useEffect(() => {
    const q = countryQuery.trim().toLowerCase()
    if (!q) return
    const aliases: Record<string, string> = { usa: "US", us: "US", uk: "GB", uae: "AE" }
    const match = countries.find((country) => country.code === aliases[q] || country.code.toLowerCase() === q || country.name.toLowerCase() === q)
    if (match) setSelectedCode(match.code)
  }, [countryQuery, countries])

  async function startStepUp(action: () => Promise<unknown>) {
    pendingStepUpAction.current = action
    const res = await fetch("/api/auth/mfa/step-up/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Unable to start MFA verification")
    if (data.code === "mfa_not_required") {
      pendingStepUpAction.current = null
      await action()
      return
    }
    setStepUp({ open: true, busy: false, challengeToken: data.challengeToken, method: data.method, maskedTarget: data.maskedTarget || "", code: "" })
  }

  async function verifyStepUp() {
    setStepUp((state) => ({ ...state, busy: true }))
    const res = await fetch("/api/auth/mfa/step-up/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeToken: stepUp.challengeToken, method: stepUp.method, code: stepUp.code }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      setStepUp((state) => ({ ...state, busy: false }))
      return toast.error(data.error || "MFA verification failed")
    }
    const action = pendingStepUpAction.current
    pendingStepUpAction.current = null
    setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })
    toast.success("MFA verified")
    if (action) await action()
  }

  async function handleStepUpResponse(data: any, retry: () => Promise<unknown>) {
    if (data?.code === "recent_mfa_required") {
      await startStepUp(retry)
      return true
    }
    return false
  }

  async function saveGlobal() {
    const res = await fetch("/api/admin/pricing/global", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(globalSettings),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok && await handleStepUpResponse(data, saveGlobal)) return
    if (!res.ok) return toast.error(data.error || "Unable to save global pricing")
    setGlobalSettings({ ...defaultGlobal, ...data.settings })
    toast.success("Global pricing saved")
  }

  async function saveCountry() {
    if (!selectedCountry) return toast.error("Select a valid country")
    const res = await fetch("/api/admin/pricing/country-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryCode: selectedCountry.code,
        markupValue: Number(markupValue || 0),
        roundingRule,
        enabled,
      }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok && await handleStepUpResponse(data, saveCountry)) return
    if (!res.ok) return toast.error(data.error || "Unable to save country pricing")
    toast.success("Country pricing saved")
    await load()
  }

  async function saveCountryOverride(countryCode: string, patch: { markupValue?: number; roundingRule?: string; enabled?: boolean }) {
    const res = await fetch("/api/admin/pricing/country-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryCode,
        markupValue: Number(patch.markupValue ?? 0),
        roundingRule: patch.roundingRule || "nearest_0_99",
        enabled: patch.enabled ?? true,
      }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok && await handleStepUpResponse(data, () => saveCountryOverride(countryCode, patch))) return
    if (!res.ok) return toast.error(data.error || "Unable to save country pricing")
    await load()
  }

  async function patchRow(id: string, patch: Partial<CountryRow>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    const res = await fetch(`/api/admin/pricing/country-pricing/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok && await handleStepUpResponse(data, () => patchRow(id, patch))) return
    if (!res.ok) {
      toast.error(data?.error || "Unable to update country pricing")
      await load()
      return
    }
    toast.success("Country pricing updated")
  }

  async function removeRow(id: string) {
    const res = await fetch(`/api/admin/pricing/country-pricing/${id}`, { method: "DELETE" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok && await handleStepUpResponse(data, () => removeRow(id))) return
    if (!res.ok) return toast.error(data?.error || "Unable to delete country pricing")
    setRows((current) => current.filter((row) => row.id !== id))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Country Pricing</h1>
        <p className="text-muted-foreground">Backend-authoritative country markup, currency mapping, and localized display pricing.</p>
      </div>

      {!mfaConfigured ? (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 text-amber-300" />
              <div>
                <h2 className="text-lg font-semibold">MFA is recommended before managing pricing.</h2>
                <p className="text-sm text-muted-foreground">Configure MFA in Account & Security.</p>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => window.open("/admin/account-security", "_blank", "noopener,noreferrer")}>Account & Security</Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="glass border-border/40">
        <CardHeader><CardTitle className="flex items-center gap-2"><Globe2 className="h-5 w-5" />Global settings</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2">
            <Switch checked={globalSettings.enabled} onCheckedChange={(checked) => setGlobalSettings({ ...globalSettings, enabled: checked })} />
            <Label>Global markup enabled</Label>
          </div>
          <div className="space-y-2">
            <Label>Default global markup %</Label>
            <Input type="number" min={0} max={1000} value={globalSettings.defaultMarkupPercent} onChange={(event) => setGlobalSettings({ ...globalSettings, defaultMarkupPercent: Number(event.target.value) })} />
          </div>
          <div className="space-y-2"><Label>Origin country</Label><Input value="IN" readOnly /></div>
          <div className="space-y-2"><Label>Origin currency</Label><Input value="INR" readOnly /></div>
          <div className="flex items-end"><Button onClick={saveGlobal}><Save className="mr-2 h-4 w-4" />Save</Button></div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Add or update country override</CardTitle></CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-6">
          <div className="space-y-2 lg:col-span-2">
            <Label>Country</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={countryQuery} onChange={(event) => setCountryQuery(event.target.value)} placeholder="Search country or currency" className="pl-9" />
            </div>
            <select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)} className="h-40 w-full rounded-md border border-border/40 bg-background px-3 py-2 text-sm" size={6}>
              {filteredCountries.map((country) => <option key={country.code} value={country.code}>{country.label} ({country.code})</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>Stored country code</Label><Input value={selectedCountry?.code || ""} readOnly /></div>
          <div className="space-y-2"><Label>Currency</Label><Input value={selectedCountry?.currency || ""} readOnly /></div>
          <div className="space-y-2"><Label>Markup %</Label><Input type="number" min={0} max={1000} value={markupValue} onChange={(event) => setMarkupValue(Number(event.target.value))} /></div>
          <div className="space-y-2">
            <Label>Rounding</Label>
            <select value={roundingRule} onChange={(event) => setRoundingRule(event.target.value)} className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm">
              {roundingOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Button onClick={saveCountry}><Save className="mr-2 h-4 w-4" />Save</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Configured countries</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-muted-foreground"><th className="py-3">Flag</th><th>Country</th><th>Currency</th><th>Base INR</th><th>Converted</th><th>Markup</th><th>Override</th><th>Rounding</th><th>Final Preview</th><th>Rate</th><th>Enabled</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                const country = countries.find((item) => item.code === row.countryCode)
                return (
                  <tr key={row.id} className="border-b border-border/30">
                    <td className="py-3 text-lg">{country?.flag || row.countryCode}</td>
                    <td className="font-medium">{country?.name || row.countryCode} ({row.countryCode})</td>
                    <td>{row.currency}</td>
                    <td>₹{Number(row.baseInr || 0).toLocaleString("en-IN")}</td>
                    <td>{row.convertedValue == null ? "-" : `${Number(row.convertedValue).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.currency}`}</td>
                    <td>{row.countryCode === "IN" ? "0%" : `${row.effectiveMarkup ?? globalSettings.defaultMarkupPercent}%`}</td>
                    <td><Input type="number" min={0} max={1000} value={row.markupValue} onChange={(event) => row.customOverride ? patchRow(row.id, { markupValue: Number(event.target.value) }) : saveCountryOverride(row.countryCode, { markupValue: Number(event.target.value), roundingRule: row.roundingRule, enabled: row.enabled })} className="h-8 w-24" /></td>
                    <td>{roundingOptions.find(([value]) => value === row.roundingRule)?.[1] || row.roundingRule}</td>
                    <td>{row.effectivePricePreview || "-"}</td>
                    <td className="text-xs text-muted-foreground">{row.exchangeRate || "API/cache"}{row.stale ? " · stale" : ""}</td>
                    <td><Switch checked={row.enabled} onCheckedChange={(checked) => row.customOverride ? patchRow(row.id, { enabled: checked }) : saveCountryOverride(row.countryCode, { markupValue: row.markupValue, roundingRule: row.roundingRule, enabled: checked })} /></td>
                    <td className="text-right">{row.customOverride ? <Button variant="outline" size="icon" onClick={() => removeRow(row.id)}><Trash2 className="h-4 w-4" /></Button> : null}</td>
                  </tr>
                )
              })}
              {!rows.length ? <tr><td colSpan={12} className="py-6 text-center text-muted-foreground">No countries available.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={stepUp.open} onOpenChange={(open) => setStepUp((state) => ({ ...state, open }))}>
        <DialogContent className="glass border-border/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Enter MFA code to continue</DialogTitle>
            <DialogDescription>
              {stepUp.method === "totp" ? "Use your authenticator app." : stepUp.maskedTarget ? `Code sent to ${stepUp.maskedTarget}.` : "Verify this sensitive pricing action."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>MFA code</Label>
            <Input value={stepUp.code} onChange={(event) => setStepUp((state) => ({ ...state, code: event.target.value.trim() }))} autoComplete="one-time-code" inputMode="numeric" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })}>Cancel</Button>
            <Button onClick={verifyStepUp} disabled={stepUp.busy || stepUp.code.length < 6}>Verify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
