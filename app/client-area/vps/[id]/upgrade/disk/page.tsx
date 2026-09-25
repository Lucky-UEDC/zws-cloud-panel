"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"
import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Database, HardDrive, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Container } from "@/components/layout/container"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatCurrency } from "@/lib/currency-format"

type Disk = {
  id: string
  displayName: string
  sizeGb: number
  isPrimary: boolean
  storagePoolId?: string | null
  storagePool?: { displayName: string; storageType: string; pricePerGbMonthInr: number } | null
}

type Pool = {
  id: string
  displayName: string
  storageType: string
  pricePerGbMonthInr: number
  isPremium: boolean
  isUpgradeOnly: boolean
}

type Operation = "resize" | "migrate" | "add"

const MAX_GB = 16 * 1024

function moneyInr(value: unknown) {
  return formatCurrency(Number(value || 0), "INR")
}

export default function DiskUpgradePage() {
  const { id } = useParams()
  const [vps, setVps] = useState<any>(null)
  const [disks, setDisks] = useState<Disk[]>([])
  const [pools, setPools] = useState<Pool[]>([])
  const [operation, setOperation] = useState<Operation>("resize")
  const [diskId, setDiskId] = useState("")
  const [targetPoolId, setTargetPoolId] = useState("")
  const [targetSizeGb, setTargetSizeGb] = useState("")
  const [quote, setQuote] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      const res = await fetch(`/api/client/vps/${id}/disks`, { cache: "no-store" })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Unable to load disk upgrade options")
      setVps(data.vps)
      setDisks(data.disks || [])
      setPools(data.pools || [])
      const firstDisk = data.disks?.[0]
      const firstPool = data.pools?.find((pool: Pool) => pool.id === firstDisk?.storagePoolId) || data.pools?.[0]
      setDiskId(firstDisk?.id || "")
      setTargetPoolId(firstPool?.id || "")
      setTargetSizeGb(firstDisk?.sizeGb ? String(firstDisk.sizeGb + 10) : "100")
    }
    if (id) void load().catch((error) => toast.error(error.message)).finally(() => setLoading(false))
  }, [id])

  const selectedDisk = disks.find((disk) => disk.id === diskId) || null
  const selectedPool = pools.find((pool) => pool.id === targetPoolId) || null
  const effectiveSize = useMemo(() => {
    if (operation === "migrate" && !targetSizeGb && selectedDisk) return selectedDisk.sizeGb
    return Number(targetSizeGb || 0)
  }, [operation, selectedDisk, targetSizeGb])

  async function fetchQuote() {
    setQuote(null)
    try {
      const res = await fetch(`/api/client/vps/${id}/upgrade/disk/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, diskId: operation === "add" ? undefined : diskId, targetStoragePoolId: targetPoolId, targetSizeGb: effectiveSize }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Unable to quote disk upgrade")
      setQuote(data.quote)
    } catch (error: any) {
      toast.error(error.message || "Unable to quote disk upgrade")
    }
  }

  async function checkout() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/client/vps/${id}/upgrade/disk/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation, diskId: operation === "add" ? undefined : diskId, targetStoragePoolId: targetPoolId, targetSizeGb: effectiveSize }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(data.error || "Unable to create disk upgrade order")
      if (data.paid) {
        toast.success("Disk upgrade queued.")
        window.location.assign(`/client-area/vps/${id}`)
        return
      }
      const paymentRes = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "upgrade_order", existingOrderId: data.orderId, vpsInstanceId: id }),
      })
      const paymentData = await readJsonResponse<any>(paymentRes) || {}
      if (!paymentRes.ok) throw new Error(paymentData.message || paymentData.error || "Unable to start payment")
      await startPaymentRedirect(paymentData)
    } catch (error: any) {
      toast.error(error.message || "Unable to start disk upgrade")
    } finally {
      setSubmitting(false)
    }
  }

  const invalidSize = effectiveSize > MAX_GB || (operation !== "add" && selectedDisk && effectiveSize < selectedDisk.sizeGb)

  return (
    <Container className="py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/client-area/vps/${id}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to VPS</Link>
      </Button>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <HardDrive className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Upgrade Disk</h1>
        {vps?.status ? <Badge variant="outline">{vps.status}</Badge> : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Disk Operation</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <ModeCard active={operation === "resize"} icon={HardDrive} title="Increase existing disk size" onClick={() => setOperation("resize")} />
              <ModeCard active={operation === "migrate"} icon={Database} title="Move disk to another storage pool" onClick={() => setOperation("migrate")} />
              <ModeCard active={operation === "add"} icon={Plus} title="Add new disk" onClick={() => setOperation("add")} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {operation !== "add" ? (
                <div className="space-y-2">
                  <Label>Existing disk</Label>
                  <Select value={diskId || undefined} onValueChange={(next) => {
                    setDiskId(next)
                    const disk = disks.find((item) => item.id === next)
                    if (disk) {
                      setTargetSizeGb(String(operation === "resize" ? disk.sizeGb + 10 : disk.sizeGb))
                      setTargetPoolId(disk.storagePoolId || pools[0]?.id || "")
                    }
                  }}>
                    <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select disk" /></SelectTrigger>
                    <SelectContent>
                      {disks.map((disk) => <SelectItem key={disk.id} value={disk.id}>{disk.displayName} - {disk.sizeGb} GB</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>{operation === "add" ? "New disk size GB" : "Target size GB"}</Label>
                <Input type="number" min={operation === "add" ? 1 : selectedDisk?.sizeGb || 1} max={MAX_GB} value={targetSizeGb} onChange={(event) => setTargetSizeGb(event.target.value)} />
                {invalidSize ? <p className="text-xs text-destructive">Disk size must increase and cannot exceed 16 TB.</p> : null}
              </div>

              {(operation === "migrate" || operation === "add") ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label>Target storage pool</Label>
                  <Select value={targetPoolId || undefined} onValueChange={setTargetPoolId}>
                    <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Select storage pool" /></SelectTrigger>
                    <SelectContent>
                    {pools.map((pool) => (
                      <SelectItem key={pool.id} value={pool.id}>{pool.displayName} - {pool.storageType} - {moneyInr(pool.pricePerGbMonthInr)}/GB/mo{pool.isPremium ? " - Premium" : ""}</SelectItem>
                    ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={fetchQuote} disabled={loading || invalidSize || !selectedPool || (operation !== "add" && !selectedDisk)}>
                  Quote disk upgrade
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Attached Disks</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {disks.map((disk) => (
                <div key={disk.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 p-3 text-sm">
                  <div>
                    <div className="font-medium">{disk.displayName}</div>
                    <div className="text-xs text-muted-foreground">{disk.storagePool?.displayName || "Default storage"} · {disk.storagePool?.storageType || "-"} · {disk.isPrimary ? "Primary" : "Attached"}</div>
                  </div>
                  <div className="font-medium">{disk.sizeGb} GB</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader><CardTitle>Pricing Breakdown</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Summary label="Current disk" value={selectedDisk ? `${selectedDisk.displayName} ${selectedDisk.sizeGb} GB` : operation === "add" ? "New disk" : "-"} />
              <Summary label="Target disk" value={`${effectiveSize || 0} GB`} />
              <Summary label="Current pool" value={selectedDisk?.storagePool?.displayName || "-"} />
              <Summary label="Target pool" value={selectedPool?.displayName || "-"} />
              <Summary label="Extra GB" value={`${quote?.extraSizeGb ?? 0} GB`} />
              <Summary label="Pool upgrade price" value={`${moneyInr(quote?.poolDifferenceDelta)}/mo`} />
              <Summary label="Monthly increase" value={moneyInr(quote?.monthlyIncrease)} />
              <Summary label="Term subtotal" value={moneyInr(quote?.pricing?.subtotal)} />
              <Summary label="Discount" value={`-${moneyInr(quote?.pricing?.discount)}`} />
              <Summary label="GST" value={moneyInr(quote?.pricing?.gst)} />
              <div className="border-t border-border/40 pt-3">
                <Summary label="Payable today" value={moneyInr(quote?.payableToday)} strong />
              </div>
              <Button className="w-full" disabled={!quote || submitting} onClick={checkout}>
                {submitting ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create invoice and pay
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </Container>
  )
}

function ModeCard({ active, icon: Icon, title, onClick }: { active: boolean; icon: any; title: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-24 flex-col items-start gap-3 rounded-lg border p-4 text-left transition ${active ? "selected-item" : "border-border/50 hover:bg-[rgba(255,255,255,0.04)]"}`}>
      <Icon className="h-5 w-5 text-muted-foreground" />
      <span className="text-sm font-medium">{title}</span>
    </button>
  )
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 ${strong ? "text-base font-semibold" : ""}`}><span className="text-muted-foreground">{label}</span><span className="text-right">{value}</span></div>
}
