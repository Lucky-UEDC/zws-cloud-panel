"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatsSkeleton } from "@/components/ui/page-skeletons"
import { formatCurrency } from "@/lib/currency-format"

type DashboardStats = {
  activeServices: number
  pendingInvoices: number
  openTickets: number
  walletBalance: number
  walletCurrency: string
}

export default function ClientAreaPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeServices: 0,
    pendingInvoices: 0,
    openTickets: 0,
    walletBalance: 0,
    walletCurrency: "INR",
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async function loadDashboard() {
    setLoading(true)
    setError(null)
    try {
      const [billingRes, walletRes, ticketsRes, vpsRes] = await Promise.all([
        fetch("/api/client/billing"),
        fetch("/api/client/wallet"),
        fetch("/api/client/tickets"),
        fetch("/api/client/vps"),
      ])

      const [billing, wallet, tickets, vps] = await Promise.all([
        billingRes.json(),
        walletRes.json(),
        ticketsRes.json(),
        vpsRes.json(),
      ])

      if (!billingRes.ok || !walletRes.ok || !ticketsRes.ok || !vpsRes.ok) throw new Error("Something could not load. Please retry.")
      {
        const serviceRows = Array.isArray(vps.items) ? vps.items : [...(vps.instances || []), ...(vps.pending || [])]
        const countableStatuses = new Set(["ACTIVE", "CREATING", "STARTING", "STOPPED", "START_FAILED"])
        const activeServices = serviceRows.filter((row: any) => countableStatuses.has(String(row.status || "").toUpperCase())).length
        const pendingInvoices = (billing.invoices || []).filter((i: any) => ["draft", "sent", "overdue"].includes(String(i.status))).length
        const openTickets = (tickets.tickets || []).filter((t: any) => String(t.status) !== "closed").length

        setStats({
          activeServices,
          pendingInvoices,
          openTickets,
          walletBalance: Number(wallet.balance || 0),
          walletCurrency: String(wallet.currency || "INR"),
        })
      }
    } catch (err: any) {
      setError(err?.message || "Something could not load. Please retry.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">Client Dashboard</h1>
        <p className="mt-1 text-muted-foreground">Manage cloud servers, billing, support, and account settings.</p>
      </div>

      {loading ? <StatsSkeleton /> : error ? (
        <Card className="border-red-400/20 bg-red-400/5">
          <CardContent className="flex flex-col items-start gap-3 p-5">
            <p className="font-medium">Something could not load. Please retry.</p>
            <Button onClick={loadDashboard} variant="outline">Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link href="/client-area/vps"><StatCard label="Active Services" value={String(stats.activeServices)} /></Link>
          <StatCard label="Pending Invoices" value={String(stats.pendingInvoices)} />
          <StatCard label="Open Tickets" value={String(stats.openTickets)} />
          <StatCard label="Wallet Balance" value={formatCurrency(stats.walletBalance, stats.walletCurrency)} />
        </div>
      )}

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Most common tasks in one place.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild><Link href="/client-area/deploy">Deploy Cloud Server</Link></Button>
          <Button asChild variant="outline"><Link href="/client-area/wallet">Top Up Wallet</Link></Button>
          <Button asChild variant="outline"><Link href="/client-area/billing">View Billing</Link></Button>
          <Button asChild variant="outline"><Link href="/client-area/support">Open Ticket</Link></Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
