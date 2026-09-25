"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldGroup, FieldError, FieldDescription } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { isValidEmail } from '@/lib/auth-validation'
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"
import { isCheckoutResumePath, safeClientReturnPath } from "@/lib/client/checkout-resume"

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string }

function mapLoginError(code?: string, fallback?: string) {
  if (code === "invalid_credentials") return "Invalid email or password."
  if (code === "email_verification_required") return "Verify your email address before signing in."
  if (code === "phone_verification_required") return "Verify your mobile number with the WhatsApp OTP before signing in."
  if (code === "user_not_found") return "No account exists for this email."
  if (code === "captcha_required") return "Complete the security verification before signing in."
  if (code === "captcha_expired") return "Security verification expired. Please complete it again."
  if (code === "captcha_invalid_token") return "Security verification was invalid. Please try again."
  if (code === "captcha_invalid_secret" || code === "captcha_not_configured") return "Security verification is not configured correctly. Please contact support."
  if (code === "captcha_provider_error") return "Security verification is temporarily unavailable. Please try again shortly."
  if (code === "security_blocked" || code === "ip_permanently_banned") return fallback || "Sign in blocked: IP permanently banned."
  if (code === "server_error") return "Login is temporarily unavailable. Please try again shortly."
  return fallback || "Unable to sign in right now."
}

function safeRedirectTarget(data: any, nextTo?: string) {
  const role = String(data?.role || "")
  const defaultTarget = role === "admin" || role === "support_agent"
    ? (data?.redirectTo || "/admin")
    : (data?.redirectTo || "/client-area")
  const next = safeClientReturnPath(nextTo)
  if ((role === "admin" || role === "support_agent") && next.startsWith("/admin")) return next
  if (role === "client" && (next.startsWith("/client-area") || next === "/suspended" || isCheckoutResumePath(next))) return next
  return defaultTarget
}

export function LoginForm({ nextTo }: { nextTo?: string }) {
  const router = useRouter()
  const redirectTimerRef = useRef<number | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({})
  const [state, setState] = useState<FormState>({ status: 'idle' })
  const [turnstileToken, setTurnstileToken] = useState("")
  const [turnstileReset, setTurnstileReset] = useState(0)
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.login

  const emailError =
    touched.email && email.length > 0 && !isValidEmail(email)
      ? 'Enter a valid email address.'
      : touched.email && email.length === 0
        ? 'Email is required.'
        : undefined

  const passwordError = touched.password && password.length === 0 ? 'Password is required.' : undefined

  const isSubmitting = state.status === 'submitting'
  const isRedirecting = state.status === 'success'
  const disabled = isSubmitting === true || isRedirecting === true || !email || !password || !!emailError || !!passwordError || (captchaRequired && !turnstileToken)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched({ email: true, password: true })
    if (!isValidEmail(email) || password.length === 0) return

    setState({ status: 'submitting' })
    let keepSubmitting = false
    const resetTurnstileForRetry = () => {
      setTurnstileToken("")
      setTurnstileReset((value) => value + 1)
    }
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, turnstileToken, "cf-turnstile-response": turnstileToken }),
      })

      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        resetTurnstileForRetry()
        setState({ status: 'error', message: mapLoginError(data?.code, data?.message || data?.error) })
        return
      }

      if ((data.code === 'two_factor_required' || data.code === 'mfa_required') && data.challengeToken) {
        const params = new URLSearchParams({
          challenge: data.challengeToken,
          email,
        })
        if (data.method) params.set("method", String(data.method))
        if (data.maskedTarget) params.set("target", String(data.maskedTarget))
        if (data.fallbackMessage) params.set("notice", String(data.fallbackMessage))
        if (data.riskLevel) params.set("risk", String(data.riskLevel))
        if (data.methods) params.set("methods", JSON.stringify(data.methods))
        if (nextTo) params.set("next", nextTo)
        keepSubmitting = true
        router.push(`/login/2fa?${params.toString()}`)
        return
      }

      if ((data.code === 'phone_verification_required' || data.code === 'phone_setup_required') && data.challengeToken) {
        const params = new URLSearchParams({
          challenge: data.challengeToken,
          email,
        })
        if (data.maskedPhone) params.set("phone", String(data.maskedPhone))
        if (data.code === 'phone_setup_required') params.set("setup", "1")
        if (nextTo) params.set("next", nextTo)
        keepSubmitting = true
        router.push(`/verify-phone?${params.toString()}`)
        return
      }

      const redirectTarget = safeRedirectTarget(data, nextTo)
      keepSubmitting = true
      setState({ status: 'success', message: 'Signed in. Redirecting...' })
      router.replace(redirectTarget)
      if (typeof window !== "undefined") {
        if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = window.setTimeout(() => {
          const targetUrl = new URL(redirectTarget, window.location.origin)
          if (window.location.pathname !== targetUrl.pathname || window.location.search !== targetUrl.search) {
            window.location.href = redirectTarget
          }
        }, 2000)
        window.setTimeout(() => {
          setState((current) => current.status === "success" ? { status: "idle" } : current)
        }, 10000)
      }
    } catch {
      resetTurnstileForRetry()
      setState({ status: 'error', message: 'Connection error. Please try again.' })
    } finally {
      if (!keepSubmitting) {
        setState((current) => current.status === 'submitting' ? { status: 'idle' } : current)
      }
    }
  }

  function updateField(setter: (value: string) => void, value: string) {
    if (state.status === "success") {
      if (redirectTimerRef.current && typeof window !== "undefined") {
        window.clearTimeout(redirectTimerRef.current)
        redirectTimerRef.current = null
      }
      setState({ status: "idle" })
    }
    setter(value)
  }

  return (
    <form onSubmit={handleSubmit} className="interactive-layer flex flex-col gap-6" noValidate>
      {state.status === 'error' && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}
      {state.status === 'success' && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-3 text-sm text-[var(--text-selected)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.message}</span>
        </div>
      )}

      <FieldGroup>
        <Field data-invalid={!!emailError || undefined}>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input id="login-email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => updateField(setEmail, e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} aria-invalid={!!emailError} required />
          {emailError && <FieldError>{emailError}</FieldError>}
        </Field>

        <Field data-invalid={!!passwordError || undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="login-password">Password</FieldLabel>
            <Link href="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link>
          </div>
          <div className="relative">
            <Input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => updateField(setPassword, e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} aria-invalid={!!passwordError} className="pr-10" required />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-2 flex items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label={showPassword ? 'Hide password' : 'Show password'} tabIndex={-1}>
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {passwordError && <FieldError>{passwordError}</FieldError>}
        </Field>
      </FieldGroup>

      <TurnstileWidget key={`login-turnstile-${turnstileReset}`} value={turnstileToken} onChange={setTurnstileToken} action="login" surface="login" siteKey={turnstile.siteKey} resetKey={turnstileReset} />

      <Button type="submit" className="w-full gap-1.5" disabled={disabled} aria-disabled={disabled}>
        {state.status === 'submitting' ? <><Spinner className="size-4" />Signing in</> : <>Log in<ArrowRight className="h-4 w-4" /></>}
      </Button>

      <FieldDescription className="text-center">
        Don&apos;t have an account? <Link href="/register" className="text-accent hover:underline">Create one</Link>
      </FieldDescription>
    </form>
  )
}
