"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useState } from "react"
import type React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

type SnapshotVm = {
  vpsInstanceId: string
  nodeId: string | null
  nodeName: string | null
  vmid: number
  name: string
  status: string
}

type VmSnapshot = {
  name: string
  description?: string
  vmstate: boolean
  current: boolean
  parent?: string
  created: string | null
  sizeBytes?: string | number | null
  dbRecord?: { id: string; status: string; createdBy: string | null; createdAt: string | null } | null
}

type CapabilityDisk = {
  key: string
  storage: string
  format: string
  type: string
  snapshotCapable: boolean
}

type CapabilityDiagnostic = {
  vmid: number
  nodeName: string | null
  capable: boolean
  reason: string | null
  disks: CapabilityDisk[]
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return "—"
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  return `${bytes} KB`
}

export default function SnapshotsPage() {
  const [vms, setVms] = useState<SnapshotVm[]>([])
  const [selected, setSelected] = useState<SnapshotVm | null>(null)
  const [snapshots, setSnapshots] = useState<VmSnapshot[]>([])
  const [capability, setCapability] = useState<CapabilityDiagnostic | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [vmstate, setVmstate] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadVms = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/snapshots?vms=1")
      const data = await readJsonResponse(res)
      setVms(data.vms || [])
    } catch (error: any) {
      toast.error(error?.message || "Failed to load VMs")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadVms()
  }, [loadVms])

  const loadSnapshots = useCallback(async (vm: SnapshotVm) => {
    if (!vm.nodeId) return
    setLoadingSnapshots(true)
    try {
      const res = await fetch(`/api/admin/snapshots?nodeId=${encodeURIComponent(vm.nodeId)}&vmid=${vm.vmid}`)
      const data = await readJsonResponse(res)
      setSnapshots(data.snapshots || [])
    } catch (error: any) {
      setSnapshots([])
      toast.error(error?.message || "Failed to load snapshots")
    } finally {
      setLoadingSnapshots(false)
    }
  }, [])

  const selectVm = async (vpsInstanceId: string) => {
    const vm = vms.find((entry) => entry.vpsInstanceId === vpsInstanceId) || null
    setSelected(vm)
    setSnapshots([])
    setCapability(null)
    if (vm?.nodeId) {
      await Promise.all([
        loadSnapshots(vm),
        fetch(`/api/admin/snapshots?diagnostics=1&nodeId=${encodeURIComponent(vm.nodeId)}&vmid=${vm.vmid}`)
          .then((res) => readJsonResponse(res))
          .then((data) => setCapability(data.diagnostic || null))
          .catch(() => setCapability(null)),
      ])
    }
  }

  const createSnapshot = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected?.nodeId) return
    setBusy(true)
    try {
      const res = await fetch("/api/admin/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: selected.nodeId, vmid: selected.vmid, name, description, vmstate }),
      })
      await readJsonResponse(res)
      toast.success(`Snapshot "${name}" created and verified`)
      setCreateOpen(false)
      setName("")
      setDescription("")
      setVmstate(false)
      await loadSnapshots(selected)
    } catch (error: any) {
      toast.error(error?.message || "Create failed")
    } finally {
      setBusy(false)
    }
  }

  const rollback = async (snapshot: VmSnapshot) => {
    if (!selected?.nodeId) return
    if (!window.confirm(`Roll vmid ${selected.vmid} back to snapshot "${snapshot.name}"?\n\nThis RESTORES the disk to the snapshot state and current changes will be LOST. This cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/snapshots?action=rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: selected.nodeId, vmid: selected.vmid, name: snapshot.name }),
      })
      await readJsonResponse(res)
      toast.success(`Rollback to "${snapshot.name}" completed`)
      await loadSnapshots(selected)
    } catch (error: any) {
      toast.error(error?.message || "Rollback failed")
    } finally {
      setBusy(false)
    }
  }

  const remove = async (snapshot: VmSnapshot) => {
    if (!selected?.nodeId) return
    if (!window.confirm(`Delete snapshot "${snapshot.name}"?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/snapshots?nodeId=${encodeURIComponent(selected.nodeId)}&vmid=${selected.vmid}&name=${encodeURIComponent(snapshot.name)}`, { method: "DELETE" })
      const data = await readJsonResponse(res)
      toast.success(data.result?.verified ? `Snapshot "${snapshot.name}" deleted` : `Snapshot "deleted" from Proxmox`)
      await loadSnapshots(selected)
    } catch (error: any) {
      toast.error(error?.message || "Delete failed")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading VMs…</CardContent></Card>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Snapshots</h1>
        <p className="text-muted-foreground">Read/create/delete/rollback Proxmox VM snapshots. Rollback restores disk state and is destructive.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Select VM</CardTitle>
            <CardDescription>VMs with an active vps instance and a provisioned vmid.</CardDescription>
          </CardHeader>
          <CardContent>
            {vms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No VMs available.</p>
            ) : (
              <div className="space-y-1 max-h-[26rem] overflow-y-auto pr-1">
                {vms.map((vm) => (
                  <button
                    key={vm.vpsInstanceId}
                    type="button"
                    onClick={() => selectVm(vm.vpsInstanceId)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm border ${selected?.vpsInstanceId === vm.vpsInstanceId ? "bg-blue-50 border-blue-300" : "border-transparent hover:bg-muted"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{vm.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">VMID {vm.vmid}</span>
                    </div>
                    {vm.nodeName && <p className="text-xs text-muted-foreground mt-0.5">{vm.nodeName}</p>}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Snapshots{selected ? ` — ${selected.name} (VMID ${selected.vmid})` : ""}</CardTitle>
              <CardDescription>Live list from Proxmox; the &quot;current&quot; row represents the running disk state.</CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)} disabled={!selected} >New snapshot</Button>
          </CardHeader>
          <CardContent>
            {selected && capability ? (
              <div className={`mb-4 rounded-md border p-3 text-sm ${capability.capable ? "border-emerald-400/30 bg-emerald-400/10" : "border-red-400/30 bg-red-400/10"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Snapshot capable:</span>
                  <Badge variant={capability.capable ? "default" : "destructive"}>{capability.capable ? "YES" : "NO"}</Badge>
                </div>
                {!capability.capable && capability.reason ? <p className="mt-1 text-xs text-red-200">{capability.reason}</p> : null}
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {capability.disks.length === 0 ? (
                    <p>No snapshot-relevant disks detected (no data disks, or config unavailable).</p>
                  ) : (
                    capability.disks.map((disk) => (
                      <p key={disk.key}>
                        {disk.key} · VMID {capability.vmid} · storage <span className="font-medium text-foreground">{disk.storage}</span> · type{" "}
                        <span className="font-medium text-foreground">{disk.type}</span>
                        {disk.format ? ` · format ${disk.format}` : ""} · capable <span className="font-medium text-foreground">{disk.snapshotCapable ? "yes" : "no"}</span>
                      </p>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            {!selected ? (
              <p className="text-sm text-muted-foreground">Select a VM on the left.</p>
            ) : loadingSnapshots ? (
              <p className="text-sm text-muted-foreground">Loading snapshots…</p>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No snapshots on this VM.</p>
            ) : (
              <div className="space-y-3">
                {snapshots.map((snapshot) => (
                  <div key={snapshot.name} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{snapshot.name}</span>
                          {snapshot.current && <Badge>current</Badge>}
                          {snapshot.vmstate && <Badge className="bg-purple-100 text-purple-800">vmstate</Badge>}
                        </div>
                        {snapshot.description && <p className="text-xs text-muted-foreground mt-1">{snapshot.description}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatBytes(snapshot.sizeBytes)} · created {snapshot.created || "unknown"}
                          {snapshot.dbRecord ? ` · tracked (${snapshot.dbRecord.status}${snapshot.dbRecord.createdBy ? `, by ${snapshot.dbRecord.createdBy}` : ""})` : " · untracked (created outside ZWS)"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" onClick={() => remove(snapshot)} disabled={busy}>Delete</Button>
                        <Button variant="destructive" size="sm" onClick={() => rollback(snapshot)} disabled={busy}>Roll back</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New snapshot — {selected?.name} (VMID {selected?.vmid})</DialogTitle>
            <DialogDescription>Name may contain letters, digits, dots, underscores and dashes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createSnapshot} className="space-y-4">
            <div className="space-y-1">
              <Label>Snapshot name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} required placeholder="e.g. pre-update-2026-09-14" pattern="[A-Za-z0-9._-]+" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Include RAM state (vmstate)</Label>
              <Switch checked={vmstate} onCheckedChange={setVmstate} />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !name}>{busy ? "Creating…" : "Create snapshot"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}