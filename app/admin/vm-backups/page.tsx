"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useMemo, useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"
import { BACKUP_RETENTION_PRESETS, BACKUP_SCHEDULE_PRESETS, preferredBackupStorage, type BackupStorageInfo } from "@/lib/backup-storage"

type Storage = BackupStorageInfo

type VmBackupPolicy = {
  id: string
  name: string
  nodeId: string | null
  storage: string
  scheduleMinutes: number
  retention: number
  includeVms: number[]
  mode: string
  compress: string | null
  notify: string
  isEnabled: boolean
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  metadata: Record<string, unknown>
}

type HistoryRow = {
  id: string
  vmid: number | null
  schedule: string | null
  status: string
  destination: string | null
  backupPath: string | null
  sizeBytes: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  vm?: { name: string } | null
  customer?: { name: string } | null
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

function statusBadge(status?: string | null) {
  const value = (status || "unknown").toLowerCase()
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    success: "bg-green-100 text-green-800",
    running: "bg-blue-100 text-blue-800",
    queued: "bg-yellow-100 text-yellow-800",
    partial: "bg-orange-100 text-orange-800",
    failed: "bg-red-100 text-red-800",
    error: "bg-red-100 text-red-800",
    cancelled: "bg-gray-200 text-gray-700",
  }
  return <Badge className={`${colors[value] || "bg-gray-100 text-gray-700"}`}>{status || "unknown"}</Badge>
}

const emptyPolicy: VmBackupPolicy = {
  id: "",
  name: "",
  nodeId: null,
  storage: "",
  scheduleMinutes: 180,
  retention: 5,
  includeVms: [],
  mode: "snapshot",
  compress: "zstd",
  notify: "disabled",
  isEnabled: true,
  nextRunAt: null,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  metadata: {},
}

