"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { Activity, ArrowDownRight, ArrowUpRight, Banknote, CircleDollarSign, Download, Radio, ReceiptText } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const RANGES = [
  ["24h", "24H"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["90d", "90D"],
  ["1y", "1Y"],
]

const MODES = ["Revenue", "Payments", "Invoices", "Growth", "Taxes"]
const SOURCE_COLORS = ["#00E5FF", "#0094FF", "#7C3AED", "#10B981", "#F59E0B"]

type SeriesPoint = {
  date: string
  label: string
  grossRevenue: number
  netRevenue: number
  gatewayRevenue: number
  walletRevenue: number
  walletFlow: number
  credits: number
  refunds: number
  discounts: number
  pendingInvoiceAmount: number
  gstCollected: number
  paidInvoices: number
  growthPercent: number
}

function compactMoney(value: unknown) {
  const n = Number(value || 0)
  const abs = Math.abs(n)
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`
  if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

function money(value: unknown) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

function pct(value: unknown) {
  const n = Number(value || 0)
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`
}

function trendClass(value: unknown) {
  return Number(value || 0) >= 0 ? "text-emerald-300" : "text-red-300"
}

export default function AdminRevenuePage() {
  const [range, setRange] = useState("30d")
  const [mode, setMode] = useState("Revenue")
  const [live, setLive] = useState(false)
  const [filters, setFilters] = useState({ start: "", end: "", node: "", product: "", country: "" })
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function load(silent = false) {
      if (!silent) setLoading(true)
      const params = new URLSearchParams({ range })
      for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
      const res = await fetch(`/api/admin/revenue?${params.toString()}`, { cache: "no-store" })
      const payload = await readJsonResponse<any>(res)
      if (cancelled) return
      if (!res.ok) {
        setError(payload?.error || "Unable to load revenue analytics")
        setData(null)
      } else {
        setError(null)
        setData(payload)
      }
      if (!silent) setLoading(false)
    }

    void load(false)
    if (live) timer = setInterval(() => void load(true), 30000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [live, range, filters])

  const cards = data?.cards || {}
  const series: SeriesPoint[] = data?.series || []
  const insights = data?.insights || {}
  const hasRevenue = series.some((point) => Number(point.grossRevenue) > 0)
  const paymentMix = useMemo(() => [
    { name: "Gateway service", value: Number(cards.gatewayPayments || 0) },
    { name: "Wallet service", value: Number(cards.walletPayments || 0) },
    { name: "Wallet flow", value: Number(cards.walletFlow || 0) },
  ].filter((item) => item.value > 0), [cards.gatewayPayments, cards.walletPayments, cards.walletFlow])

  const kpis = [
    { label: "Today's Revenue", value: compactMoney(cards.todayRevenue), raw: cards.todayRevenue, icon: CircleDollarSign, accent: "text-[var(--accent-primary)]", metric: "grossRevenue" },
    { label: "Monthly Revenue", value: compactMoney(cards.monthlyRevenue), raw: cards.monthlyRevenue, icon: Banknote, accent: "text-blue-300", metric: "netRevenue" },
    { label: "Annual Revenue", value: compactMoney(cards.annualRevenue), raw: cards.annualRevenue, icon: Activity, accent: "text-purple-300", metric: "grossRevenue" },
    { label: "Pending Payments", value: String(cards.pendingPayments || 0), raw: cards.pendingPayments, icon: ReceiptText, accent: "text-amber-300", metric: "pendingInvoiceAmount" },
    { label: "Collected GST", value: compactMoney(cards.collectedGst), raw: cards.collectedGst, icon: ReceiptText, accent: "text-emerald-300", metric: "gstCollected" },
    { label: "Refunds", value: compactMoney(cards.refunds), raw: cards.refunds, icon: ReceiptText, accent: "text-rose-300", metric: "refunds" },
    { label: "MRR", value: compactMoney(cards.mrr), raw: cards.mrr, icon: Banknote, accent: "text-cyan-300", metric: "netRevenue" },
    { label: "ARR", value: compactMoney(cards.arr), raw: cards.arr, icon: CircleDollarSign, accent: "text-violet-300", metric: "grossRevenue" },
    { label: "Average Order Value", value: compactMoney(cards.averageOrderValue), raw: cards.averageOrderValue, icon: Activity, accent: "text-lime-300", metric: "grossRevenue" },
  ]

  function exportUrl(format: "pdf" | "csv" | "excel") {
    const params = new URLSearchParams({ range, format })
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
    return `/api/admin/revenue?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      <section className="surface-card relative overflow-hidden rounded-2xl border p-5 shadow-2xl shadow-black/25">
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(148,163,184,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.08)_1px,transparent_1px)] [background-size:36px_36px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />
              ZWS FinOps Intelligence
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Revenue Analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Paid service revenue, wallet flow, gateway captures, invoice risk, and growth signals in one cloud billing command center.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={range === value ? "default" : "outline"} onClick={() => setRange(value)}>
                {label}
              </Button>
            ))}
            <Button type="button" size="sm" variant={live ? "default" : "outline"} onClick={() => setLive((value) => !value)}>
              <Radio className="h-4 w-4" /> Live
            </Button>
            <Button asChild type="button" size="sm" variant="outline"><a href={exportUrl("pdf")}>PDF</a></Button>
            <Button asChild type="button" size="sm" variant="outline"><a href={exportUrl("csv")}>CSV</a></Button>
            <Button asChild type="button" size="sm" variant="outline"><a href={exportUrl("excel")}>Excel</a></Button>
          </div>
        </div>
      </section>
      <Card className="glass border-border/40">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-5">
          <Input type="date" value={filters.start} onChange={(event) => setFilters((current) => ({ ...current, start: event.target.value }))} />
          <Input type="date" value={filters.end} onChange={(event) => setFilters((current) => ({ ...current, end: event.target.value }))} />
          <Input placeholder="Node" value={filters.node} onChange={(event) => setFilters((current) => ({ ...current, node: event.target.value }))} />
          <Input placeholder="Product" value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))} />
          <Input placeholder="Country" value={filters.country} onChange={(event) => setFilters((current) => ({ ...current, country: event.target.value }))} />
        </CardContent>
      </Card>

      {error ? <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading && !data ? <RevenueSkeleton /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {kpis.map((item) => <KpiCard key={item.label} item={item} series={series} trend={insights.revenueTrendPercent} />)}
          </div>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
            <Card className="glass-strong overflow-hidden border-[var(--border-primary)]">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Cloud Revenue Trend</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Real service revenue stays separate from wallet top-ups, credits, refunds, and pending invoices.</p>
                </div>
                <div className="flex flex-wrap gap-1 rounded-lg border border-border/40 bg-background/35 p-1">
                  {MODES.map((item) => (
                    <button key={item} type="button" onClick={() => setMode(item)} className={`rounded-md border border-transparent px-3 py-1.5 text-xs transition ${mode === item ? "selected-item" : "text-muted-foreground hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"}`}>
                      {item}
                    </button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="relative h-[390px] overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--surface-subtle)] p-3">
                  <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(148,163,184,.1)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.08)_1px,transparent_1px)] [background-size:42px_42px]" />
                  {!hasRevenue ? <EmptyRevenueState /> : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series} margin={{ left: 4, right: 18, top: 18, bottom: 8 }}>
                        <defs>
                          <linearGradient id="grossRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#14B8A6" stopOpacity={0.24} />
                            <stop offset="45%" stopColor="#0F766E" stopOpacity={0.12} />
                            <stop offset="100%" stopColor="#0F766E" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="netRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10B981" stopOpacity={0.24} />
                            <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                          <filter id="revenueGlow" x="-40%" y="-40%" width="180%" height="180%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                          </filter>
                        </defs>
                        <CartesianGrid stroke="rgba(148,163,184,0.14)" vertical={false} />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "rgba(203,213,225,.72)", fontSize: 11 }} minTickGap={18} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fill: "rgba(203,213,225,.72)", fontSize: 11 }} tickFormatter={compactMoney} width={58} />
                        <Tooltip cursor={{ stroke: "rgba(20,184,166,.45)", strokeWidth: 1 }} content={<FinOpsTooltip />} />
                        <Area type="monotone" dataKey="grossRevenue" stroke="#14B8A6" strokeWidth={3} fill="url(#grossRevenueGradient)" activeDot={{ r: 7, strokeWidth: 2, stroke: "#ECFEFF", fill: "#14B8A6" }} isAnimationActive />
                        <Area type="monotone" dataKey="netRevenue" stroke="#10B981" strokeWidth={2} fill="url(#netRevenueGradient)" activeDot={{ r: 5, strokeWidth: 2, stroke: "#D1FAE5", fill: "#10B981" }} isAnimationActive />
                        {mode === "Payments" ? <Area type="monotone" dataKey="walletRevenue" stroke="#A78BFA" strokeWidth={2} fill="rgba(124,58,237,.08)" /> : null}
                        {mode === "Payments" ? <Area type="monotone" dataKey="walletFlow" stroke="#F59E0B" strokeWidth={2} fill="rgba(245,158,11,.08)" /> : null}
                        {mode === "Invoices" ? <Area type="monotone" dataKey="pendingInvoiceAmount" stroke="#F59E0B" strokeWidth={2} fill="rgba(245,158,11,.1)" /> : null}
                        {mode === "Growth" ? <Line type="monotone" dataKey="growthPercent" stroke="#F0ABFC" strokeWidth={2} dot={false} /> : null}
                        {mode === "Taxes" ? <Area type="monotone" dataKey="gstCollected" stroke="#F59E0B" strokeWidth={2} fill="rgba(245,158,11,.1)" /> : null}
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <InsightPanel insights={insights} cards={cards} />
              <PaymentMixPanel rows={paymentMix} />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <GatewayPanel rows={data?.revenueByGateway || []} />
            <InvoiceHealth cards={cards} />
            <RecentPaidInvoices rows={data?.recentPaidInvoices || []} />
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <RevenueTable title="Revenue by product" rows={data?.revenueByProduct || []} labelKey="product" />
            <RevenueTable title="Top Products" rows={data?.topProducts || []} labelKey="product" />
            <RevenueTable title="Top customers" rows={data?.topCustomers || []} labelKey="customer" />
          </section>
        </>
      )}
    </div>
  )
}

function KpiCard({ item, series, trend }: { item: any; series: SeriesPoint[]; trend: number }) {
  const Icon = item.icon
  const positive = Number(trend || 0) >= 0
  return (
    <Card className="glass glass-hover overflow-hidden border-border/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</p>
          </div>
          <div className={`rounded-lg border border-border/40 bg-background/45 p-2 ${item.accent}`}><Icon className="h-4 w-4" /></div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`flex items-center gap-1 text-xs ${trendClass(trend)}`}>{positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{pct(trend)}</span>
          <div className="h-10 w-28">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <Line type="monotone" dataKey={item.metric} stroke="#00E5FF" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function FinOpsTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload || {}
  return (
    <div className="min-w-52 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-solid)] p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-2 font-medium text-[var(--text-selected)]"><span className="h-2 w-2 rounded-full bg-[var(--accent-primary)]" />Revenue</div>
      <div className="text-xl font-semibold text-[var(--text-primary)]">{money(point.grossRevenue)}</div>
      <div className="mt-3 grid gap-1.5 text-muted-foreground">
        <div className="flex justify-between gap-6"><span>Date</span><span className="text-slate-100">{label}</span></div>
        <div className="flex justify-between gap-6"><span>Growth</span><span className={trendClass(point.growthPercent)}>{pct(point.growthPercent)}</span></div>
        <div className="flex justify-between gap-6"><span>Invoices</span><span className="text-slate-100">{point.paidInvoices || 0} paid</span></div>
        <div className="flex justify-between gap-6"><span>Gateway</span><span className="text-slate-100">{money(point.gatewayRevenue)}</span></div>
        <div className="flex justify-between gap-6"><span>Wallet service</span><span className="text-slate-100">{money(point.walletRevenue)}</span></div>
        <div className="flex justify-between gap-6"><span>Wallet flow</span><span className="text-slate-100">{money(point.walletFlow)}</span></div>
      </div>
    </div>
  )
}

function InsightPanel({ insights, cards }: { insights: any; cards: any }) {
  const items = [
    ["Revenue Trend", `${pct(insights.revenueTrendPercent)} from previous bucket`, trendClass(insights.revenueTrendPercent)],
    ["Highest sales day", insights.highestSalesDay || "No revenue", "text-[var(--text-selected)]"],
    ["Average order value", money(insights.averageOrderValue), "text-emerald-200"],
    ["Top payment source", insights.topPaymentSource || "No payments", "text-purple-200"],
    ["Payment success", `${Number(insights.paymentSuccessRate || 0).toFixed(1)}%`, "text-blue-200"],
    ["Credits / refunds", `${money(cards.credits)} / ${money(cards.refunds)}`, "text-rose-200"],
    ["Active services", Number(cards.activeServices || 0).toLocaleString("en-IN"), "text-amber-200"],
  ]
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Revenue Intelligence</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {items.map(([label, value, color]) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-border/30 bg-background/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className={`text-sm font-medium ${color}`}>{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function PaymentMixPanel({ rows }: { rows: Array<{ name: string; value: number }> }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Payment Source Mix</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[140px_1fr] xl:grid-cols-1">
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows.length ? rows : [{ name: "No payments", value: 1 }]} dataKey="value" innerRadius={42} outerRadius={64} paddingAngle={4}>
                {(rows.length ? rows : [{ name: "No payments" }]).map((_, index) => <Cell key={index} fill={rows.length ? SOURCE_COLORS[index % SOURCE_COLORS.length] : "rgba(148,163,184,.25)"} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {rows.length ? rows.map((row, index) => (
            <div key={row.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SOURCE_COLORS[index % SOURCE_COLORS.length] }} />{row.name}</span>
              <span className="font-medium">{compactMoney(row.value)}</span>
            </div>
          )) : <p className="text-sm text-muted-foreground">No payment mix in this range.</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function GatewayPanel({ rows }: { rows: any[] }) {
  const max = Math.max(...rows.map((row) => Number(row.amount || 0)), 1)
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Gateway Performance</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.slice(0, 6).map((row, index) => (
          <div key={`${row.gateway}-${index}`}>
            <div className="mb-1 flex justify-between text-sm"><span>{row.gateway}</span><span className="font-medium">{compactMoney(row.amount)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted/20"><div className="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-[var(--accent-hover)]" style={{ width: `${Math.max(6, (Number(row.amount || 0) / max) * 100)}%` }} /></div>
          </div>
        ))}
        {!rows.length ? <p className="py-6 text-sm text-muted-foreground">No gateway revenue in this range.</p> : null}
      </CardContent>
    </Card>
  )
}

function InvoiceHealth({ cards }: { cards: any }) {
  const rows = [
    { label: "Paid", value: Number(cards.paidInvoices || 0), amount: cards.paidInvoiceAmount, color: "#10B981" },
    { label: "Pending", value: Number(cards.pendingInvoices || 0), amount: cards.pendingInvoiceAmount, color: "#F59E0B" },
    { label: "Cancelled", value: Number(cards.cancelledInvoices || 0), amount: cards.cancelledInvoiceAmount, color: "#EF4444" },
  ]
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Invoice Health</CardTitle></CardHeader>
      <CardContent>
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "rgba(203,213,225,.72)", fontSize: 11 }} />
              <YAxis hide />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {rows.map((row) => <Cell key={row.label} fill={row.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((row) => <div key={row.label} className="flex justify-between text-sm"><span className="text-muted-foreground">{row.label}</span><span>{row.value} / {compactMoney(row.amount)}</span></div>)}
        </div>
      </CardContent>
    </Card>
  )
}

function RecentPaidInvoices({ rows }: { rows: any[] }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>Recent Paid Invoices</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, 6).map((row) => (
              <tr key={row.id || row.invoiceNumber} className="border-b border-border/20 last:border-0">
                <td className="py-2 font-mono text-xs">{row.invoiceNumber}</td>
                <td className="py-2 text-muted-foreground">{row.customer}</td>
                <td className="py-2 text-right font-medium">{compactMoney(row.amount)}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td className="py-6 text-muted-foreground">No paid invoices in this range.</td></tr> : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function RevenueTable({ title, rows, labelKey }: { title: string; rows: any[]; labelKey: string }) {
  return (
    <Card className="glass border-border/40">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, 8).map((row, index) => (
              <tr key={`${row[labelKey]}-${index}`} className="border-b border-border/20 last:border-0">
                <td className="py-2">{row[labelKey]}</td>
                <td className="py-2 text-right font-medium">{compactMoney(row.amount)}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td className="py-6 text-muted-foreground">No paid revenue in this range.</td></tr> : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function EmptyRevenueState() {
  return (
    <div className="relative z-10 flex h-full items-center justify-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-selected)] bg-[var(--accent-subtle)] text-[var(--text-selected)]">
          <Download className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">No paid revenue in this range</h3>
        <p className="mt-2 text-sm text-muted-foreground">Paid payments will appear here with FinOps trend, source, invoice, and gateway analytics.</p>
      </div>
    </div>
  )
}

function RevenueSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="glass h-32 animate-pulse rounded-xl bg-muted/20" />)}
      </div>
      <div className="glass h-[480px] animate-pulse rounded-2xl bg-[linear-gradient(90deg,rgba(148,163,184,.08),rgba(20,184,166,.1),rgba(148,163,184,.08))]" />
    </div>
  )
}
