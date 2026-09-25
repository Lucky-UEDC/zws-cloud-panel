"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { formatCurrency } from "@/lib/currency-format"

type BillingData = {
  invoices: Array<{ id: string; invoiceNumber: string; status: string; subtotal: number; taxAmount: number; gstPercent: number; gstAmount: number; discountAmount: number; totalAmount: number; currency?: string; issueDate: string; dueDate: string; createdAt: string; paidAt?: string | null }>
  payments: Array<{ id: string; status: string; purpose: string; amount: number; gatewayAmount?: number; walletAppliedAmount?: number; currency?: string; paymentMethod: string | null; gateway: string; gatewayOrderId?: string | null; transactionId?: string | null; gatewayTransactionId?: string | null; invoiceId?: string | null; createdAt: string; completedAt?: string | null }>
  orders: Array<{ id: string; orderNumber: string; status: string; provisioningStatus?: string; payableAmount: number; currency?: string; createdAt: string; invoices: Array<{ id: string; invoiceNumber: string }> }>
}

function statusTone(status: string) {
  const normalized = String(status || "").toLowerCase()
  if (["paid", "completed", "success"].includes(normalized)) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
  if (["failed", "payment_failed", "cancelled", "canceled"].includes(normalized)) return "border-red-400/30 bg-red-400/10 text-red-200"
  if (["pending", "waiting", "created", "initiated"].includes(normalized)) return "border-amber-400/30 bg-amber-400/10 text-amber-100"
  return "border-border/50 bg-foreground/10 text-muted-foreground"
}

function canPay(status: string) {
  return !["paid", "completed", "success", "cancelled", "canceled"].includes(String(status || "").toLowerCase())
}

export default function ClientBillingPage() {
  const [data, setData] = useState<BillingData>({ invoices: [], payments: [], orders: [] })

  useEffect(() => {
    ;(async () => {
      const res = await fetch("/api/client/billing")
      const json = await readJsonResponse<any>(res)
      if (res.ok) setData(json)
    })()
  }, [])

  async function payInvoice(id: string) {
    const res = await fetch(`/api/client/invoices/${id}/pay`, { method: "POST" })
    const json = await readJsonResponse<any>(res)
    if (!res.ok) throw new Error(json?.error || "Unable to start payment")
    await startPaymentRedirect(json)
  }

  async function printInvoice(id: string) {
    await fetch(`/api/client/invoices/${id}/print`, { method: "POST" }).catch(() => null)
    window.open(`/client-area/billing/invoices/${id}`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Billing</h1>
          <p className="text-muted-foreground">Orders, invoices, and payment history.</p>
        </div>
        <Button asChild><Link href="/client-area/wallet">Top Up Wallet</Link></Button>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Invoices</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-2">
            {data.invoices.slice(0, 6).map((inv) => {
              const invoicePayments = data.payments.filter((payment) => payment.invoiceId === inv.id)
              const latestPayment = invoicePayments[0]
              return (
                <div key={inv.id} className="rounded-lg border border-border/40 bg-background/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm">{inv.invoiceNumber}</div>
                      <div className="mt-1 text-xs text-muted-foreground">Issued {new Date(inv.issueDate || inv.createdAt).toLocaleDateString()} · Due {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusTone(inv.status)}`}>{inv.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><div className="text-muted-foreground">Subtotal</div><div>{formatCurrency(inv.subtotal, inv.currency || "INR")}</div></div>
                    <div><div className="text-muted-foreground">GST</div><div>{formatCurrency(inv.gstAmount ?? inv.taxAmount, inv.currency || "INR")} <span className="text-xs text-muted-foreground">({Number(inv.gstPercent || 0)}%)</span></div></div>
                    <div><div className="text-muted-foreground">Discount</div><div>{formatCurrency(inv.discountAmount || 0, inv.currency || "INR")}</div></div>
                    <div><div className="text-muted-foreground">Total</div><div className="font-semibold">{formatCurrency(inv.totalAmount, inv.currency || "INR")}</div></div>
                  </div>
                  <div className="mt-4 border-t border-border/30 pt-3 text-xs text-muted-foreground">
                    {latestPayment ? (
                      <div className="space-y-1">
                        <div>Latest payment: <span className="capitalize text-foreground">{latestPayment.gateway}</span> · <span className="capitalize">{latestPayment.status}</span></div>
                        <div className="break-all font-mono">Transaction: {latestPayment.gatewayTransactionId || latestPayment.transactionId || latestPayment.gatewayOrderId || "Waiting for gateway"}</div>
                      </div>
                    ) : (
                      <div>No payment attempt yet.</div>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline"><Link href={`/client-area/billing/invoices/${inv.id}`}>View Invoice</Link></Button>
                    <Button asChild size="sm" variant="outline"><a href={`/api/client/invoices/${inv.id}/download`}>Download PDF</a></Button>
                    {canPay(inv.status) ? <Button size="sm" onClick={() => void payInvoice(inv.id)}>{latestPayment ? "Retry Payment" : "Pay Now"}</Button> : null}
                  </div>
                </div>
              )
            })}
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-border/40 text-left text-muted-foreground"><th className="py-2">Invoice ID</th><th className="py-2">Date</th><th className="py-2">GST</th><th className="py-2">Due date</th><th className="py-2">Amount</th><th className="py-2">Status</th><th className="py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border/20">
                  <td className="py-2 font-mono">{inv.invoiceNumber}</td>
                  <td className="py-2">{new Date(inv.issueDate || inv.createdAt).toLocaleDateString()}</td>
                  <td className="py-2">{formatCurrency(inv.gstAmount ?? inv.taxAmount, inv.currency || "INR")}</td>
                  <td className="py-2">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "-"}</td>
                  <td className="py-2">{formatCurrency(inv.totalAmount, inv.currency || "INR")}</td>
                  <td className="py-2"><span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusTone(inv.status)}`}>{inv.status}</span></td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Button asChild size="sm" variant="outline"><Link href={`/client-area/billing/invoices/${inv.id}`}>View Invoice</Link></Button>
                      <Button asChild size="sm" variant="outline"><a href={`/api/client/invoices/${inv.id}/download`}>Download PDF</a></Button>
                      <Button size="sm" variant="outline" onClick={() => void printInvoice(inv.id)}>Print</Button>
                      {canPay(inv.status) ? <Button size="sm" onClick={() => void payInvoice(inv.id)}>Pay Now</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!data.invoices.length && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No invoices yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Recent Payments</CardTitle><CardDescription>Top-ups and order payments.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-border/40 text-left text-muted-foreground"><th className="py-2">When</th><th className="py-2">Purpose</th><th className="py-2">Method</th><th className="py-2">Amount</th><th className="py-2">Status</th></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className="border-b border-border/20"><td className="py-2">{new Date(p.createdAt).toLocaleString()}</td><td className="py-2">{p.purpose}</td><td className="py-2">{p.paymentMethod || p.gateway || "-"}</td><td className="py-2">{formatCurrency(p.amount, p.currency || "INR")}</td><td className="py-2"><span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{p.status}</span></td></tr>
              ))}
              {!data.payments.length && <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No payments yet.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
