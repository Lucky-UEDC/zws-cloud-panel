"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { AnimatePresence, motion } from "framer-motion"
import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AlertCircle, ArrowRight, CheckCircle2, KeyRound, Mail, MessageCircle, RefreshCw, ShieldCheck, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"

type FormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "success" }

const methods = [
  { id: "totp", label: "Authenticator App", shortLabel: "Authenticator", icon: Smartphone },
  { id: "whatsapp", label: "WhatsApp OTP", shortLabel: "WhatsApp", icon: MessageCircle },
  { id: "email", label: "Email OTP", shortLabel: "Email", icon: Mail },
  { id: "recovery", label: "Recovery Code", shortLabel: "Recovery", icon: KeyRound },
  { id: "trusted_device", label: "Trusted Device", shortLabel: "Trusted Device", icon: ShieldCheck },
] as const

function methodCopy(method: string, target: string, email: string) {
  if (method === "whatsapp") return "Enter the 6-digit verification code sent to your WhatsApp number."
  if (method === "email") return `Enter the 6-digit email code sent to ${target || email || "your email"}.`
  if (method === "recovery") return "Enter one of your unused recovery codes."
  if (method === "trusted_device") return "OTP delivery is unavailable. Continue once using this trusted device."
  return `Enter the 6-digit code from your authenticator app for ${email || "your account"}.`
}

