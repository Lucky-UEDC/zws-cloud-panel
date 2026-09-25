"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle2, Clipboard, Eye, EyeOff, Server } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { readJsonResponse } from "@/lib/client/safe-json"
import { formatPrice } from "@/lib/pricing"

type Service = {
  id: string
  serviceNumber: string
  hostname: string | null
  orderNumber: string
  productName: string
  status: string
  selectedOs: string | null
  billingTerm: number
  renewalDate: string | null
  renewalAmount: number
  paymentConfirmedAt: string | null
  estimatedDeliveryAt: string | null
  deliveredAt: string | null
  invoice: { id: string; invoiceNumber: string; status: string; totalAmount: number } | null
  paymentStatus: string
  timeline: Array<{ key: string; label: string; status: string }>
  credentials: { primaryIp: string | null; username: string | null; password: string | null; panelUrl: string | null; installedOs: string | null; notes: string | null } | null
}

function remaining(target?: string | null) {
  if (!target) return "Awaiting payment confirmation"
  const ms = new Date(target).getTime() - Date.now()
  if (ms <= 0) return "SLA window reached"
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m remaining`
}

export default function ClientDedicatedDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [service, setService] = useState<Service | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [, tick] = useState(0)

  useEffect(() => {
    fetch(`/api/client/dedicated/${id}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await readJsonResponse<any>(res)
        if (res.ok) setService(data.service)
      })
      .catch(() => null)
  }, [id])

  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 60000)
    return () => window.clearInterval(timer)
  }, [])

  const delivered = Boolean(service?.credentials)
  const countdown = useMemo(() => remaining(service?.estimatedDeliveryAt), [service?.estimatedDeliveryAt])

  async function copy(value?: string | null) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    toast.success("Copied")
  }

  if (!service) return <Card><CardContent className="p-6 text-muted-foreground">Loading dedicated service...</CardContent></Card>

  return (
    <div className="space-y-5">
      <Card className="glass border-border/40">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Server className="h-4 w-4 text-accent" />
              <h1 className="text-xl font-semibold">{service.hostname || service.productName}</h1>
              <Badge variant={delivered ? "default" : "secondary"}>{service.status.replace(/_/g, " ")}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>{service.orderNumber}</span>
              <span>{service.selectedOs || "OS selected"}</span>
              <span>Renewal: {service.renewalDate ? new Date(service.renewalDate).toLocaleDateString() : "-"}</span>
            </div>
          </div>
          {service.invoice ? <Button asChild variant="outline"><Link href={`/client-area/billing/invoices/${service.invoice.id}`}>View Invoice</Link></Button> : null}
        </CardContent>
      </Card>

      {!delivered ? (
        <Card className="border-border/40">
          <CardHeader><CardTitle>Your dedicated server is being prepared</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-foreground/[0.04] p-4">
              <p className="text-sm text-muted-foreground">Estimated delivery: within 72 hours after payment confirmation</p>
              <p className="mt-1 text-2xl font-semibold">{countdown}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-5">
              {service.timeline.map((item) => (
                <div key={item.key} className={`rounded-md border p-3 text-sm ${item.status === "completed" ? "border-emerald-500/40 bg-emerald-500/10" : item.status === "active" ? "selected-item" : "border-border/40"}`}>
                  <CheckCircle2 className="mb-2 h-4 w-4" />
                  {item.label}
                </div>
              ))}
            </div>
            <Button asChild variant="outline"><Link href="/client-area/support">Contact Support</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/40">
          <CardHeader><CardTitle>Delivered Credentials</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <SecretRow label="Server IP" value={service.credentials?.primaryIp} onCopy={copy} />
            <SecretRow label="Username" value={service.credentials?.username} onCopy={copy} />
            <div className="rounded-md border border-border/40 p-3">
              <p className="text-xs text-muted-foreground">Password</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono">{showPassword ? service.credentials?.password || "-" : "************"}</span>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                  <Button size="icon" variant="ghost" type="button" onClick={() => copy(service.credentials?.password)}><Clipboard className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
            <SecretRow label="IPMI / Panel URL" value={service.credentials?.panelUrl} onCopy={copy} />
            <SecretRow label="OS installed" value={service.credentials?.installedOs} onCopy={copy} />
            <SecretRow label="Delivery date" value={service.deliveredAt ? new Date(service.deliveredAt).toLocaleString() : "-"} onCopy={copy} />
            {service.credentials?.notes ? <div className="sm:col-span-2 rounded-md border border-border/40 p-3 text-sm"><p className="text-xs text-muted-foreground">Notes</p><p className="mt-1">{service.credentials.notes}</p></div> : null}
            <p className="sm:col-span-2 text-xs text-muted-foreground">For security, change the temporary password after first login.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="Billing term" value={`${service.billingTerm} month${service.billingTerm > 1 ? "s" : ""}`} />
          <Info label="Renewal amount" value={formatPrice(service.renewalAmount)} />
          <Info label="Invoice status" value={service.invoice?.status || "-"} />
          <Info label="Payment status" value={service.paymentStatus || "-"} />
        </CardContent>
      </Card>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-muted-foreground">{label}</p><p className="font-medium">{value}</p></div>
}

function SecretRow({ label, value, onCopy }: { label: string; value?: string | null; onCopy: (value?: string | null) => void }) {
  return (
    <div className="rounded-md border border-border/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="break-all font-mono text-sm">{value || "-"}</span>
        <Button size="icon" variant="ghost" type="button" onClick={() => onCopy(value)}><Clipboard className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
