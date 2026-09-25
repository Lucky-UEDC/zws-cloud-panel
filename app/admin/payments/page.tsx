"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { Fragment, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Payment = {
  id: string
  amount: number
  status: string
  gateway: string
  gatewayOrderId?: string | null
  gatewayPaymentId?: string | null
  transactionId?: string | null
  gatewayTransactionId?: string | null
  verified?: boolean
  verifiedAt?: string | null
  completedAt?: string | null
  createdAt: string
  customer: { email: string; name?: string | null } | null
  order?: { orderNumber: string; status?: string | null } | null
  invoice?: { invoiceNumber: string } | null
  checkoutSession?: { referenceId: string; status: string; purpose: string; fulfilledOrderId?: string | null } | null
  paymentDetails?: any
  paymentAttempts?: any[]
  webhookEvents?: any[]
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [filters, setFilters] = useState({ gateway: "all", status: "all", domain: "", search: "" })
  const [expanded, setExpanded] = useState("")
  const [repairing, setRepairing] = useState(false)
  const stats = {
    successful: payments.filter((payment) => ["completed", "paid", "success"].includes(String(payment.status || "").toLowerCase())).length,
    pending: payments.filter((payment) => ["pending", "waiting", "created", "started", "initiated", "verification_pending"].includes(String(payment.status || "").toLowerCase())).length,
    failed: payments.filter((payment) => ["failed", "payment_failed", "cancelled", "canceled"].includes(String(payment.status || "").toLowerCase())).length,
    retryable: payments.filter((payment) => ["failed", "payment_failed", "pending", "waiting"].includes(String(payment.status || "").toLowerCase())).length,
    webhookLogs: payments.reduce((count, payment) => count + Number(payment.webhookEvents?.length || 0), 0),
    provisioning: payments.filter((payment) => payment.checkoutSession?.fulfilledOrderId || payment.order?.status === "paid").length,
  }

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filters.gateway !== "all") params.set("gateway", filters.gateway)
    if (filters.status !== "all") params.set("status", filters.status)
    if (filters.domain) params.set("domain", filters.domain)
    if (filters.search) params.set("search", filters.search)
    const res = await fetch(`/api/admin/payments?${params}`)
    const data = await readJsonResponse<any>(res)
    if (res.ok) setPayments(data.payments || [])
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  async function syncPayment(payment: Payment) {
    try {
      const res = await fetch("/api/admin/payments/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: payment.order?.orderNumber || payment.gatewayOrderId }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Sync failed")
      const verification = data?.verification
      if (verification === "credited") toast.success("Gateway verified: wallet credited")
      else if (verification === "already_credited") toast.success("Gateway verified: already credited")
      else if (verification === "failed") toast.error("Gateway verified: payment failed")
      else if (verification === "amount_mismatch") toast.error("Gateway verified: amount mismatch, credit blocked")
      else toast.success(data.result?.paid ? "Payment synced as paid" : "Payment status synced")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Sync failed")
    }
  }

  async function runRepair() {
    setRepairing(true)
    try {
      const res = await fetch("/api/admin/payments/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100, dryRun: false }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || !data.success) throw new Error(data.error || "Repair failed")
      toast.success("Payment repair completed")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Repair failed")
    } finally {
      setRepairing(false)
    }
  }

  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Successful payments" value={stats.successful} tone="text-emerald-300" />
          <Metric label="Pending invoices" value={stats.pending} tone="text-amber-200" />
          <Metric label="Failed payments" value={stats.failed} tone="text-red-300" />
          <Metric label="Retry payments" value={stats.retryable} tone="text-sky-200" />
          <Metric label="Webhook logs" value={stats.webhookLogs} tone="text-violet-200" />
          <Metric label="Provisioning status" value={stats.provisioning} tone="text-teal-200" />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/payments/health">Open Health Dashboard</Link>
          </Button>
          <Button type="button" variant="outline" onClick={runRepair} disabled={repairing}>
            {repairing ? "Repairing..." : "Repair Payment"}
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={filters.gateway} onValueChange={(gateway) => setFilters({ ...filters, gateway })}><SelectTrigger><SelectValue placeholder="Gateway" /></SelectTrigger><SelectContent><SelectItem value="all">All gateways</SelectItem><SelectItem value="cashfree">Cashfree</SelectItem><SelectItem value="phonepe">PhonePe</SelectItem><SelectItem value="manual">Manual</SelectItem><SelectItem value="wallet">Wallet</SelectItem></SelectContent></Select>
          <Select value={filters.status} onValueChange={(status) => setFilters({ ...filters, status })}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="verification_pending">Verification pending</SelectItem></SelectContent></Select>
          <Input placeholder="Domain" value={filters.domain} onChange={(event) => setFilters({ ...filters, domain: event.target.value })} />
          <Input placeholder="Transaction / order search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
          <Button type="button" onClick={load}>Apply filters</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border/40 text-left text-muted-foreground"><th className="py-2">Date</th><th className="py-2">Customer</th><th className="py-2">Session</th><th className="py-2">Invoice</th><th className="py-2">Gateway</th><th className="py-2">Amount</th><th className="py-2">Status</th><th className="py-2">Transaction ID</th><th className="py-2">Gateway Order ID</th><th className="py-2">Merchant Order ID</th><th className="py-2">Paid at</th><th className="py-2 text-right">Actions</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <Fragment key={p.id}>
                  <tr key={p.id} className="border-b border-border/20"><td className="py-2">{new Date(p.createdAt).toLocaleString()}</td><td className="py-2">{p.customer?.email || "-"}</td><td className="py-2"><div className="font-mono text-xs">{p.checkoutSession?.referenceId || "-"}</div><div className="text-xs text-muted-foreground">{p.checkoutSession?.status || ""}</div></td><td className="py-2">{p.invoice?.invoiceNumber || "-"}</td><td className="py-2">{p.gateway}</td><td className="py-2">₹{Number(p.amount).toLocaleString("en-IN")}</td><td className="py-2"><div>{p.status}</div><div className="text-xs text-muted-foreground">{p.verified ? "Verified" : "Pending verification"}</div></td><td className="py-2 font-mono text-xs">{p.paymentDetails?.transactionLabel || "Pending gateway confirmation"}</td><td className="py-2 font-mono text-xs">{p.paymentDetails?.gatewayOrderId || p.gatewayOrderId || "-"}</td><td className="py-2 font-mono text-xs">{p.paymentDetails?.merchantOrderId || "-"}</td><td className="py-2">{p.verifiedAt ? new Date(p.verifiedAt).toLocaleString() : p.paymentDetails?.paidAt ? new Date(p.paymentDetails.paidAt).toLocaleString() : "-"}</td><td className="py-2 text-right"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setExpanded(expanded === p.id ? "" : p.id)}>Details</Button><Button size="sm" variant="outline" onClick={() => syncPayment(p)}>Verify with gateway</Button></div></td></tr>
                  {expanded === p.id ? <tr className="border-b border-border/20"><td colSpan={12} className="py-3"><pre className="max-h-80 overflow-auto rounded-lg bg-background/60 p-3 text-xs">{JSON.stringify({ checkoutSession: p.checkoutSession, attempts: p.paymentAttempts, webhookEvents: p.webhookEvents }, null, 2)}</pre></td></tr> : null}
                </Fragment>
              ))}
              {!payments.length && <tr><td className="py-8 text-center text-muted-foreground" colSpan={12}>No payments found.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border/40 bg-background/40 p-3">
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
