"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Container } from "@/components/layout/container"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { formatCurrency } from "@/lib/currency-format"

type VpsStatus = {
  hostname?: string
  status?: string
  displayStatus?: string
  renewalDueAt?: string | null
  nextRenewalAt?: string | null
  resources?: { cpuCores?: number | null; ramGb?: number | null; diskGb?: number | null }
  storage?: { diskGb?: number | null }
}

const CPU_RATE = 150
const RAM_RATE = 70
const DISK_RATE = 7
const TERMS = [
  { value: "1", label: "Monthly" },
  { value: "3", label: "Quarterly" },
  { value: "6", label: "Semi Annual" },
  { value: "12", label: "Annual" },
]

function money(value: number) {
  return formatCurrency(Number.isFinite(value) ? value : 0, "INR")
}

function percentIncrease(from: number, to: number) {
  if (from > 0) return Math.max(0, Math.round(((to - from) / from) * 100))
  return to > 0 ? 100 : 0
}

function idempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `upgrade-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function VpsUpgradePage() {
  const { id } = useParams()
  const [status, setStatus] = useState<VpsStatus | null>(null)
  const [form, setForm] = useState({ cpuCores: "", ramGb: "", diskGb: "", termMonths: "1", paymentMethod: "gateway" as "gateway" | "wallet" })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const idempotencyRef = useRef<string | null>(null)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/client/vps/${id}/status`, { cache: "no-store" })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Unable to load server upgrade details")
      setStatus(data)
      const cpu = Number(data.resources?.cpuCores || 0)
      const ram = Number(data.resources?.ramGb || 0)
      const disk = Number(data.resources?.diskGb || data.storage?.diskGb || 0)
      setForm((current) => ({
        ...current,
        cpuCores: String(cpu || ""),
        ramGb: String(ram || ""),
        diskGb: String(disk || ""),
      }))
    }
    if (id) void load().catch((error) => toast.error(error.message)).finally(() => setLoading(false))
  }, [id])

  const quote = useMemo(() => {
    const currentCpu = Number(status?.resources?.cpuCores || 0)
    const currentRam = Number(status?.resources?.ramGb || 0)
    const currentDisk = Number(status?.resources?.diskGb || status?.storage?.diskGb || 0)
    const nextCpu = Number(form.cpuCores || currentCpu)
    const nextRam = Number(form.ramGb || currentRam)
    const nextDisk = Number(form.diskGb || currentDisk)
    const term = Number(form.termMonths || 1)
    const currentMonthly = currentCpu * CPU_RATE + currentRam * RAM_RATE + currentDisk * DISK_RATE
    const newMonthly = nextCpu * CPU_RATE + nextRam * RAM_RATE + nextDisk * DISK_RATE
    const difference = Math.max(0, newMonthly - currentMonthly)
    const due = status?.renewalDueAt || status?.nextRenewalAt
    const dueMs = due ? new Date(due).getTime() : NaN
    const remainingRatio = Number.isFinite(dueMs) ? Math.max(0, Math.min(1, (dueMs - Date.now()) / (30 * 86400000))) : 1
    const proratedAmount = Math.max(1, Number((difference * remainingRatio).toFixed(2)))
    const renewalAmount = Number((newMonthly * term).toFixed(2))
    return {
      currentCpu,
      currentRam,
      currentDisk,
      nextCpu,
      nextRam,
      nextDisk,
      term,
      currentMonthly,
      newMonthly,
      difference,
      proratedAmount,
      renewalAmount,
      cpuIncrease: percentIncrease(currentCpu, nextCpu),
      ramIncrease: percentIncrease(currentRam, nextRam),
      diskIncrease: percentIncrease(currentDisk, nextDisk),
    }
  }, [form, status])

  const invalid = !status ||
    ![quote.nextCpu, quote.nextRam, quote.nextDisk].every((value) => Number.isFinite(value) && value > 0) ||
    quote.nextCpu < quote.currentCpu ||
    quote.nextRam < quote.currentRam ||
    quote.nextDisk < quote.currentDisk ||
    quote.difference <= 0

  async function submit() {
    if (invalid) {
      toast.error("Choose at least one higher CPU, RAM, or disk value.")
      return
    }
    setSubmitting(true)
    try {
      idempotencyRef.current ||= idempotencyKey()
      const res = await fetch(`/api/client/vps/${id}/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cpuCores: quote.nextCpu,
          ramGb: quote.nextRam,
          diskGb: quote.nextDisk,
          termMonths: quote.term,
          paymentMethod: form.paymentMethod,
          idempotencyKey: idempotencyRef.current,
        }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok || data.success === false) throw new Error(data.error || data.message || "Unable to create upgrade order")
      await startPaymentRedirect(data)
    } catch (error: any) {
      toast.error(error.message || "Unable to start upgrade checkout")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container className="py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/client-area/vps/${id}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to VPS</Link>
      </Button>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Server className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Upgrade Server</h1>
        <Badge variant="outline">{loading ? "Loading" : status?.displayStatus || status?.status || "Ready"}</Badge>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Current Resources</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Resource icon={Cpu} label="CPU" value={`${quote.currentCpu || "-"} vCPU`} />
              <Resource icon={MemoryStick} label="RAM" value={`${quote.currentRam || "-"} GB`} />
              <Resource icon={HardDrive} label="Disk" value={`${quote.currentDisk || "-"} GB`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>New Resources</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="CPU cores" min={quote.currentCpu || 1} value={form.cpuCores} onChange={(cpuCores) => setForm((current) => ({ ...current, cpuCores }))} />
              <Field label="RAM GB" min={quote.currentRam || 1} value={form.ramGb} onChange={(ramGb) => setForm((current) => ({ ...current, ramGb }))} />
              <Field label="Disk GB" min={quote.currentDisk || 1} value={form.diskGb} onChange={(diskGb) => setForm((current) => ({ ...current, diskGb }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Billing Term</CardTitle></CardHeader>
            <CardContent>
              <RadioGroup value={form.termMonths} onValueChange={(termMonths) => setForm((current) => ({ ...current, termMonths }))} className="grid gap-3 sm:grid-cols-4">
                {TERMS.map((term) => (
                  <label key={term.value} className="flex cursor-pointer items-center gap-3 rounded-md border border-border/40 p-3 text-sm">
                    <RadioGroupItem value={term.value} />
                    {term.label}
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
            <CardContent>
              <RadioGroup value={form.paymentMethod} onValueChange={(value) => setForm((current) => ({ ...current, paymentMethod: value === "wallet" ? "wallet" : "gateway" }))} className="grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/40 p-3 text-sm"><RadioGroupItem value="gateway" />Pay by UPI/Card</label>
                <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/40 p-3 text-sm"><RadioGroupItem value="wallet" />Pay from wallet</label>
              </RadioGroup>
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Upgrade Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Summary label="Current resources" value={`${quote.currentCpu} CPU / ${quote.currentRam} GB / ${quote.currentDisk} GB`} />
              <Summary label="New resources" value={`${quote.nextCpu} CPU / ${quote.nextRam} GB / ${quote.nextDisk} GB`} />
              <Summary label="Current monthly price" value={money(quote.currentMonthly)} />
              <Summary label="New monthly price" value={money(quote.newMonthly)} />
              <Summary label="Difference" value={money(quote.difference)} />
              <Summary label="Prorated amount" value={money(quote.proratedAmount)} />
              <Summary label="Renewal amount" value={money(quote.renewalAmount)} />
              <Summary label="CPU increase" value={`${quote.cpuIncrease}%`} />
              <Summary label="RAM increase" value={`${quote.ramIncrease}%`} />
              <Summary label="Disk increase" value={`${quote.diskIncrease}%`} />
              <Button className="mt-3 w-full" onClick={submit} disabled={loading || submitting || invalid}>
                {submitting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                Proceed to payment
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </Container>
  )
}

function Field({ label, min, value, onChange }: { label: string; min: number; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" min={min} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function Resource({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/40 p-4">
      <p className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground"><Icon className="h-4 w-4" />{label}</p>
      <div className="mt-2 text-lg font-semibold">{value}</div>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}
