"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { formatBytesDecimal } from "@/lib/format-units"
import { OperationProgressDialog } from "@/components/client/operation-progress-dialog"
import { startPaymentRedirect } from "@/lib/client/payment-redirect"

type SnapshotVm = { vmId: number; vpsInstanceId: string; name: string; status: string }
type SnapshotItem = {
  name: string
  description: string | null
  vmstate: boolean
  current: boolean
  parent: string | null
  created: string | null
  sizeBytes: string | null
}
type SnapshotGroup = {
  vmId: number
  vpsInstanceId: string
  name: string
  items: SnapshotItem[]
  unreachable: string | null
  error: string | null
  capable?: { capable: boolean; storage: string | null; type: string | null } | null
}
type SnapshotService = {
  enabled: boolean
  model: string
  perSnapshotPrice: number
  taxPercent: number
  pricePreview: { subtotal: number; taxAmount: number; taxPercent: number; total: number }
}
type PendingPurchase = {
  name: string
  description: string
  orderId: string
  quote: { subtotal: number; taxAmount: number; taxPercent: number; total: number }
  wallet: { balance: number; sufficient: boolean }
  planName: string | null
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })
}

function formatMoney(value: number | string | null | undefined) {
  const parsed = Number(value || 0)
  if (!Number.isFinite(parsed)) return "₹0.00"
  return `₹${parsed.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function ClientSnapshotsPage() {
  const [vms, setVms] = useState<SnapshotVm[]>([])
  const [groups, setGroups] = useState<SnapshotGroup[]>([])
  const [service, setService] = useState<SnapshotService | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vmId, setVmId] = useState<string>("all")
  const [notify, setNotify] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [includeRam, setIncludeRam] = useState(false)
  const [creating, setCreating] = useState(false)

  const [confirmPurchase, setConfirmPurchase] = useState<PendingPurchase | null>(null)
  const [confirming, setConfirming] = useState(false)

  const [rollbackTarget, setRollbackTarget] = useState<{ group: SnapshotGroup; item: SnapshotItem } | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackResult, setRollbackResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [rollbackVmStatus, setRollbackVmStatus] = useState<string>("unknown")
  const [rollbackShuttingDown, setRollbackShuttingDown] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<{ group: SnapshotGroup; item: SnapshotItem } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [operationId, setOperationId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (vmId && vmId !== "all") params.set("vmId", vmId)
      const res = await fetch(`/api/client/snapshots?${params.toString()}`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || "Failed to load snapshots")
      setVms(body.vms || [])
      setGroups(body.snapshots || [])
      setService(body.service || null)
    } catch (e: any) {
      setError(e?.message || "Failed to load snapshots")
    } finally {
      setLoading(false)
    }
  }, [vmId])

  useEffect(() => {
    void load()
  }, [load])

  const selected = vmId !== "all" ? groups.filter((g) => String(g.vmId) === vmId) : groups

  const doCreate = async () => {
    if (!name.trim()) return
    setCreating(true)
    setNotify(null)
    try {
      const group = groups.find(() => true)
      const vpsInstanceId = vmId !== "all" ? vms.find((v) => String(v.vmId) === vmId)?.vpsInstanceId : group?.vpsInstanceId
      if (!vpsInstanceId) throw new Error("Select a server")
      const res = await fetch("/api/client/snapshot-purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId, name: name.trim(), description: description.trim(), vmstate: includeRam }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) {
        setNotify(body.error || "Snapshot creation failed")
        return
      }
      if (body.purchaseRequired) {
        setCreateOpen(false)
        setConfirmPurchase({
          name: name.trim(),
          description: description.trim(),
          orderId: String(body.orderId || ""),
          quote: body.quote || { subtotal: 0, taxAmount: 0, taxPercent: 0, total: 0 },
          wallet: body.wallet || { balance: 0, sufficient: false },
          planName: body.planName || null,
        })
      } else if (body.operationId) {
        setCreateOpen(false)
        setName("")
        setDescription("")
        setIncludeRam(false)
        setOperationId(String(body.operationId))
      } else {
        setCreateOpen(false)
        setName("")
        setDescription("")
        setIncludeRam(false)
        setNotify(`Snapshot "${name.trim()}" created.`)
        void load()
      }
    } catch (e: any) {
      setNotify(e?.message || "Snapshot creation failed")
    } finally {
      setCreating(false)
    }
  }

  const confirmAndPay = async () => {
    if (!confirmPurchase?.orderId) return
    setConfirming(true)
    setNotify(null)
    try {
      const payment = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "billable_order",
          existingOrderId: confirmPurchase.orderId,
          paymentMethod: confirmPurchase.wallet?.sufficient ? "wallet" : undefined,
          idempotencyKey: `billable:${confirmPurchase.orderId}`,
        }),
      })
      const paymentData = await payment.json().catch(() => ({}))
      if (!payment.ok) throw new Error(paymentData.message || paymentData.error || "Payment could not be started")
      setConfirmPurchase(null)
      await startPaymentRedirect(paymentData)
    } catch (e: any) {
      setNotify(e?.message || "Payment could not be started")
      setConfirming(false)
    }
  }

  const openRollback = async (group: SnapshotGroup, item: SnapshotItem) => {
    setRollbackTarget({ group, item })
    setConfirmText("")
    setRollbackResult(null)
    setRollbackVmStatus("unknown")
    try {
      const res = await fetch(`/api/client/backups/vm-context?vpsInstanceId=${encodeURIComponent(group.vpsInstanceId)}`, { cache: "no-store" })
      const body = await res.json()
      if (res.ok && body.success) setRollbackVmStatus(String(body.vm?.status || "unknown").toLowerCase())
    } catch {
      setRollbackVmStatus("unknown")
    }
  }

  const doShutdownBeforeRollback = async () => {
    if (!rollbackTarget) return
    setRollbackShuttingDown(true)
    setRollbackResult(null)
    try {
      const res = await fetch("/api/client/snapshots/shutdown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: rollbackTarget.group.vpsInstanceId, name: rollbackTarget.item.name }),
      })
      const body = await res.json()
      if (!res.ok || !body?.success) throw new Error(body?.shutdown?.message || body?.error || "Shutdown failed")
      setRollbackResult({ ok: true, message: `Server shut down (${String(body.shutdown?.status || "stopped")}). You can now roll back.` })
      setRollbackVmStatus(body.shutdown?.status || "stopped")
    } catch (e: any) {
      setRollbackResult({ ok: false, message: e?.message || "Shutdown failed." })
    } finally {
      setRollbackShuttingDown(false)
    }
  }

  const doRollback = async () => {
    if (!rollbackTarget || confirmText.toUpperCase() !== "ROLLBACK") return
    setRollingBack(true)
    setRollbackResult(null)
    try {
      const res = await fetch(`/api/client/snapshots/${encodeURIComponent(rollbackTarget.item.name)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: rollbackTarget.group.vpsInstanceId, action: "rollback", confirmation: confirmText }),
      })
      const body = await res.json()
      setRollbackResult(res.ok && body.success ? { ok: true, message: "Rollback was queued. Progress is shown in the dialog. The server stays off and is not started automatically." } : { ok: false, message: body.error || "Rollback failed." })
      if (res.ok && body.success) {
        const target = rollbackTarget
        setRollbackTarget(null)
        setConfirmText("")
        if (body.operationId) {
          setOperationId(String(body.operationId))
        } else {
          setNotify(`Rollback of "${target.item.name}" completed.`)
          void load()
        }
      }
    } catch (e: any) {
      setRollbackResult({ ok: false, message: e?.message || "Rollback failed." })
    } finally {
      setRollingBack(false)
    }
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/client/snapshots/${encodeURIComponent(deleteTarget.item.name)}?vpsInstanceId=${deleteTarget.group.vpsInstanceId}`, {
        method: "DELETE",
      })
      const body = await res.json()
      if (res.ok && body.success) {
        setDeleteTarget(null)
        if (body.operationId) {
          setOperationId(String(body.operationId))
        } else {
          setNotify(`Snapshot "${deleteTarget.item.name}" deleted.`)
          void load()
        }
      } else {
        setNotify(body.error || "Deletion failed.")
      }
    } catch (e: any) {
      setNotify(e?.message || "Deletion failed.")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Snapshots</h1>
          <p className="text-sm text-muted-foreground">
            Point-in-time captures of a server&apos;s disk and, optionally, RAM. Rollback overwrites disk state with the captured snapshot and requires the
            server to be powered off.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/client-area/vps">Go to VMs</Link>
          </Button>
          <Button size="sm" className="bg-amber-500/90 text-black hover:bg-amber-400" onClick={() => setCreateOpen(true)} disabled={!vms.length || service?.enabled === false}>
            New snapshot
          </Button>
        </div>
      </div>

      {service && service.enabled === false ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">Snapshot service is currently unavailable.</div>
      ) : null}
      {notify ? (
        <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm">{notify}</div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      <Card className="border-border/40 bg-background/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Snapshots</CardTitle>
            <CardDescription>{loading ? "Loading…" : `${selected.reduce((acc, g) => acc + g.items.length, 0)} snapshot(s)`}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={vmId} onValueChange={setVmId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="All servers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All servers</SelectItem>
                {vms.map((vm) => (
                  <SelectItem key={vm.vmId} value={String(vm.vmId)}>
                    {vm.name} ({vm.vmId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loading ? <Spinner className="h-4 w-4" /> : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="mt-0.5 shrink-0">
              <Badge variant="outline">CURRENT</Badge>
            </span>
            <p>
              The snapshot marked <span className="font-medium text-foreground">CURRENT</span> is the server&apos;s live state, not a restorable point-in-time
              capture. It cannot be rolled back or deleted; the current state always exists.
            </p>
          </div>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading snapshots…</div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No servers available.</div>
          ) : (
            selected.map((group) => (
              <div key={group.vmId} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{group.name}</span>
                  <Badge variant={String(vms.find((v) => String(v.vmId) === String(group.vmId))?.status || "").toLowerCase() === "running" ? "default" : "outline"}>
                    {String(vms.find((v) => String(v.vmId) === String(group.vmId))?.status || "").toUpperCase() || "—"}
                  </Badge>
                </div>
                {group.error ? <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{group.error}</div> : null}
                {group.unreachable ? <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm text-muted-foreground">{group.unreachable}</div> : null}
                {group.capable && !group.capable.capable ? (
                  <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
                    Snapshots are unavailable for this server because its current disk setup does not support point-in-time snapshots. Your backup plan covers this server — contact support if you need snapshots.
                  </div>
                ) : null}
                {!group.error && !group.unreachable && group.items.length === 0 ? (
                  <div className="rounded-md border border-border/40 p-3 text-sm text-muted-foreground">No snapshots for this server.</div>
                ) : null}
                {group.items.length ? (
                  <div className="min-w-0 overflow-x-auto rounded-md border border-border/40">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Size</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((item) => (
                          <TableRow key={item.name}>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{item.name}</span>
                                {item.current ? <Badge variant="outline">CURRENT</Badge> : null}
                                {item.vmstate ? <Badge variant="outline">WITH RAM</Badge> : null}
                              </div>
                              {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
                            </TableCell>
                            <TableCell>{formatDate(item.created, true)}</TableCell>
                            <TableCell>{item.sizeBytes ? formatBytesDecimal(item.sizeBytes) : "-"}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" disabled={item.current} onClick={() => void openRollback(group, item)}>
                                  Rollback
                                </Button>
                                <Button variant="outline" size="sm" className="text-red-300 hover:bg-red-400/10 hover:text-red-200" disabled={item.current} onClick={() => setDeleteTarget({ group, item })}>
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New snapshot</DialogTitle>
            <DialogDescription>Captures the selected server. Live snapshots with RAM can be slow and briefly stall the server.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="snap-name">Name</Label>
              <Input id="snap-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="daily-pre-release" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snap-desc">Description</Label>
              <Input id="snap-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={includeRam} onCheckedChange={(checked) => setIncludeRam(Boolean(checked))} />
              Include running memory state
            </label>
            {service && service.enabled && service.pricePreview?.total > 0 ? (
              <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-xs">
                <div className="flex justify-between">
                  <span>Snapshot price</span>
                  <span>{formatMoney(service.pricePreview.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span>GST ({service.pricePreview.taxPercent ?? service.taxPercent}%)</span>
                  <span>{formatMoney(service.pricePreview.taxAmount)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-border/40 pt-1 font-medium">
                  <span>Total</span>
                  <span>{formatMoney(service.pricePreview.total)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">Snapshots are a paid service. You can pay with credit or a payment gateway.</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button className="bg-amber-500/90 text-black hover:bg-amber-400" onClick={() => void doCreate()} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmPurchase)} onOpenChange={(open) => !open && setConfirmPurchase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm snapshot purchase</DialogTitle>
            <DialogDescription>
              Snapshot &quot;{confirmPurchase?.name}&quot;
              {confirmPurchase?.planName ? ` · ${confirmPurchase.planName}` : ""} will be created after payment is verified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-border/40 bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span>Snapshot price</span>
                <span>{formatMoney(confirmPurchase?.quote.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>GST ({confirmPurchase?.quote.taxPercent}%)</span>
                <span>{formatMoney(confirmPurchase?.quote.taxAmount)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-border/40 pt-1 font-medium">
                <span>Total</span>
                <span>{formatMoney(confirmPurchase?.quote.total)}</span>
              </div>
            </div>
            <div className={`rounded-md border p-3 text-sm ${confirmPurchase?.wallet?.sufficient ? "border-emerald-400/30 bg-emerald-400/10" : "border-amber-400/30 bg-amber-400/10"}`}>
              {confirmPurchase?.wallet?.sufficient ? (
                <p>Your credit balance ({formatMoney(confirmPurchase?.wallet.balance)}) covers the total. Payment will be deducted from credit.</p>
              ) : (
                <p>
                  Your credit balance is {formatMoney(confirmPurchase?.wallet.balance)} and does not cover the total. You will be redirected to the payment gateway for the order.
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPurchase(null)} disabled={confirming}>
              Cancel
            </Button>
            <Button className="bg-amber-500/90 text-black hover:bg-amber-400" onClick={() => void confirmAndPay()} disabled={confirming}>
              {confirming ? "Starting payment…" : confirmPurchase?.wallet?.sufficient ? "Pay with credit" : "Pay now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(rollbackTarget)} onOpenChange={(open) => !open && setRollbackTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rollback to snapshot?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Rolling back <span className="font-medium">{rollbackTarget?.item.name}</span> overwrites the server&apos;s disk with the captured state.
                </p>
                <div className={`rounded-md border p-3 text-xs ${rollbackVmStatus === "stopped" || rollbackVmStatus === "not-running" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
                  {rollbackVmStatus === "stopped" || rollbackVmStatus === "not-running" ? (
                    <p>The server is currently powered off and ready to roll back.</p>
                  ) : rollbackVmStatus === "unknown" ? (
                    <p>Checking the server state… rollback requires the server to be powered off.</p>
                  ) : (
                    <p>
                      The server is <strong className="uppercase">{rollbackVmStatus}</strong>. You must shut it down before rolling back. Use{" "}
                      <strong>Shut down &amp; continue</strong> below.
                    </p>
                  )}
                </div>
                {rollbackResult ? (
                  <div className={`rounded-md border p-3 text-xs ${rollbackResult.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200"}`}>
                    {rollbackResult.message}
                  </div>
                ) : null}
                {(rollbackVmStatus === "stopped" || rollbackVmStatus === "not-running") && confirmText.toUpperCase() !== "ROLLBACK" ? (
                  <>
                    <Label htmlFor="rollback-confirm">Type ROLLBACK to confirm</Label>
                    <Input id="rollback-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="ROLLBACK" autoComplete="off" />
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rollingBack} onClick={() => setRollbackTarget(null)}>
              Cancel
            </AlertDialogCancel>
            {rollbackVmStatus !== "stopped" && rollbackVmStatus !== "not-running" ? (
              <AlertDialogAction
                disabled={rollbackShuttingDown}
                onClick={(e) => {
                  e.preventDefault()
                  void doShutdownBeforeRollback()
                }}
                className="bg-amber-500/90 text-black hover:bg-amber-400"
              >
                {rollbackShuttingDown ? "Shutting down…" : "Shut down & continue"}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                disabled={confirmText.toUpperCase() !== "ROLLBACK" || rollingBack}
                onClick={(e) => {
                  e.preventDefault()
                  void doRollback()
                }}
              >
                {rollingBack ? "Rolling back…" : "Rollback"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
            <AlertDialogDescription>This permanently deletes snapshot <span className="font-medium">{deleteTarget?.item.name}</span>. The action is irreversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500/90 hover:bg-red-500" disabled={deleting} onClick={(e) => { e.preventDefault(); void doDelete() }}>
              {deleting ? "Deleting…" : "Delete snapshot"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OperationProgressDialog
        operationId={operationId || ""}
        open={Boolean(operationId)}
        onClose={() => setOperationId(null)}
        onComplete={() => void load()}
      />
    </div>
  )
}