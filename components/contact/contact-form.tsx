"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"
import { readJsonResponse } from "@/lib/client/safe-json"

type FormState = {
  name: string
  email: string
  company: string
  phone: string
  countryCode: string
  message: string
  verificationId: string
  verificationToken: string
}

export function ContactForm({ supportEmail }: { supportEmail?: string }) {
  const [form, setForm] = useState<FormState>({
    name: "",
    email: "",
    company: "",
    phone: "",
    countryCode: "IN",
    message: "",
    verificationId: "",
    verificationToken: "",
  })
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [otp, setOtp] = useState("")
  const [otpStatus, setOtpStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "verified">("idle")
  const [turnstileToken, setTurnstileToken] = useState("")
  const [turnstileReset, setTurnstileReset] = useState(0)
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.contact

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
    if (key === "phone" || key === "countryCode") {
      setOtp("")
      setOtpStatus("idle")
      setForm((f) => ({ ...f, verificationId: "", verificationToken: "" }))
    }
  }

  function validate() {
    const next: typeof errors = {}
    if (!form.name.trim()) next.name = "Please enter your name."
    if (!form.email.trim()) next.email = "Please enter a valid email."
    else if (!/^\S+@\S+\.\S+$/.test(form.email))
      next.email = "That email doesn't look right."
    if (!form.phone.trim()) next.phone = "Please verify your mobile number."
    if (!form.verificationToken) next.phone = "Verify your mobile number before submitting."
    if (!form.message.trim() || form.message.trim().length < 10)
      next.message = "Tell us a bit more — at least 10 characters."
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        if (data?.errors) setErrors(data.errors)
        throw new Error(data?.message || data?.error || "Request failed")
      }
      toast.success("Message sent", {
        description: "We'll get back to you within one business day.",
      })
      setForm({ name: "", email: "", company: "", phone: "", countryCode: "IN", message: "", verificationId: "", verificationToken: "" })
      setOtp("")
      setOtpStatus("idle")
      setTurnstileToken("")
      setTurnstileReset((value) => value + 1)
    } catch (error) {
      toast.error("Unable to send message", {
        description: error instanceof Error ? error.message : supportEmail ? `Please try again or email ${supportEmail}.` : "Please try again from the contact page.",
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function sendOtp() {
    if (!form.phone.trim()) {
      setErrors((current) => ({ ...current, phone: "Enter your mobile number first." }))
      return
    }
    setOtpStatus("sending")
    try {
      const res = await fetch("/api/security/contact-otp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: form.phone, countryCode: form.countryCode, firstName: form.name, turnstileToken }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.message || data?.error || "Unable to send OTP.")
      setForm((current) => ({ ...current, verificationId: data.verificationId || "", verificationToken: "" }))
      setOtpStatus("sent")
      setTurnstileToken("")
      setTurnstileReset((value) => value + 1)
      toast.success("OTP sent", { description: "Enter the code sent to your mobile number." })
    } catch (error) {
      setOtpStatus("idle")
      toast.error(error instanceof Error ? error.message : "Unable to send OTP.")
    }
  }

  async function verifyOtp() {
    if (!form.verificationId || otp.length !== 6) return
    setOtpStatus("verifying")
    try {
      const res = await fetch("/api/security/contact-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId: form.verificationId, phone: form.phone, countryCode: form.countryCode, otp }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || !data.verificationToken) throw new Error(data?.message || data?.error || "Invalid OTP.")
      setForm((current) => ({
        ...current,
        phone: data.phone || current.phone,
        countryCode: data.countryCode || current.countryCode,
        verificationId: data.verificationId || current.verificationId,
        verificationToken: data.verificationToken,
      }))
      setOtpStatus("verified")
      toast.success("Phone verified")
    } catch (error) {
      setOtpStatus("sent")
      toast.error(error instanceof Error ? error.message : "Invalid OTP.")
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field data-invalid={errors.name ? true : undefined}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Jane Doe"
              aria-invalid={!!errors.name}
            />
            {errors.name && <FieldError>{errors.name}</FieldError>}
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="email">Work email</FieldLabel>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="you@company.com"
              aria-invalid={!!errors.email}
            />
            {errors.email && <FieldError>{errors.email}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="company">Company</FieldLabel>
            <Input
              id="company"
              value={form.company}
              onChange={(e) => update("company", e.target.value)}
              placeholder="Company name (optional)"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+91 00000 00000"
            />
            {errors.phone && <FieldError>{errors.phone}</FieldError>}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto_auto]">
          <Field>
            <FieldLabel htmlFor="countryCode">Country</FieldLabel>
            <Input id="countryCode" value={form.countryCode} onChange={(e) => update("countryCode", e.target.value.toUpperCase())} maxLength={2} />
          </Field>
          <Field>
            <FieldLabel htmlFor="otp">Mobile OTP</FieldLabel>
            <Input id="otp" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" disabled={otpStatus === "verified"} />
          </Field>
          <Button type="button" variant="outline" onClick={sendOtp} disabled={otpStatus === "sending" || otpStatus === "verified" || (captchaRequired && !turnstileToken)}>
            {otpStatus === "sending" ? "Sending..." : "Send OTP"}
          </Button>
          <Button type="button" variant="outline" onClick={verifyOtp} disabled={!form.verificationId || otp.length !== 6 || otpStatus === "verifying" || otpStatus === "verified"}>
            {otpStatus === "verified" ? "Verified" : otpStatus === "verifying" ? "Verifying..." : "Verify"}
          </Button>
        </div>

        <Field data-invalid={errors.message ? true : undefined}>
          <FieldLabel htmlFor="message">How can we help?</FieldLabel>
          <Textarea
            id="message"
            rows={6}
            value={form.message}
            onChange={(e) => update("message", e.target.value)}
            placeholder="Tell us a bit about your workload, timelines, or questions."
            aria-invalid={!!errors.message}
          />
          {errors.message && <FieldError>{errors.message}</FieldError>}
        </Field>
      </FieldGroup>

      <TurnstileWidget key={turnstileReset} value={turnstileToken} onChange={setTurnstileToken} action="contact" surface="contact" siteKey={turnstile.siteKey} />

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          By submitting, you agree to our Privacy Policy.
        </p>
        <Button type="submit" disabled={submitting || otpStatus !== "verified" || (captchaRequired && !turnstileToken)} className="gap-1.5">
          {submitting ? (
            <>
              <Spinner className="size-4" />
              Sending
            </>
          ) : (
            <>
              Send message
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
