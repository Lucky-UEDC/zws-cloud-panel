'use client'

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState } from 'react'
import { useSearchParams } from "next/navigation"
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field'
import { validatePassword } from '@/lib/auth-validation'
import { PasswordStrengthMeter } from './password-strength'

export function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") || ""
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({ password: '', confirmPassword: '', general: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors = { password: '', confirmPassword: '', general: '' }

    // Validate password
    const passwordError = validatePassword(password)
    if (passwordError) {
      newErrors.password = passwordError
    }

    // Validate confirmation
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password'
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match'
    }

    setErrors(newErrors)
    if (Object.values(newErrors).some(e => e)) return

    setLoading(true)
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) {
        setErrors((prev) => ({ ...prev, general: data.error || "Unable to reset password" }))
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
            Your password has been reset successfully. You can now sign in with your new password.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FieldGroup>
        {errors.general && (
          <Field>
            <FieldError>{errors.general}</FieldError>
          </Field>
        )}
        <Field>
          <FieldLabel>New Password</FieldLabel>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading === true}
            autoComplete="new-password"
          />
          {password && <PasswordStrengthMeter password={password} />}
          {errors.password && <FieldError>{errors.password}</FieldError>}
        </Field>
      </FieldGroup>

      <FieldGroup>
        <Field>
          <FieldLabel>Confirm Password</FieldLabel>
          <Input
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading === true}
            autoComplete="new-password"
          />
          {errors.confirmPassword && <FieldError>{errors.confirmPassword}</FieldError>}
        </Field>
      </FieldGroup>

      <div className="space-y-3">
        <Button type="submit" disabled={loading === true} className="w-full">
          {loading ? 'Resetting Password...' : 'Reset Password'}
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to Login</Link>
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Know your password?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in instead
        </Link>
      </p>
    </form>
  )
}
