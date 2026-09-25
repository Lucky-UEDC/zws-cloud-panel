"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState } from "react"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { TurnstileWidget, useTurnstileConfig } from "@/components/security/turnstile-widget"

export function DedicatedBookButton({ productId }: { productId: string }) {
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstile = useTurnstileConfig()
  const captchaRequired = turnstile.enabled && turnstile.protect.contact

  async function handleBookNow() {
    setLoading(true)
    try {
      const res = await fetch("/api/dedicated/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          sourcePath: typeof window !== "undefined" ? window.location.pathname + window.location.search : "/dedicated",
          intent: "book_now",
          turnstileToken,
        }),
      })

      const data = await readJsonResponse<any>(res)
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Unable to create booking inquiry")
      }

      if (data?.whatsappUrl) {
        window.open(String(data.whatsappUrl), "_blank", "noopener,noreferrer")
      }
    } catch (error) {
      console.error("[dedicated] book now failed", error)
      toast.error(error instanceof Error ? error.message : "Unable to create inquiry right now")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <TurnstileWidget value={turnstileToken} onChange={setTurnstileToken} action="dedicated_inquiry" surface="contact" siteKey={turnstile.siteKey} />
      <Button className="w-full gap-1.5" variant="outline" onClick={handleBookNow} disabled={loading || (captchaRequired && !turnstileToken)}>
        {loading ? "Booking..." : "Book Now"}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
