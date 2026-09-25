'use client'

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field'
import { validateEmail } from '@/lib/auth-validation'
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.login

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate email
    const emailError = validateEmail(email)
    if (emailError) {
      setError(emailError)
      return
    }

    setLoading(true)
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        setError(data.error || "Unable to process request")
        return
      }
      setSubmitted(true)
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--border-selected)] bg-[var(--accent-subtle)] p-4">
          <p className="text-sm text-accent-foreground">
            Check your email for a password reset link. It may take a few minutes to arrive.
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to Login</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FieldGroup>
        <Field>
          <FieldLabel>Email Address</FieldLabel>
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading === true}
            autoComplete="email"
          />
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>

      <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} action="forgot_password" surface="login" siteKey={turnstile.siteKey} />

      <div className="space-y-3">
        <Button type="submit" disabled={loading === true || (captchaRequired && !turnstileToken)} className="w-full">
          {loading ? 'Sending...' : 'Send Reset Link'}
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to Login</Link>
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Remember your password?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  )
}
