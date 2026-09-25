"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function PhonePeBridgeModal({
  bridgeUrl,
  onClose,
}: {
  bridgeUrl: string
  onClose: () => void
}) {
  const [iframeFailed, setIframeFailed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setIframeFailed(true), 8000)
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data || {}
      if (data?.type !== "zws_payment_status") return
      if (data.status === "success" || data.status === "pending") {
        window.location.href = `/payment/status?order_id=${encodeURIComponent(data.orderId || data.merchantOrderId || "")}`
      }
      if (data.status === "failed") setIframeFailed(true)
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("message", onMessage)
    }
  }, [])

  return (
    <div className="overlay-layer fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4">
      <div className="interactive-layer w-full max-w-3xl overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <div>
            <h2 className="font-semibold">Secure PhonePe payment</h2>
            <p className="text-sm text-muted-foreground">Secure checkout opens through the configured payment gateway.</p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
        <div className="relative h-[70vh] bg-muted/10">
          {!iframeFailed ? (
            <>
              <div className="decorative-layer absolute inset-0 grid place-items-center" data-decorative-layer><Spinner className="h-6 w-6 text-accent" /></div>
              <iframe src={bridgeUrl} className="relative h-full w-full bg-background" title="PhonePe payment" />
            </>
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <h3 className="text-lg font-semibold">Continue to secure payment</h3>
                <p className="mt-2 text-sm text-muted-foreground">PhonePe may require opening checkout as a full page.</p>
                <Button className="mt-5" onClick={() => { window.location.href = bridgeUrl }}>Open secure payment</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
