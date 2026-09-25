"use client"

import { FormEvent, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"
import { safeClientReturnPath } from "@/lib/client/checkout-resume"

function safeNext(value: string | null) {
  const checkoutReturn = safeClientReturnPath(value)
  if (checkoutReturn) return checkoutReturn
  if (value && value.startsWith("/client-area") && !value.startsWith("//")) return value
  if (value === "/suspended") return value
  return "/client-area"
}

export default function VerifyPhonePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const challengeToken = searchParams.get("challenge") || ""
  const maskedPhone = searchParams.get("phone") || "your WhatsApp number"
  const isSetupMode = searchParams.get("setup") === "1"
  const nextTo = useMemo(() => safeNext(searchParams.get("next")), [searchParams])
  const [otp, setOtp] = useState("")
  const [phone, setPhone] = useState("")
  const [editingPhone, setEditingPhone] = useState(isSetupMode)
  const [otpSent, setOtpSent] = useState(!isSetupMode)
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(path)
    setMessage(null)
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken, ...body }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || "Request failed")
      return data
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Request failed" })
      return null
    } finally {
      setBusy("")
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = await post("/api/auth/phone/login/verify", { otp })
    if (!data) return
    setMessage({ type: "success", text: "Phone verified. Redirecting..." })
    router.replace(data.redirectTo || nextTo)
  }

  async function resend() {
    const data = await post("/api/auth/phone/login/resend", {})
    if (data) setMessage({ type: "success", text: `OTP resent to ${data.toMasked || maskedPhone}.` })
  }

  async function savePhone() {
    const data = await post("/api/auth/phone/login/edit", { phone })
    if (data) {
      setEditingPhone(false)
      setOtpSent(true)
      setMessage({ type: "success", text: `OTP sent to ${data.toMasked || "updated number"}.` })
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{isSetupMode ? "Add WhatsApp number" : "Verify WhatsApp number"}</CardTitle>
          <CardDescription>
            {isSetupMode
              ? "Add your WhatsApp number to secure your account and complete sign in."
              : `Enter the OTP sent to ${maskedPhone} to finish signing in.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!challengeToken ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Verification session missing. Please sign in again.
            </div>
          ) : null}
          {message ? (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${message.type === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"}`}>
              {message.type === "error" ? <AlertCircle className="mt-0.5 h-4 w-4" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
              <span>{message.text}</span>
            </div>
          ) : null}

          {editingPhone || !otpSent ? (
            <div className="space-y-3 rounded-lg border border-border/50 p-3">
              <Label htmlFor="new-phone">WhatsApp number with country code</Label>
              <Input id="new-phone" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="919876543210" autoComplete="tel" />
              <div className="flex gap-2">
                <Button type="button" onClick={savePhone} disabled={!phone.trim() || Boolean(busy)}>Send OTP</Button>
                {otpSent && <Button type="button" variant="outline" onClick={() => setEditingPhone(false)}>Cancel</Button>}
              </div>
            </div>
          ) : null}

          {otpSent && !editingPhone ? (
            <form className="space-y-3" onSubmit={verify}>
              <div className="space-y-2">
                <Label htmlFor="phone-otp">OTP code</Label>
                <Input id="phone-otp" inputMode="numeric" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" />
              </div>
              <Button type="submit" className="w-full" disabled={!challengeToken || otp.length !== 6 || Boolean(busy)}>
                {busy === "/api/auth/phone/login/verify" ? "Verifying..." : "Verify and sign in"}
              </Button>
            </form>
          ) : null}

          {otpSent && !editingPhone ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={resend} disabled={!challengeToken || Boolean(busy)}>
                <RefreshCw className="h-4 w-4" />
                Resend OTP
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditingPhone(true)} disabled={!challengeToken || Boolean(busy)}>Edit number</Button>
              <Button asChild variant="ghost"><Link href="/login">Back to login</Link></Button>
            </div>
          ) : (
            <Button asChild variant="ghost"><Link href="/login">Back to login</Link></Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
