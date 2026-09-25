"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Copy, Download, Eye, EyeOff, KeyRound, Laptop, MapPin, Printer, RotateCcw, ShieldCheck, Smartphone, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { readJsonResponse } from "@/lib/client/safe-json"
import { useRuntimeBrand } from "@/lib/client/use-runtime-brand"

type MfaStatus = {
  email: string
  role: string
  whatsappEnabled: boolean
  totpEnabled: boolean
  emailFallbackEnabled: boolean
  recoveryCodesEnabled: boolean
  backupCodesRemaining: number
  trustedDeviceDays: number
  trustedDevices: any[]
  activeSessions: any[]
}

export default function ClientMfaSecurityPage() {
  const brand = useRuntimeBrand()
  const [status, setStatus] = useState<MfaStatus | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [setup, setSetup] = useState({ password: "", code: "", secret: "", qrCodeUrl: "", otpauthUri: "", backupCodes: [] as string[] })
  const [disable, setDisable] = useState({ password: "", code: "" })
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryPassword, setRecoveryPassword] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [recoveryMasked, setRecoveryMasked] = useState(true)
  const [recoveryLegacy, setRecoveryLegacy] = useState(false)
  const [recoveryLoading, setRecoveryLoading] = useState(false)

  async function load() {
    const [statusRes, eventsRes] = await Promise.all([
      fetch("/api/auth/2fa/status", { cache: "no-store" }),
      fetch("/api/auth/mfa/events", { cache: "no-store" }),
    ])
    if (statusRes.ok) setStatus(await readJsonResponse(statusRes))
    if (eventsRes.ok) setEvents((await readJsonResponse<any>(eventsRes)).events || [])
  }

  useEffect(() => {
    void load()
  }, [])

  async function beginTotpSetup() {
    const res = await fetch("/api/auth/2fa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: setup.password }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to start authenticator setup")
    setSetup((state) => ({ ...state, secret: data.secret, qrCodeUrl: data.qrCodeUrl, otpauthUri: data.otpauthUri }))
  }

  async function enableTotp() {
    const res = await fetch("/api/auth/2fa/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: setup.password, secret: setup.secret, code: setup.code }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to enable authenticator")
    setSetup({ password: "", code: "", secret: "", qrCodeUrl: "", otpauthUri: "", backupCodes: data.backupCodes || [] })
    toast.success("Authenticator enabled")
    await load()
  }

  async function disableTotp() {
    const res = await fetch("/api/auth/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(disable),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to disable authenticator")
    setDisable({ password: "", code: "" })
    toast.success("Authenticator disabled")
    await load()
  }

  async function revokeTrusted(id: string) {
    const res = await fetch(`/api/auth/mfa/trusted-devices/${id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Unable to revoke trusted device")
    await load()
  }

  async function revokeSession(id: string) {
    const res = await fetch(`/api/auth/mfa/sessions/${id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Unable to revoke session")
    await load()
  }

  async function loadRecoveryCodes(action: "view" | "regenerate" = "view") {
    setRecoveryLoading(true)
    try {
      const res = await fetch("/api/auth/2fa/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, password: recoveryPassword }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Unable to load recovery codes")
      setRecoveryCodes(data.codes || [])
      setRecoveryLegacy(Boolean(data.legacyCodesNeedRegeneration))
      setRecoveryMasked(action !== "regenerate")
      if (action === "regenerate") toast.success("Recovery codes regenerated")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Unable to load recovery codes")
    } finally {
      setRecoveryLoading(false)
    }
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"))
    toast.success("Recovery codes copied")
  }

  function downloadRecoveryCodes() {
    const blob = new Blob([`${brand.brandName} recovery codes\n\n${recoveryCodes.join("\n")}\n`], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "zws-recovery-codes.txt"
    link.click()
    URL.revokeObjectURL(url)
  }

  function printRecoveryCodes() {
    if (!recoveryCodes.length) return toast.error("No recovery codes loaded")
    window.requestAnimationFrame(() => window.print())
  }

  if (!status) return <p className="text-sm text-muted-foreground">Loading security settings...</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">Manage MFA, trusted devices, active sessions, and login history.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/40">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" />WhatsApp OTP</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Default login MFA</span><Switch checked={status.whatsappEnabled} disabled /></CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" />Authenticator</CardTitle></CardHeader>
          <CardContent><Badge variant={status.totpEnabled ? "default" : "secondary"}>{status.totpEnabled ? "Enabled" : "Optional"}</Badge></CardContent>
        </Card>
        <Card className="border-border/40">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Recovery Codes</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="text-muted-foreground">{status.backupCodesRemaining} unused codes</div>
            <Button size="sm" variant="outline" onClick={() => setRecoveryOpen(true)}>Manage codes</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40">
        <CardHeader>
          <CardTitle>Google Authenticator</CardTitle>
          <CardDescription>Works with Google Authenticator, Authy, Microsoft Authenticator, 1Password, and Bitwarden.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {status.totpEnabled ? (
            <>
              <div className="space-y-2"><Label>Current password</Label><Input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} /></div>
              <div className="space-y-2"><Label>Authenticator code</Label><Input value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
              <div className="md:col-span-2"><Button variant="destructive" onClick={disableTotp}>Disable Authenticator</Button></div>
            </>
          ) : (
            <>
              <div className="space-y-2"><Label>Confirm password</Label><Input type="password" value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} /></div>
              <div className="flex items-end"><Button onClick={beginTotpSetup}>Generate QR</Button></div>
              {setup.secret ? (
                <>
                  <div className="space-y-2"><Label>Secret</Label><Input value={setup.secret} readOnly /></div>
                  <div className="space-y-2 print:hidden"><Label>Scan QR</Label><div className="inline-flex rounded-lg border bg-white p-3"><Image src={setup.qrCodeUrl} alt="Authenticator QR code" width={176} height={176} unoptimized /></div></div>
                  <div className="space-y-2 md:col-span-2"><Label>Verification code</Label><Input value={setup.code} onChange={(e) => setSetup({ ...setup, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
                  <div className="md:col-span-2"><Button onClick={enableTotp}>Verify and Enable</Button></div>
                </>
              ) : null}
              {setup.backupCodes.length ? <div className="md:col-span-2 grid gap-2 rounded-lg border p-3 sm:grid-cols-2">{setup.backupCodes.map((code) => <code key={code} className="rounded bg-muted px-2 py-1 text-xs">{code}</code>)}</div> : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader><CardTitle>Trusted Devices</CardTitle><CardDescription>Devices that can skip MFA unless login risk is high.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {status.trustedDevices.length ? status.trustedDevices.map((device) => (
            <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div><div className="font-medium">{device.browser || "Browser"} on {device.os || "OS"}</div><div className="text-muted-foreground">{device.city || "Unknown"}, {device.country || "Unknown"} · {device.ip || "Unknown IP"}</div></div>
              <Button variant="outline" size="sm" onClick={() => revokeTrusted(device.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          )) : <p className="text-sm text-muted-foreground">No trusted devices yet.</p>}
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader><CardTitle>Active Sessions</CardTitle><CardDescription>Review and revoke active account sessions.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {status.activeSessions.length ? status.activeSessions.map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div className="flex items-start gap-3"><Laptop className="mt-0.5 h-4 w-4" /><div><div className="font-medium">{session.browser || "Browser"} on {session.os || "OS"}</div><div className="text-muted-foreground">{session.city || "Unknown"}, {session.country || "Unknown"} · last active {new Date(session.lastSeenAt).toLocaleString()}</div></div></div>
              <Button variant="outline" size="sm" onClick={() => revokeSession(session.id)}><RotateCcw className="h-4 w-4" /></Button>
            </div>
          )) : <p className="text-sm text-muted-foreground">No active sessions found.</p>}
        </CardContent>
      </Card>

      <Card className="border-border/40">
        <CardHeader><CardTitle>Login History</CardTitle><CardDescription>Security events and risk logs for this account.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {events.length ? events.map((event) => (
            <div key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div><div className="font-medium">{String(event.eventType).replace(/_/g, " ")}</div><div className="flex items-center gap-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{event.city || "Unknown"}, {event.country || "Unknown"} · {new Date(event.createdAt).toLocaleString()}</div></div>
              <Badge variant={event.riskLevel === "high" || event.riskLevel === "critical" ? "destructive" : "secondary"}>{event.riskLevel}</Badge>
            </div>
          )) : <p className="text-sm text-muted-foreground">No security events yet.</p>}
        </CardContent>
      </Card>

      <Dialog open={recoveryOpen} onOpenChange={(open) => {
        setRecoveryOpen(open)
        if (!open) {
          setRecoveryPassword("")
          setRecoveryCodes([])
          setRecoveryLegacy(false)
          setRecoveryMasked(true)
        }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Recovery Codes</DialogTitle>
            <DialogDescription>Confirm your password before viewing or regenerating recovery codes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Current password</Label>
              <Input type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => loadRecoveryCodes("view")} disabled={recoveryLoading || !recoveryPassword}>View codes</Button>
              <Button type="button" variant="outline" onClick={() => loadRecoveryCodes("regenerate")} disabled={recoveryLoading || !recoveryPassword}>Regenerate codes</Button>
            </div>
            {recoveryLegacy ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">Existing recovery codes were stored as hashes and cannot be viewed. Regenerate codes to enable secure viewing and downloads.</div>
            ) : null}
            {recoveryCodes.length ? (
              <div className="space-y-3">
                <div className="grid gap-2 rounded-lg border border-border/40 p-3 sm:grid-cols-2">
                  {recoveryCodes.map((code) => <code key={code} className="rounded bg-muted px-2 py-1 text-xs">{recoveryMasked ? "*************" : code}</code>)}
                </div>
                <div className="recovery-codes-print-root hidden">
                  <h1>{brand.brandName} recovery codes</h1>
                  <p>Store these codes securely. Each code can be used once.</p>
                  <div>
                    {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setRecoveryMasked((value) => !value)}>{recoveryMasked ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}{recoveryMasked ? "Reveal" : "Hide"}</Button>
                  <Button type="button" variant="outline" onClick={copyRecoveryCodes}><Copy className="mr-2 h-4 w-4" />Copy</Button>
                  <Button type="button" variant="outline" onClick={downloadRecoveryCodes}><Download className="mr-2 h-4 w-4" />Download TXT</Button>
                  <Button type="button" variant="outline" onClick={printRecoveryCodes}><Printer className="mr-2 h-4 w-4" />Print</Button>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setRecoveryOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