export function TwoFactorForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const challenge = searchParams.get("challenge") || ""
  const email = searchParams.get("email") || ""
  const initialMethod = searchParams.get("method") || "totp"
  const initialAvailableMethods = useMemo(() => {
    const raw = searchParams.get("methods")
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === "object" ? parsed as Record<string, boolean> : null
    } catch {
      return null
    }
  }, [searchParams])
  const target = searchParams.get("target") || ""
  const nextTo = searchParams.get("next") || ""
  const [method, setMethod] = useState(initialMethod)
  const [challengeToken, setChallengeToken] = useState(challenge)
  const [maskedTarget, setMaskedTarget] = useState(target)
  const [code, setCode] = useState("")
  const [trustDevice, setTrustDevice] = useState(false)
  const [state, setState] = useState<FormState>({ status: "idle" })
  const [resending, setResending] = useState(false)
  const [notice, setNotice] = useState(searchParams.get("notice") || "")
  const [availableMethods, setAvailableMethods] = useState<Record<string, boolean> | null>(initialAvailableMethods)

  const numeric = method !== "recovery" && method !== "trusted_device"
  const valid = method === "trusted_device" ? true : numeric ? code.replace(/\D/g, "").length === 6 : code.trim().length >= 6
  const description = useMemo(() => methodCopy(method, maskedTarget, email), [method, maskedTarget, email])
  const visibleMethods = useMemo(() => methods.filter((item) => availableMethods ? Boolean(availableMethods[item.id]) : item.id !== "totp" || method === "totp"), [availableMethods, method])

  useEffect(() => {
    if (!visibleMethods.some((item) => item.id === method) && visibleMethods[0]) setMethod(visibleMethods[0].id)
  }, [method, visibleMethods])

  async function switchMethod(nextMethod: string) {
    if (nextMethod === method) return
    if (!challengeToken) {
      setState({ status: "error", message: "Verification session expired" })
      return
    }
    const previousMethod = method
    setNotice("")
    setMethod(nextMethod)
    setCode("")
    setState({ status: "submitting" })
    try {
      const response = await fetch("/login/2fa/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken, method: nextMethod }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        setState({ status: "error", message: friendlyMfaError(data?.code, data?.error || data?.message) })
        if (data?.methods) setAvailableMethods(data.methods)
        return
      }
      const resolvedMethod = String(data.method || nextMethod)
      const nextChallenge = String(data.challengeToken || "")
      const nextTarget = String(data.maskedTarget || "")
      setChallengeToken(nextChallenge)
      setMaskedTarget(nextTarget)
      setMethod(resolvedMethod)
      setCode("")
      setNotice(String(data.fallbackMessage || ""))
      if (data.methods) setAvailableMethods(data.methods)
      setState({ status: "idle" })
      const params = new URLSearchParams(searchParams.toString())
      params.set("challenge", nextChallenge)
      params.set("method", resolvedMethod)
      if (nextTarget) params.set("target", nextTarget)
      if (data.fallbackMessage) params.set("notice", String(data.fallbackMessage))
      else params.delete("notice")
      router.replace(`/login/2fa?${params.toString()}`)
    } catch {
      setMethod(previousMethod)
      setState({ status: "error", message: "Connection error. Please try again." })
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!challengeToken || !valid) {
      setState({ status: "error", message: "Verification code is required." })
      return
    }

    setState({ status: "submitting" })
    try {
      const response = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken, code, method, trustDevice }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        setState({ status: "error", message: friendlyMfaError(data?.code, data?.error || data?.message) })
        return
      }
      setState({ status: "success" })
      const redirectTo = nextTo && nextTo.startsWith("/") && !nextTo.startsWith("//") ? nextTo : data.redirectTo || "/client-area"
      setTimeout(() => router.replace(redirectTo), 500)
    } catch {
      setState({ status: "error", message: "Connection error. Please try again." })
    }
  }

  async function resend() {
    setResending(true)
    setNotice("")
    try {
      const response = await fetch("/api/auth/2fa/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) setState({ status: "error", message: data.error || "Unable to resend code." })
      else {
        if (data.maskedTarget) setMaskedTarget(String(data.maskedTarget))
        if (data.method) setMethod(String(data.method))
        if (data.fallbackMessage) setNotice(String(data.fallbackMessage))
        if (data.availableMethods) setAvailableMethods(data.availableMethods)
        setState({ status: "idle" })
      }
    } catch {
      setState({ status: "error", message: "Connection error. Please try again." })
    } finally {
      setResending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col gap-6 overflow-hidden rounded-2xl" noValidate>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 -top-20 h-44 rounded-full bg-cyan-400/15 blur-3xl"
        animate={{ opacity: [0.35, 0.75, 0.35], scale: [0.95, 1.05, 0.95] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative rounded-xl border border-cyan-300/15 bg-white/[0.03] p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
            <ShieldCheck className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100">Security Verification</p>
            <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>
            {method === "whatsapp" && maskedTarget ? <p className="mt-2 text-xs text-cyan-200">OTP sent to WhatsApp ending in {maskedTarget}</p> : null}
            {method === "trusted_device" ? <p className="mt-2 text-xs text-amber-200">This bypass is single-use and expires with this session.</p> : null}
          </div>
        </div>
      </div>

      <StatusMessages state={state} notice={notice} />

      <div className="relative space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Try another verification method</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {visibleMethods.map((item) => (
            <MethodCard
              key={item.id}
              active={method === item.id}
              disabled={state.status === "submitting"}
              icon={item.icon}
              label={item.label}
              shortLabel={item.shortLabel}
              onClick={() => switchMethod(item.id)}
            />
          ))}
        </div>
      </div>

      <div className="relative space-y-3">
        <Label htmlFor="login-otp" className="text-slate-200">
          {method === "whatsapp" ? "WhatsApp verification code" : method === "recovery" ? "Recovery code" : method === "email" ? "Email verification code" : "Authentication code"}
        </Label>
        {method === "trusted_device" ? (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
            Continue using the trusted browser already registered on this account.
          </div>
        ) : numeric ? (
          <InputOTP
            id="login-otp"
            maxLength={6}
            value={code}
            onChange={(value) => setCode(value.replace(/\D+/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Six digit verification code"
            containerClassName="grid grid-cols-6 gap-2"
          >
            <InputOTPGroup className="contents">
              {Array.from({ length: 6 }).map((_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="h-12 w-full rounded-xl border border-slate-700/80 bg-slate-950/80 text-base font-semibold text-slate-50 shadow-inner shadow-black/30 transition data-[active=true]:border-cyan-300 data-[active=true]:ring-2 data-[active=true]:ring-cyan-300/30 sm:h-14"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        ) : (
          <Input
            id="login-otp"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={32}
            placeholder="ABC123-DEF456"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="h-12 border-slate-700/80 bg-slate-950/80 text-slate-50 placeholder:text-slate-600"
          />
        )}
        {code && !valid ? <p className="text-sm text-rose-300">{method === "recovery" ? "Enter a valid recovery code." : "Enter the 6-digit verification code."}</p> : null}
      </div>

      <div className="relative flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
        <div className="min-w-0">
          <Label htmlFor="trust-device" className="text-sm text-slate-200">Trust this device</Label>
          <p className="mt-1 text-xs text-slate-500">Skip MFA here for 30 days.</p>
        </div>
        <Switch id="trust-device" checked={trustDevice} onCheckedChange={(checked) => setTrustDevice(Boolean(checked))} aria-label="Trust this device for 30 days" />
      </div>

      <Button
        type="submit"
        className="relative h-12 w-full gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 font-semibold text-slate-950 shadow-[0_0_32px_rgba(56,189,248,0.28)] hover:from-cyan-300 hover:to-blue-400"
        disabled={state.status === "submitting" || !valid}
      >
        {state.status === "submitting" ? <><Spinner className="size-4" />verifying secure session...</> : <>Verify & Continue<ArrowRight className="size-4" /></>}
      </Button>

      {(method === "whatsapp" || method === "email") ? (
        <Button type="button" variant="outline" className="relative h-11 w-full gap-2 border-slate-700 bg-slate-950/50 text-slate-200 hover:bg-slate-900" onClick={resend} disabled={resending}>
          <RefreshCw className={resending ? "size-4 animate-spin" : "size-4"} />
          Resend code
        </Button>
      ) : null}

      <Button type="button" variant="ghost" className="relative w-full text-slate-400 hover:text-slate-100" onClick={() => router.push("/login")}>
        Start over
      </Button>
    </form>
  )
}

function StatusMessages({ state, notice }: { state: FormState; notice: string }) {
  return (
    <AnimatePresence mode="popLayout">
      {notice ? (
        <motion.div
          key="notice"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="relative flex items-start gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </motion.div>
      ) : null}
      {state.status === "error" ? (
        <motion.div
          key="error"
          role="alert"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="relative flex items-start gap-3 rounded-xl border border-rose-300/25 bg-rose-400/10 p-3 text-sm text-rose-100"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.message} Try again or switch verification method.</span>
        </motion.div>
      ) : null}
      {state.status === "success" ? (
        <motion.div
          key="success"
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="relative flex items-start gap-3 rounded-xl border border-emerald-300/25 bg-emerald-400/10 p-3 text-sm text-emerald-100"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>Verification successful. Redirecting...</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function MethodCard({
  active,
  disabled,
  icon: Icon,
  label,
  shortLabel,
  onClick,
}: {
  active: boolean
  disabled: boolean
  icon: ComponentType<{ className?: string }>
  label: string
  shortLabel: string
  onClick: () => void
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-cyan-300/70 bg-cyan-300/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.18)]" : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:bg-slate-900/80 hover:text-slate-100"}`}
    >
      <Icon className="size-5" />
      <span className="text-xs font-medium leading-tight">{shortLabel}</span>
    </motion.button>
  )
}

function friendlyMfaError(code?: string, fallback?: string) {
  if (code === "mfa_session_expired") return "Verification session expired"
  if (code === "mfa_code_expired") return "Code expired. Try next code."
  if (code === "mfa_totp_not_configured") return "Authenticator not configured properly."
  if (code === "mfa_totp_reenroll_required") return "Authenticator needs to be re-enrolled"
  if (code === "invalid_mfa_code") return "Enter the 6-digit verification code."
  if (code === "mfa_method_unavailable") return "This verification method is not available for your account."
  if (code === "mfa_whatsapp_unavailable") return "WhatsApp is not connected. Check the Evolution API instance and try again."
  if (code === "mfa_whatsapp_send_failed") return "WhatsApp OTP could not be sent. Try again or use another method."
  if (code === "mfa_otp_rate_limited") return fallback || "Too many OTP requests. Please wait before trying again."
  return fallback || "Verification failed."
}
