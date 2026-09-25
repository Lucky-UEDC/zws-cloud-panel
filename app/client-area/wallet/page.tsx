"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { startPaymentRedirect, type PaymentRedirectResponse } from "@/lib/client/payment-redirect"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCurrency } from "@/lib/currency-format"

type WalletTransaction = {
  id: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  currency?: string
  status: string
  reason: string | null
  createdAt: string
}

type PendingTopup = PaymentRedirectResponse & {
  id: string
  invoiceId: string | null
  invoiceNumber: string | null
  amount: number
  currency?: string
  status: string
  createdAt: string
}

export default function ClientWalletPage() {
  const searchParams = useSearchParams()
  const [balance, setBalance] = useState(0)
  const [currency, setCurrency] = useState("INR")
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [pendingTopup, setPendingTopup] = useState<PendingTopup | null>(null)
  const [minimumTopupAmount, setMinimumTopupAmount] = useState(100)
  const [topupAmount, setTopupAmount] = useState("1000")
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupFee, setTopupFee] = useState<{ grossAmount: number; feePercent: number; fixedFee: number; feeAmount: number; netAmount: number } | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/client/wallet")
      const data = await readJsonResponse<any>(res)
      if (res.ok) {
        setBalance(Number(data.balance || 0))
        setCurrency(String(data.currency || "INR"))
        setMinimumTopupAmount(Number(data.minimumTopupAmount || 100))
        setTransactions(data.transactions || [])
        setPendingTopup(data.pendingTopup || null)
      } else {
        toast.error(data?.message || data?.error || "Wallet could not be loaded.")
      }
    } catch (error: any) {
      toast.error(error?.message || "Wallet could not be loaded.")
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (searchParams.get("topup") === "success") {
      toast.success("Wallet top-up completed.")
      void load()
    }
  }, [searchParams])

  const amountText = topupAmount.trim()
  const topupAmountNumber = /^\d+(\.\d{1,2})?$/.test(amountText) ? Number(amountText) : NaN
  const belowMinimum = Number.isFinite(topupAmountNumber) && topupAmountNumber > 0 && topupAmountNumber < minimumTopupAmount
  const isTopupAmountValid = Number.isFinite(topupAmountNumber) && topupAmountNumber > 0 && !belowMinimum
  const topupDisabled = topupLoading || !isTopupAmountValid

  async function topup() {
    if (topupLoading) return
    if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
      toast.error("Enter a numeric wallet top-up amount.")
      return
    }
    if (topupAmountNumber <= 0) {
      toast.error("Wallet top-up amount must be greater than zero.")
      return
    }
    if (topupAmountNumber < minimumTopupAmount) {
      toast.error(`Minimum top-up amount is ${formatCurrency(minimumTopupAmount, currency)}`)
      return
    }
    setTopupLoading(true)
    try {
      const res = await fetch("/api/client/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: topupAmountNumber }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || data?.ok === false) {
        toast.error(data?.message || data?.error || "Top-up failed")
        return
      }
      setTopupFee(data?.fee || null)
      await startPaymentRedirect(data)
    } catch (error: any) {
      toast.error(error?.message || "Top-up failed")
    } finally {
      setTopupLoading(false)
    }
  }

  async function continuePayment() {
    if (!pendingTopup) return
    try {
      await startPaymentRedirect(pendingTopup)
    } catch (error: any) {
      toast.error(error?.message || "Payment could not be resumed.")
    }
  }

  return (
    <div className="space-y-6">
      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Wallet Balance</CardTitle>
          <CardDescription>Available credits for billing and orders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-3xl font-semibold">{formatCurrency(balance, currency)}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              inputMode="decimal"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="max-w-xs"
            />
            <Button onClick={topup} disabled={topupDisabled}>{topupLoading ? "Starting..." : "Top Up"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Minimum top-up: {formatCurrency(minimumTopupAmount, currency)}</p>
          {topupFee && topupFee.feeAmount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Gateway fee approx. {formatCurrency(topupFee.feeAmount, currency)} ({Number(topupFee.feePercent) > 0 ? `${Number(topupFee.feePercent)}%` : ""}{Number(topupFee.fixedFee) > 0 ? ` + ${formatCurrency(topupFee.fixedFee, currency)}` : ""});{" "}
              {formatCurrency(topupFee.netAmount, currency)} will be credited.
            </p>
          ) : null}
          {belowMinimum ? (
            <p className="text-xs text-destructive">Minimum top-up amount is {formatCurrency(minimumTopupAmount, currency)}</p>
          ) : null}
          {pendingTopup ? (
            <div className="flex flex-col gap-3 rounded-lg border border-border/40 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Wallet top-up payment pending</p>
                <p className="text-xs text-muted-foreground">{formatCurrency(pendingTopup.amount || 0, pendingTopup.currency || currency)} via {pendingTopup.gateway}</p>
              </div>
              <Button variant="outline" onClick={continuePayment}>Continue payment</Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Wallet Transactions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border/40 text-left text-muted-foreground"><th className="py-2">Time</th><th className="py-2">Type</th><th className="py-2">Amount</th><th className="py-2">Before</th><th className="py-2">After</th><th className="py-2">Status</th><th className="py-2">Reason</th></tr></thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-border/20"><td className="py-2">{new Date(t.createdAt).toLocaleString()}</td><td className="py-2">{t.type}</td><td className="py-2">{formatCurrency(t.amount, t.currency || currency)}</td><td className="py-2">{formatCurrency(t.balanceBefore, t.currency || currency)}</td><td className="py-2">{formatCurrency(t.balanceAfter, t.currency || currency)}</td><td className="py-2">{t.status}</td><td className="py-2">{t.reason || "-"}</td></tr>
              ))}
              {!transactions.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No wallet transactions yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