export default function VmBackupsPage() {
  const [storages, setStorages] = useState<Storage[]>([])
  const [policies, setPolicies] = useState<VmBackupPolicy[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [primaryNodeId, setPrimaryNodeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<VmBackupPolicy | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<VmBackupPolicy>(emptyPolicy)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vm-backups")
      const data = await readJsonResponse(res)
      setStorages(data.storages || [])
      setPolicies(data.policies || [])
      setHistory(data.history || [])
      setPrimaryNodeId(data.primaryNodeId || null)
    } catch (error: any) {
      toast.error(error?.message || "Failed to load VM backups")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const backupCapableStorages = useMemo(() => storages.filter((s) => s.supportsBackup), [storages])

  const openCreate = () => {
    setForm({ ...emptyPolicy, storage: preferredBackupStorage(storages) })
    setIsNew(true)
    setEditing(emptyPolicy)
  }

  const openEdit = (policy: VmBackupPolicy) => {
    setForm({ ...policy, includeVms: [...policy.includeVms] })
    setIsNew(false)
    setEditing(policy)
  }

  const closeDialog = () => {
    setEditing(null)
    setForm(emptyPolicy)
  }

  const savePolicy = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(isNew ? "/api/admin/vm-backups" : `/api/admin/vm-backups/${form.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await readJsonResponse(res)
      toast.success(isNew ? "Backup policy created" : "Backup policy updated")
      closeDialog()
      load()
    } catch (error: any) {
      toast.error(error?.message || "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (policy: VmBackupPolicy, enabled: boolean) => {
    try {
      const res = await fetch(`/api/admin/vm-backups/${policy.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: enabled }),
      })
      await readJsonResponse(res)
      toast.success(enabled ? "Policy enabled" : "Policy paused")
      load()
    } catch (error: any) {
      toast.error(error?.message || "Update failed")
    }
  }

  const deletePolicy = async (policy: VmBackupPolicy) => {
    if (!window.confirm(`Delete backup policy "${policy.name}"? Existing backups stay on the node; only the schedule is removed.`)) return
    try {
      const res = await fetch(`/api/admin/vm-backups/${policy.id}`, { method: "DELETE" })
      await readJsonResponse(res)
      toast.success("Policy deleted")
      load()
    } catch (error: any) {
      toast.error(error?.message || "Delete failed")
    }
  }

  const runNow = async (policy: VmBackupPolicy) => {
    try {
      const res = await fetch("/api/admin/vm-backups/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId: policy.id, sync: false }),
      })
      await readJsonResponse(res)
      toast.success("Backup queued — scheduler picks it up within a minute")
    } catch (error: any) {
      toast.error(error?.message || "Queue failed")
    }
  }

  if (loading) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">Loading VM backups…</CardContent></Card>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">VM Backups</h1>
        <p className="text-muted-foreground">Backup service with per-policy schedules and keep-last-N retention.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup storage pools</CardTitle>
          <CardDescription>Live discovery from the primary node of storages that accept backup archives.</CardDescription>
        </CardHeader>
        <CardContent>
          {primaryNodeId && <p className="text-xs text-muted-foreground mb-2">Primary node: {primaryNodeId}</p>}
          {backupCapableStorages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backup-capable storage detected on the primary node.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {backupCapableStorages.map((storage) => (
                <div key={storage.name} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{storage.name}</span>
                    <span className="text-xs text-muted-foreground">{storage.type}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">content: {storage.content}</p>
                  <div className="mt-2 text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{formatBytes(storage.totalBytes)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Used</span><span>{formatBytes(storage.usedBytes)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Available</span><span className="font-medium">{formatBytes(storage.availBytes)}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Policies</CardTitle>
            <CardDescription>Each policy targets a set of VM IDs with a schedule, compression and keep-last retention.</CardDescription>
          </div>
          <Button onClick={openCreate} disabled={backupCapableStorages.length === 0 || !primaryNodeId}>New policy</Button>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">No policies yet. Create one to schedule backups.</p>
          ) : (
            <div className="space-y-3">
              {policies.map((policy) => (
                <div key={policy.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{policy.name}</span>
                        {statusBadge(policy.lastStatus)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        target storage <b>{policy.storage}</b> · VMs {policy.includeVms.join(", ") || "—"} · every {policy.scheduleMinutes} min · keep {policy.retention}
                      </p>
                      {policy.lastError && <p className="text-xs text-red-600 mt-1">{policy.lastError}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch checked={policy.isEnabled} onCheckedChange={(checked) => toggleEnabled(policy, checked)} aria-label="Enabled" />
                      <Button variant="outline" size="sm" onClick={() => openEdit(policy)}>Edit</Button>
                      <Button variant="outline" size="sm" onClick={() => runNow(policy)} disabled={!policy.isEnabled}>Back up now</Button>
                      <Button variant="ghost" size="sm" onClick={() => deletePolicy(policy)}>Delete</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Recent backup tasks tracked in the database.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backup tasks yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4">VM</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Size</th>
                    <th className="py-2 pr-4">Storage</th>
                    <th className="py-2 pr-4">Started</th>
                    <th className="py-2 pr-4">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="py-2 pr-4">{row.vm ? row.vm.name : `VM-${row.vmid || "?"}`}</td>
                      <td className="py-2 pr-4">{statusBadge(row.status)}</td>
                      <td className="py-2 pr-4">{formatBytes(row.sizeBytes)}</td>
                      <td className="py-2 pr-4">{row.destination || "—"}</td>
                      <td className="py-2 pr-4">{formatDate(row.startedAt)}</td>
                      <td className="py-2 pr-4">{formatDate(row.completedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isNew ? "New backup policy" : `Edit ${editing?.name || "policy"}`}</DialogTitle>
            <DialogDescription>Retention is keep-last-N: only after each successful backup are older copies this policy owns pruned.</DialogDescription>
          </DialogHeader>
          <form onSubmit={savePolicy} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required placeholder="e.g. Daily customer backups" />
              </div>
              <div className="space-y-1">
                <Label>Target storage</Label>
                <Select value={form.storage} onValueChange={(value) => setForm({ ...form, storage: value })}>
                  <SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger>
                  <SelectContent>
                    {backupCapableStorages.map((storage) => (
                      <SelectItem key={storage.name} value={storage.name}>{storage.name} ({formatBytes(storage.availBytes)} free)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Schedule</Label>
                <Select value={String(form.scheduleMinutes)} onValueChange={(value) => setForm({ ...form, scheduleMinutes: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BACKUP_SCHEDULE_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={String(preset.value)}>{preset.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Retention</Label>
                <Select value={String(form.retention)} onValueChange={(value) => setForm({ ...form, retention: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BACKUP_RETENTION_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={String(preset.value)}>{preset.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Backup mode</Label>
                <Select value={form.mode} onValueChange={(value) => setForm({ ...form, mode: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="snapshot">snapshot (live, recommended)</SelectItem>
                    <SelectItem value="suspend">suspend</SelectItem>
                    <SelectItem value="stop">stop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Compression</Label>
                <Select value={form.compress || "no-compress"} onValueChange={(value) => setForm({ ...form, compress: value === "no-compress" ? null : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zstd">zstd</SelectItem>
                    <SelectItem value="lzo">lzo</SelectItem>
                    <SelectItem value="gzip">gzip</SelectItem>
                    <SelectItem value="no-compress">none</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 md:col-span-1">
                <Label>Notify</Label>
                <Select value={form.notify} onValueChange={(value) => setForm({ ...form, notify: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="disabled">disabled</SelectItem>
                    <SelectItem value="always">always</SelectItem>
                    <SelectItem value="failure">failure only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between md:col-span-2">
                <Label>Enabled</Label>
                <Switch checked={form.isEnabled} onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>VM IDs (comma or newline separated)</Label>
              <Textarea
                rows={3}
                value={form.includeVms.join("\n")}
                onChange={(event) => setForm({ ...form, includeVms: event.target.value.split(/[,\s]+/).filter(Boolean).map((value) => Number(value)).filter((n) => Number.isInteger(n) && n > 0) })}
                placeholder={"e.g. 1001\n1002\n1003"}
              />
              <p className="text-xs text-muted-foreground">Backups are only written for VMIDs that also map to a vps instance.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
              <Button type="submit" disabled={saving || !form.storage}>{saving ? "Saving…" : isNew ? "Create policy" : "Save changes"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}