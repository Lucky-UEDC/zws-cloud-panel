"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, XCircle, Clock, ArrowRight, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { trackGaEvent } from "@/components/analytics/analytics-provider"
import { formatCurrency } from "@/lib/currency-format"

type PaymentStatus = "success" | "failed" | "pending" | "loading" | "error"

interface PaymentData {
  orderId?: string
  orderNumber: string
  vpsInstanceId?: string | null
  redirectUrl?: string | null
  amount: number
  currency?: string
  status: string
  purpose?: string | null
  verified?: boolean
  paymentMethod?: string
  invoiceNumber?: string
  testMode?: boolean
  environmentMode?: string
}

export function PaymentStatusContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams.get("order_id")
  const [status, setStatus] = useState<PaymentStatus>("loading")
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [pollAttempts, setPollAttempts] = useState(0)
  const purchaseTrackedRef = useRef(false)
  const isWalletTopup = paymentData?.purpose === "wallet_topup"
  const showVerifyButton = status === "pending" && pollStartedAt !== null && (Date.now() - pollStartedAt) >= 60000

  async function verifyPayment(forceVerify = false) {
    if (!orderId) return
    setVerifying(true)
    try {
      const response = await fetch(`/api/payments/status?order_id=${orderId}${forceVerify ? "&verify=1" : ""}`, { cache: "no-store" })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Failed to verify payment")
      setPaymentData(data)
      const paid = data?.verified || data?.status === "paid" || data?.status === "completed" || data?.status === "paid_waiting_installation"
      const failed = data?.status === "failed" || data?.status === "payment_failed"
      if (paid) {
        setStatus("success")
        router.push(data.redirectUrl || (data.purpose === "wallet_topup" ? "/client-area/wallet?topup=success" : "/client-area/vps"))
        return
      }
      if (failed) {
        setStatus("failed")
        return
      }
      setStatus("pending")
    } catch (verifyError: any) {
      setError(verifyError?.message || "Failed to verify payment status")
      setStatus("error")
    } finally {
      setVerifying(false)
    }
  }

  useEffect(() => {
    if (!orderId) {
      setStatus("error")
      setError("Order ID not found")
      return
    }

    let attempts = 0
    let delayMs = 2000
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    const maxAttempts = 40
    const maxDurationMs = 8 * 60 * 1000
    const startedAtMs = Date.now()
    setPollStartedAt(Date.now())
    setPollAttempts(0)

    async function checkStatus() {
      try {
        const response = await fetch(`/api/payments/status?order_id=${orderId}`)
        const data = await readJsonResponse<any>(response)

        if (!response.ok) {
          setStatus("error")
          setError(data.error || "Failed to fetch payment status")
          return
        }

        setPaymentData(data)
        
        if (data.verified || data.status === "completed" || data.status === "paid" || data.status === "paid_waiting_installation") {
          setStatus("success")
          if (!purchaseTrackedRef.current) {
            purchaseTrackedRef.current = true
            trackGaEvent("purchase", {
              value: Number(data.amount || 0),
              currency: data.currency || "INR",
              transaction_id: data.orderId || orderId,
            })
            if (data.vpsInstanceId) trackGaEvent("provision_success", { vps_instance_id: data.vpsInstanceId, order_id: data.orderId || orderId })
          }
          timer = setTimeout(() => router.push(data.redirectUrl || (data.purpose === "wallet_topup" ? "/client-area/wallet?topup=success" : "/client-area/vps")), 1200)
        } else if (data.status === "failed" || data.status === "payment_failed") {
          setStatus("failed")
        } else {
          setStatus("pending")
          attempts += 1
          setPollAttempts(attempts)
          const elapsed = Date.now() - startedAtMs
          if (!cancelled && attempts < maxAttempts && elapsed < maxDurationMs) {
            timer = setTimeout(checkStatus, delayMs)
            delayMs = Math.min(Math.floor(delayMs * 1.45), 15000)
          }
        }
      } catch {
        setStatus("error")
        setError("Failed to connect to server")
      }
    }

    checkStatus()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [orderId, router])

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="glass glass-strong rounded-2xl p-8">
          <Spinner className="mx-auto mb-4 h-12 w-12 text-accent" />
          <h1 className="text-xl font-semibold">Checking Payment Status</h1>
          <p className="mt-2 text-muted-foreground">Please wait while we verify your payment...</p>
        </div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="glass glass-strong rounded-2xl p-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold">Error</h1>
          <p className="mt-2 text-muted-foreground">{error}</p>
          <Button asChild className="mt-6">
            <Link href="/pricing">View plans</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (status === "pending") {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="glass glass-strong rounded-2xl p-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/10">
            <Clock className="h-8 w-8 text-amber-400" />
          </div>
          <h1 className="text-xl font-semibold">Waiting for payment confirmation...</h1>
          <p className="mt-2 text-muted-foreground">
            Waiting for payment confirmation...
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Polling attempt {pollAttempts}</p>
          {paymentData && (
            <div className="mt-6 rounded-lg bg-muted/20 p-4 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{isWalletTopup ? "Reference" : "Order"}</span>
                <span className="font-mono">{paymentData.orderNumber}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(paymentData.amount, paymentData.currency || "INR")}</span>
              </div>
            </div>
          )}
          <div className="mt-6">
            <Spinner className="mx-auto h-5 w-5 text-muted-foreground" />
          </div>
          {showVerifyButton ? (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button type="button" variant="outline" onClick={() => verifyPayment(true)} disabled={verifying}>
                {verifying ? "Verifying..." : "Verify payment"}
              </Button>
              <Button type="button" variant="outline" onClick={() => verifyPayment(false)} disabled={verifying}>
                Manual refresh
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  if (status === "failed") {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="glass glass-strong rounded-2xl p-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold">Payment failed or cancelled.</h1>
          <p className="mt-2 text-muted-foreground">
            Payment failed or cancelled.
          </p>
          {paymentData && (
            <div className="mt-6 rounded-lg bg-muted/20 p-4 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Order</span>
                <span className="font-mono">{paymentData.orderNumber}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold">{formatCurrency(paymentData.amount, paymentData.currency || "INR")}</span>
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link href={isWalletTopup ? "/client-area/wallet" : "/pricing"}>
                Try Again
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/support">Contact Support</Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  return (
    <div className="mx-auto max-w-lg text-center">
      <div className="glass glass-strong rounded-2xl p-8">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/10">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
          <h1 className="text-xl font-semibold">Payment successful</h1>
          <p className="mt-2 text-muted-foreground">
          {isWalletTopup ? "Wallet top-up successful. Your balance has been updated." : "Payment successful. Your cloud instance is now provisioning."}
        </p>
        
        {paymentData && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-muted/20 p-4 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{isWalletTopup ? "Reference" : "Order"}</span>
                <span className="font-mono">{paymentData.orderNumber}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span className="text-muted-foreground">Amount Paid</span>
                <span className="font-semibold text-emerald-400">
                  {formatCurrency(paymentData.amount, paymentData.currency || "INR")}
                </span>
              </div>
              {paymentData.paymentMethod && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Payment Method</span>
                  <span className="capitalize">{paymentData.paymentMethod}</span>
                </div>
              )}
              {paymentData.invoiceNumber && (
                <div className="mt-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-mono">{paymentData.invoiceNumber}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild>
            <Link href={isWalletTopup ? "/client-area/wallet" : "/client-area"}>
              {isWalletTopup ? "Go to Wallet" : "Go to Dashboard"}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {paymentData?.invoiceNumber && (
            <Button variant="outline" asChild>
              <Link href={`/invoice/${paymentData.invoiceNumber}`}>
                <Download className="mr-2 h-4 w-4" />
                Download Invoice
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
