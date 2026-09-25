"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function EmailVerificationActions({ email, redirectTo }: { email?: string | null; redirectTo?: string | null }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle")

  async function resend() {
    if (!email) return
    setState("sending")
    try {
      const res = await fetch("/api/auth/email-verification/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo }),
      })
      setState(res.ok ? "sent" : "error")
    } catch {
      setState("error")
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3">
      <Button type="button" onClick={resend} disabled={!email || state === "sending"}>
        {state === "sending" ? "Sending..." : "Resend verification email"}
      </Button>
      {state === "sent" ? <p className="text-sm text-muted-foreground">Verification email sent. Check your inbox.</p> : null}
      {state === "error" ? <p className="text-sm text-destructive">Could not send verification email. Try again shortly.</p> : null}
    </div>
  )
}
