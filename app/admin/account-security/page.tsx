"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { KeyRound, Laptop, Mail, MessageCircle, QrCode, RotateCcw, Save, ShieldCheck, Smartphone, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { readJsonResponse } from "@/lib/client/safe-json"

type Status = {
  email: string
  displayName?: string
  role: string
  defaultMethod: string
  mfaConfigured: boolean
  methods?: { totp: boolean; email: boolean; whatsapp: boolean; recovery: boolean }
  totpEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  recoveryCodesEnabled: boolean
  backupCodesRemaining: number
  trustedDeviceDays: number
  lastMfaVerification?: string | null
  lastLogin?: string | null
  phone?: string | null
  phoneVerified?: boolean
  securityPolicy?: { mfaMode: "disabled" | "recommend" | "enforce"; mfaEnforcementEnabled: boolean } | null
  whatsappStatus?: {
    status?: string | null
    runtimeStatus?: string | null
    workerHeartbeatAt?: string | null
    workerHeartbeatFresh?: boolean
    lastReadyAt?: string | null
  } | null
  trustedDevices: any[]
  activeSessions: any[]
  securityEvents: any[]
}

const emptySetup = { password: "", code: "", secret: "", qrCodeUrl: "", otpauthUri: "", backupCodes: [] as string[] }

function time(value?: string | Date | null) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString()
}

function deviceLine(item: any) {
  return `${item.browser || "Browser"} on ${item.os || item.platform || "Device"}`
}

