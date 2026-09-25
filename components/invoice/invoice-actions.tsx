"use client"

import { useState } from "react"
import { CreditCard, Download, Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { readJsonResponse } from "@/lib/client/safe-json"
import { paymentClientMessage } from "@/lib/client/payment-errors"

export function InvoiceActions({
  invoiceId,
  canPay,
  downloadUrl,
  payUrl,
  printLogUrl,
}: {
  invoiceId: string
  canPay: boolean
  downloadUrl: string
  payUrl?: string | null
  printLogUrl?: string | null
}) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePrint() {
    if (printLogUrl) {
      fetch(printLogUrl, { method: "POST" }).catch(() => null)
    }
    window.print()
  }

  async function handlePay() {
    if (!payUrl || paying) return
    setError(null)
    setPaying(true)
    try {
      const res = await fetch(payUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId }) })
      const data = await readJsonResponse<any>(res).catch(() => ({}))
      if (!res.ok) {
        const requestId = String(data?.requestId || res.headers.get("x-request-id") || "").trim()
        const mapped = paymentClientMessage({
          code: data?.code,
          message: data?.error || data?.message,
          fallback: "Payment could not be started. Please contact support.",
        })
        throw new Error(requestId ? `${mapped} (Ref: ${requestId})` : mapped)
      }
      await startPaymentRedirect(data)
    } catch (err) {
      const raw = err instanceof Error ? err.message : ""
      setError(paymentClientMessage({ message: raw, fallback: "Payment could not be started. Please contact support." }))
      setPaying(false)
    }
  }

  return (
    <div className="invoice-actions print:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
        <Button variant="outline" asChild>
          <a href={downloadUrl}>
            <Download className="mr-2 h-4 w-4" />
            Download PDF
          </a>
        </Button>
        {canPay && payUrl && (
          <Button onClick={handlePay} disabled={paying}>
            {paying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
            Pay Now
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