export default function AdminAccountSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [profile, setProfile] = useState({ displayName: "", email: "" })
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "" })
  const [setup, setSetup] = useState(emptySetup)
  const [methodPassword, setMethodPassword] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [recoveryPassword, setRecoveryPassword] = useState("")
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [phoneChange, setPhoneChange] = useState({ newPhone: "", oldOtp: "", newOtp: "", oldVerified: false, busy: false })

  async function load() {
    const res = await fetch("/api/auth/2fa/status", { cache: "no-store" })
    const data = await readJsonResponse<Status>(res)
    if (!res.ok) return toast.error((data as any).error || "Unable to load security status")
    if (!data) return toast.error("Unable to load security status")
    setStatus(data)
    setProfile({ displayName: data.displayName || data.email?.split("@")[0] || "Admin", email: data.email || "" })
  }

  useEffect(() => {
    void load()
  }, [])

  async function saveProfile() {
    const res = await fetch("/api/admin/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Unable to update account")
    toast.success("Account updated")
    await load()
  }

  async function changePassword() {
    const res = await fetch("/api/admin/profile/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(password) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Unable to update password")
    setPassword({ currentPassword: "", newPassword: "" })
    toast.success("Password changed and sessions revoked")
    await load()
  }

  async function beginTotpSetup() {
    const res = await fetch("/api/auth/2fa/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: setup.password }) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to start authenticator setup")
    setSetup((state) => ({ ...state, secret: data.secret, qrCodeUrl: data.qrCodeUrl, otpauthUri: data.otpauthUri }))
  }

  async function enableTotp() {
    const res = await fetch("/api/auth/2fa/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: setup.password, secret: setup.secret, code: setup.code }) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to enable authenticator")
    setSetup({ ...emptySetup, backupCodes: data.backupCodes || [] })
    toast.success("Authenticator MFA enabled")
    await load()
  }

  async function disableTotp() {
    const res = await fetch("/api/auth/2fa/disable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: methodPassword, code: disableCode }) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Failed to disable authenticator")
    setMethodPassword("")
    setDisableCode("")
    toast.success("Authenticator disabled")
    await load()
  }

  async function updateMethod(method: "email" | "whatsapp" | "recovery", enabled: boolean, makeDefault = false) {
    const res = await fetch("/api/auth/2fa/methods", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, enabled, makeDefault, password: methodPassword }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Unable to update MFA method")
    toast.success("MFA method updated")
    await load()
  }

  async function updatePolicy(mfaMode: "disabled" | "recommend" | "enforce") {
    const res = await fetch("/api/admin/security/policy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaMode }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Unable to update MFA policy")
    toast.success("MFA policy updated")
    await load()
  }

  async function recoveryAction(action: "regenerate") {
    const res = await fetch("/api/auth/2fa/recovery-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, password: recoveryPassword }) })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) return toast.error(data.error || "Recovery code action failed")
    setRecoveryCodes(data.codes || [])
    toast.success("Recovery codes regenerated")
    await load()
  }

  async function revokeTrustedDevice(id: string) {
    const res = await fetch(`/api/auth/mfa/trusted-devices/${id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Unable to remove trusted device")
    toast.success("Trusted device removed")
    await load()
  }

  async function revokeSession(id: string) {
    const res = await fetch(`/api/auth/mfa/sessions/${id}`, { method: "DELETE" })
    if (!res.ok) return toast.error("Unable to terminate session")
    toast.success("Session terminated")
    await load()
  }

  async function logoutAllSessions() {
    const res = await fetch("/api/auth/mfa/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) })
    if (!res.ok) return toast.error("Unable to logout all sessions")
    toast.success("All sessions revoked")
    await load()
  }

  async function phoneChangeAction(action: "start_old" | "verify_old" | "start_new" | "verify_new") {
    setPhoneChange((state) => ({ ...state, busy: true }))
    try {
      const res = await fetch("/api/admin/security/phone-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, otp: action === "verify_old" ? phoneChange.oldOtp : phoneChange.newOtp, phone: phoneChange.newPhone, password: methodPassword }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) return toast.error(data.error || "Phone verification failed")
      if (action === "verify_old") {
        setPhoneChange((state) => ({ ...state, oldVerified: true, oldOtp: "" }))
        toast.success("Old number verified")
      } else if (action === "verify_new") {
        setPhoneChange({ newPhone: "", oldOtp: "", newOtp: "", oldVerified: false, busy: false })
        toast.success("Phone number updated")
        await load()
        return
      } else {
        toast.success(action === "start_old" ? "OTP sent to old number" : "OTP sent to new number")
      }
    } finally {
      setPhoneChange((state) => ({ ...state, busy: false }))
    }
  }

  if (!status) return <p className="text-sm text-muted-foreground">Loading account security...</p>
  const mfaMode = status.securityPolicy?.mfaMode || "recommend"
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Account & Security</h1>
        <p className="text-muted-foreground">Manage admin identity, MFA methods, recovery codes, trusted devices, and security sessions.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass border-border/40"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />MFA</CardTitle></CardHeader><CardContent><Badge variant={status.mfaConfigured ? "default" : "secondary"}>{status.mfaConfigured ? "Configured" : "Recommended"}</Badge></CardContent></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle className="text-base">Last MFA</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{time(status.lastMfaVerification)}</CardContent></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle className="text-base">Last Login</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">{time(status.lastLogin)}</CardContent></Card>
        <Card className="glass border-border/40"><CardHeader><CardTitle className="text-base">Sessions</CardTitle></CardHeader><CardContent className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{status.activeSessions?.length || 0} active</span><Button size="sm" variant="outline" onClick={logoutAllSessions}>Logout all</Button></CardContent></Card>
      </div>

      <Tabs defaultValue="mfa" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-fit"><TabsTrigger value="mfa">MFA Methods</TabsTrigger><TabsTrigger value="account">Account</TabsTrigger><TabsTrigger value="activity">Devices & Sessions</TabsTrigger></TabsList>

        <TabsContent value="mfa" className="grid gap-4 xl:grid-cols-2">
          <Card className="glass border-border/40 xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Global MFA Policy</CardTitle>
              <CardDescription>Choose when login MFA is required across admin and customer accounts.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[minmax(220px,320px)_1fr]">
              <div className="space-y-2">
                <Label>Security mode</Label>
                <Select value={mfaMode} onValueChange={(value) => updatePolicy(value as "disabled" | "recommend" | "enforce")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recommend">Recommend MFA</SelectItem>
                    <SelectItem value="disabled">Disable MFA</SelectItem>
                    <SelectItem value="enforce">Enforce MFA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-md border border-border/40 p-3 text-sm text-muted-foreground">
                {mfaMode === "disabled" ? "Password login is allowed without MFA challenges." : null}
                {mfaMode === "recommend" ? "Password login is allowed for low and medium risk. MFA is required for high-risk events." : null}
                {mfaMode === "enforce" ? "MFA is required at login when a user has any usable MFA method." : null}
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Authenticator App</CardTitle><CardDescription>Google Authenticator, Authy, Microsoft Authenticator, 1Password, and Bitwarden.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Badge variant={status.totpEnabled ? "default" : "secondary"}>{status.totpEnabled ? "Enabled" : "Not enabled"}</Badge>
              {!status.totpEnabled ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label>Password</Label><Input type="password" value={setup.password} onChange={(event) => setSetup({ ...setup, password: event.target.value })} /></div>
                  <div className="flex items-end"><Button onClick={beginTotpSetup}>Generate QR</Button></div>
                  {setup.qrCodeUrl ? <Image src={setup.qrCodeUrl} alt="Authenticator QR code" width={192} height={192} unoptimized className="h-48 w-48 rounded-md bg-white p-2" /> : null}
                  {setup.secret ? <div className="space-y-2"><Label>Manual secret key</Label><Input value={setup.secret} readOnly /></div> : null}
                  {setup.otpauthUri ? <div className="space-y-2 md:col-span-2"><Label>otpauth URI</Label><Input value={setup.otpauthUri} readOnly /></div> : null}
                  {setup.secret ? <><div className="space-y-2"><Label>OTP code</Label><Input inputMode="numeric" value={setup.code} onChange={(event) => setSetup({ ...setup, code: event.target.value.replace(/\s/g, "") })} /></div><div className="flex items-end"><Button onClick={enableTotp}>Verify and Enable</Button></div></> : null}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2"><Label>Password</Label><Input type="password" value={methodPassword} onChange={(event) => setMethodPassword(event.target.value)} /></div>
                  <div className="space-y-2"><Label>Authenticator code</Label><Input inputMode="numeric" value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, ""))} /></div>
                  <div className="flex items-end"><Button variant="destructive" onClick={disableTotp}>Disable</Button></div>
                </div>
              )}
              {setup.backupCodes.length ? <div className="rounded-md border border-border/40 p-3 text-sm"><p className="mb-2 font-medium">Save these recovery codes.</p><div className="grid gap-2 sm:grid-cols-2">{setup.backupCodes.map((code) => <code key={code} className="rounded bg-background/60 px-2 py-1">{code}</code>)}</div></div> : null}
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Email Verification</CardTitle><CardDescription>6 digit secure code with expiry, resend cooldown, and attempt limiting.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/40 p-3"><div><div className="font-medium">{status.email}</div><div className="text-sm text-muted-foreground">Default method: {status.defaultMethod === "email" ? "Yes" : "No"}</div></div><Switch checked={status.emailEnabled} onCheckedChange={(checked) => updateMethod("email", checked, checked)} /></div>
              <div className="space-y-2"><Label>Password for method changes</Label><Input type="password" value={methodPassword} onChange={(event) => setMethodPassword(event.target.value)} /></div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" />WhatsApp Verification</CardTitle><CardDescription>Branded OTP delivery with expiration, cooldown, retry, masking, and anti-spam limits.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/40 p-3"><div><div className="font-medium">{status.phone ? status.phone.replace(/\d(?=\d{2})/g, "*") : "No verified number"}</div><div className="text-sm text-muted-foreground">{status.phoneVerified ? "Verified phone" : "Verify phone before enabling WhatsApp MFA"}</div></div><Switch checked={status.whatsappEnabled} disabled={!status.phoneVerified} onCheckedChange={(checked) => updateMethod("whatsapp", checked, checked)} /></div>
              {status.whatsappStatus ? (
                <div className="rounded-md border border-border/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium">Runtime status</span>
                    <Badge variant={status.whatsappStatus.status === "CONNECTED" ? "default" : "secondary"}>{status.whatsappStatus.status || status.whatsappStatus.runtimeStatus || "Unknown"}</Badge>
                  </div>
                  <p className="mt-2 text-muted-foreground">Last ready: {time(status.whatsappStatus.lastReadyAt)} · Heartbeat: {time(status.whatsappStatus.workerHeartbeatAt)}</p>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2"><Label>Current password</Label><Input type="password" value={methodPassword} onChange={(event) => setMethodPassword(event.target.value)} /></div>
                <div className="space-y-2"><Label>Old number OTP</Label><Input inputMode="numeric" maxLength={6} value={phoneChange.oldOtp} onChange={(event) => setPhoneChange({ ...phoneChange, oldOtp: event.target.value.replace(/\D/g, "") })} /></div>
                <div className="flex items-end gap-2"><Button variant="outline" onClick={() => phoneChangeAction("start_old")} disabled={phoneChange.busy}>Send</Button><Button onClick={() => phoneChangeAction("verify_old")} disabled={phoneChange.busy || phoneChange.oldOtp.length !== 6}>Verify</Button></div>
                <div className="space-y-2"><Label>New number</Label><Input value={phoneChange.newPhone} onChange={(event) => setPhoneChange({ ...phoneChange, newPhone: event.target.value })} autoComplete="tel" /></div>
                <div className="space-y-2"><Label>New number OTP</Label><Input inputMode="numeric" maxLength={6} value={phoneChange.newOtp} onChange={(event) => setPhoneChange({ ...phoneChange, newOtp: event.target.value.replace(/\D/g, "") })} /></div>
                <div className="flex items-end gap-2 md:col-span-2"><Button variant="outline" onClick={() => phoneChangeAction("start_new")} disabled={phoneChange.busy || !phoneChange.oldVerified || !phoneChange.newPhone}>Send to New</Button><Button onClick={() => phoneChangeAction("verify_new")} disabled={phoneChange.busy || !phoneChange.oldVerified || phoneChange.newOtp.length !== 6}>Verify and Update</Button></div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Recovery Codes</CardTitle><CardDescription>Single-use backup codes for account recovery.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/40 p-3"><span className="text-sm text-muted-foreground">{status.backupCodesRemaining || 0} unused codes</span><Badge variant={status.recoveryCodesEnabled ? "default" : "secondary"}>{status.recoveryCodesEnabled ? "Enabled" : "Not enabled"}</Badge></div>
              <div className="grid gap-3 md:grid-cols-3"><div className="space-y-2 md:col-span-2"><Label>Password</Label><Input type="password" value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} /></div><div className="flex items-end"><Button onClick={() => recoveryAction("regenerate")}>Regenerate</Button></div></div>
              {recoveryCodes.length ? <div className="grid gap-2 sm:grid-cols-2">{recoveryCodes.map((code) => <code key={code} className="rounded bg-background/60 px-2 py-1 text-sm">{code}</code>)}</div> : <p className="text-sm text-muted-foreground">Existing recovery codes are never shown. Regenerate to display a new set once.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account" className="grid gap-4 xl:grid-cols-2">
          <Card className="glass border-border/40"><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Change admin email and display name.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>Name</Label><Input value={profile.displayName} onChange={(event) => setProfile({ ...profile, displayName: event.target.value })} /></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></div><div className="flex items-end"><Button onClick={saveProfile}><Save className="mr-2 h-4 w-4" />Save profile</Button></div></CardContent></Card>
          <Card className="glass border-border/40"><CardHeader><CardTitle>Password</CardTitle><CardDescription>Changing password revokes existing sessions.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-3"><div className="space-y-2"><Label>Current password</Label><Input type="password" value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} /></div><div className="space-y-2"><Label>New password</Label><Input type="password" value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} /></div><div className="flex items-end"><Button variant="outline" onClick={changePassword}>Change password</Button></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="activity" className="grid gap-4 xl:grid-cols-2">
          <Card className="glass border-border/40"><CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" />Trusted Devices</CardTitle><CardDescription>Browsers that can skip MFA unless login risk is high.</CardDescription></CardHeader><CardContent className="space-y-3">{status.trustedDevices?.length ? status.trustedDevices.map((device) => <div key={device.id} className="flex items-center justify-between gap-3 rounded-md border border-border/40 p-3 text-sm"><div><div className="font-medium">{deviceLine(device)}</div><div className="text-muted-foreground">{device.ip || "Unknown IP"} · {device.city || "Unknown"}, {device.country || "Unknown"} · trusted until {time(device.trustedUntil)}</div></div><Button variant="outline" size="icon" onClick={() => revokeTrustedDevice(device.id)}><Trash2 className="h-4 w-4" /></Button></div>) : <p className="text-sm text-muted-foreground">No trusted devices yet.</p>}</CardContent></Card>
          <Card className="glass border-border/40"><CardHeader><CardTitle className="flex items-center gap-2"><Laptop className="h-5 w-5" />Security Sessions</CardTitle><CardDescription>Browser, IP, device, location, and last active time.</CardDescription></CardHeader><CardContent className="space-y-3">{status.activeSessions?.length ? status.activeSessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/40 p-3 text-sm"><div><div className="font-medium">{deviceLine(session)}</div><div className="text-muted-foreground">{session.ip || "Unknown IP"} · {session.city || "Unknown"}, {session.country || "Unknown"} · last active {time(session.lastSeenAt)}</div></div><Button variant="outline" size="sm" onClick={() => revokeSession(session.id)}><RotateCcw className="mr-2 h-4 w-4" />Terminate</Button></div>) : <p className="text-sm text-muted-foreground">No active sessions found.</p>}</CardContent></Card>
          <Card className="glass border-border/40 xl:col-span-2"><CardHeader><CardTitle>Security Events</CardTitle><CardDescription>Recent MFA, recovery, trusted-device, and session events.</CardDescription></CardHeader><CardContent className="space-y-2">{status.securityEvents?.length ? status.securityEvents.map((event) => <div key={event.id} className="flex items-center justify-between rounded-md border border-border/40 p-3 text-sm"><span className="font-medium">{event.eventType}</span><span className="text-muted-foreground">{event.ip || "Unknown IP"} · {time(event.createdAt)}</span></div>) : <p className="text-sm text-muted-foreground">No security events recorded yet.</p>}</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
