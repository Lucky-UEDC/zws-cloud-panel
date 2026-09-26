"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Check, CircleAlert, ShieldCheck } from "lucide-react"
import { formatBytesDecimal } from "@/lib/format-units"
import { OperationProgressDialog } from "@/components/client/operation-progress-dialog"

type BackupVm = { vmId: number; vpsInstanceId: string; name: string; label?: string; status: string }
type BackupRow = {
  id: string
  vmId: number
  name: string
  ipAddress?: string | null
  vpsInstanceId: string
  status: string
  sizeBytes: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string | null
  error: string | null
}

type VmContext = {
  instance: { vpsInstanceId: string; name: string }
  vm: { name: string; status: string; maxmem: number; mem: number; maxcpu: number; uptime: number; ip: string | null; netin: number; netout: number } | null
  backupTarget: {
    policy: { id: string; name: string; retention: number; scheduleMinutes: number; nextRunAt: string | null; lastRunAt: string | null } | null
  } | null
  latestBackup: { id: string; status: string; startedAt: string | null; completedAt: string | null; sizeBytes: string | null } | null
  requiresShutdown: boolean
}

type BackupProgress = {
  status: string
  percent: number | null
  phase: string | null
  transferredLabel: string | null
  totalLabel: string | null
  speedLabel: string | null
  logTail: string[]
  exitStatus: string | null
  error: string | null
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-IN", withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })
}

function statusBadge(status: string) {
  const s = String(status || "queued")
  const variant: Record<string, string> = {
    completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    running: "border-sky-400/30 bg-sky-400/10 text-sky-200",
    queued: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    failed: "border-red-400/30 bg-red-400/10 text-red-200",
    cancelled: "border-border/60 bg-muted text-muted-foreground",
  }
  const cls = variant[s] || variant.queued
  return (
    <Badge variant="outline" className={cls}>
      {s.toUpperCase()}
    </Badge>
  )
}

export default function ClientBackupsPage() {
  const [vms, setVms] = useState<BackupVm[]>([])
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [billing, setBilling] = useState<{ entitlement: Record<string, any> | null; usage: Record<string, any> | null; subscribed: boolean } | null>(null)

  const [selectedId, setSelectedId] = useState<string>("")
  const [status, setStatus] = useState<string>("completed")
  const [search, setSearch] = useState("")

  const [ctx, setCtx] = useState<VmContext | null>(null)
  const [ctxLoading, setCtxLoading] = useState(false)

  const [backupNowOpen, setBackupNowOpen] = useState(false)
  const [startingBackup, setStartingBackup] = useState(false)
  const [backupStartedId, setBackupStartedId] = useState<string | null>(null)
  const [backupProgress, setBackupProgress] = useState<BackupProgress | null>(null)
  const [progressStatus, setProgressStatus] = useState<string>("queued")
  const [progressMeta, setProgressMeta] = useState<{ sizeBytes: string | null; completedAt: string | null; verification: { passed: boolean; reason: string | null } | null } | null>(null)
  const [progressOpen, setProgressOpen] = useState(false)
  const [progressError, setProgressError] = useState<string | null>(null)
  const [activeRunningBackup, setActiveRunningBackup] = useState<BackupRow | null>(null)

  const [details, setDetails] = useState<BackupRow | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<BackupRow | null>(null)
  const [confirmText, setConfirmText] = useState("")
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [shuttingDown, setShuttingDown] = useState(false)
  const [restoreVmStatus, setRestoreVmStatus] = useState<string>("unknown")
  const [restoreOperationId, setRestoreOperationId] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<BackupRow | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadlineRef = useRef<number>(0)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (selectedId) params.set("vpsInstanceId", selectedId)
    if (status && status !== "all") params.set("status", status)
    if (search) params.set("search", search)
    try {
      const res = await fetch(`/api/client/backups?${params.toString()}`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || "Failed to load backups")
      setBackups(body.backups || [])
      const running = (body.backups || []).find((b: BackupRow) => ["running", "queued"].includes(String(b.status).toLowerCase()))
      setActiveRunningBackup(running || null)
    } catch (e: any) {
      setError(e?.message || "Failed to load backups")
    } finally {
      setLoading(false)
    }
  }, [selectedId, status, search])

  const loadVms = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/backups?limit=50`, { cache: "no-store" })
      const body = await res.json()
      if (res.ok && body.success) {
        setVms(body.vms || [])
        setBilling(body.billing || null)
      }
    } catch {
      // best-effort
    }
  }, [])

  useEffect(() => {
    void loadVms()
  }, [loadVms])

  useEffect(() => {
    if (selectedId) void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, status, search])

  useEffect(() => {
  if (!selectedId && vms.length === 1) setSelectedId(vms[0].vpsInstanceId)
}, [vms, selectedId])

useEffect(() => {
  if (!selectedId) return
  let cancelled = false
  const loadCtx = async () => {
    setCtxLoading(true)
    try {
      const res = await fetch(`/api/client/backups/vm-context?vpsInstanceId=${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      const body = await res.json()
      if (cancelled) return
      setCtx(res.ok && body.success ? body : null)
    } catch {
      if (!cancelled) setCtx(null)
    } finally {
      if (!cancelled) setCtxLoading(false)
    }
  }
  void loadCtx()
  return () => {
    cancelled = true
  }
  }, [selectedId])

  const selectedVm = useMemo(() => vms.find((v) => v.vpsInstanceId === selectedId) || null, [vms, selectedId])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollProgress = useCallback(async (backupId: string) => {
    try {
      const res = await fetch(`/api/client/backups/${backupId}/progress`, { cache: "no-store" })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || "Progress check failed")
      setBackupProgress(body.progress || null)
      setProgressStatus(String(body.status || "queued"))
      setProgressMeta({
        sizeBytes: body.sizeBytes || null,
        completedAt: body.completedAt || null,
        verification: body.verification || null,
      })

      const terminal = ["completed", "failed", "cancelled"].includes(String(body.status || ""))
      if (terminal) {
        stopPolling()
        void loadHistory()
      } else if (Date.now() > pollDeadlineRef.current) {
        stopPolling()
        setBackupProgress((p) => (p ? { ...p, status: "timedout", error: "Progress polling timed out" } : { status: "timedout", percent: null, phase: null, transferredLabel: null, totalLabel: null, speedLabel: null, logTail: [], exitStatus: null, error: "Progress polling timed out" }))
      }
    } catch (e: any) {
      setProgressError(e?.message || "Progress check failed")
    }
  }, [stopPolling, loadHistory])

  const resumeActiveBackup = useCallback(() => {
    const target = activeRunningBackup
    if (!target) return
    stopPolling()
    setBackupProgress(null)
    setProgressStatus(String(target.status || "queued"))
    setProgressError(null)
    setProgressOpen(true)
    pollDeadlineRef.current = Date.now() + 60 * 60 * 1000
    void pollProgress(target.id)
    pollRef.current = setInterval(() => void pollProgress(target.id), 3000)
  }, [activeRunningBackup, pollProgress, stopPolling])

  const closeProgressDialog = useCallback(() => {
    stopPolling()
    setProgressOpen(false)
  }, [stopPolling])

  const startBackupNow = async () => {
    if (!selectedVm) return
    setStartingBackup(true)
    setProgressError(null)
    setBackupProgress(null)
    setProgressStatus("queued")
    setProgressMeta(null)
    try {
      const res = await fetch("/api/client/backups/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: selectedVm.vpsInstanceId }),
      })
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || "Failed to start backup")
      setBackupNowOpen(false)
      setBackupStartedId(body.backupId)
      setProgressOpen(true)
      pollDeadlineRef.current = Date.now() + 60 * 60 * 1000
      void pollProgress(body.backupId)
      pollRef.current = setInterval(() => void pollProgress(body.backupId), 3000)
      void loadHistory()
    } catch (e: any) {
      setProgressError(e?.message || "Failed to start backup")
    } finally {
      setStartingBackup(false)
    }
  }

  const openRestore = async (backup: BackupRow) => {
    setRestoreTarget(backup)
    setConfirmText("")
    setRestoreResult(null)
    setRestoreVmStatus("unknown")
    try {
      const res = await fetch(`/api/client/backups/vm-context?vpsInstanceId=${encodeURIComponent(backup.vpsInstanceId)}`, { cache: "no-store" })
      const body = await res.json()
      if (res.ok && body.success) setRestoreVmStatus(String(body.vm?.status || "unknown").toLowerCase())
    } catch {
      setRestoreVmStatus("unknown")
    }
  }

  const doShutdownBeforeRestore = async () => {
    if (!restoreTarget) return
    setShuttingDown(true)
    setRestoreResult(null)
    try {
      const res = await fetch(`/api/client/backups/${restoreTarget.id}/shutdown`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: restoreTarget.vpsInstanceId }),
      })
      const body = await res.json()
      if (!res.ok || !body?.success) throw new Error(body?.shutdown?.message || body?.error || "Shutdown failed")
      setRestoreResult({ ok: true, message: `Server shut down (${String(body.shutdown?.status || "stopped")}). You can now restore.` })
      setRestoreVmStatus(body.shutdown?.status || "stopped")
    } catch (e: any) {
      setRestoreResult({ ok: false, message: e?.message || "Shutdown failed." })
    } finally {
      setShuttingDown(false)
    }
  }

  const doRestore = async () => {
    if (!restoreTarget) return
    setRestoring(true)
    setRestoreResult(null)
    try {
      const res = await fetch(`/api/client/backups/${restoreTarget.id}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vpsInstanceId: restoreTarget.vpsInstanceId, confirmation: confirmText }),
      })
      const body = await res.json()
      if (res.status === 501) {
        setRestoreResult({ ok: false, message: body?.restore?.reason || "Restore is not supported on this node." })
      } else if (res.status === 409) {
        setRestoreResult({ ok: false, message: body?.error || "The server is still running. Shut it down and try again." })
      } else if (res.ok && body?.success) {
        setRestoreResult({ ok: true, message: "Restore was queued. Progress is shown in the dialog. The server stays off and is not started automatically." })
        setRestoreTarget(null)
        if (body.operationId) setRestoreOperationId(String(body.operationId))
        else void loadHistory()
      } else {
        setRestoreResult({ ok: false, message: body?.error || body?.restore?.reason || "Restore failed." })
      }
    } catch (e: any) {
      setRestoreResult({ ok: false, message: e?.message || "Restore failed." })
    } finally {
      setRestoring(false)
    }
  }

  const doDeleteBackup = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/client/backups/${deleteTarget.id}/delete?vpsInstanceId=${encodeURIComponent(deleteTarget.vpsInstanceId)}&confirmation=${encodeURIComponent(deleteConfirm)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        cache: "no-store",
      })
      const body = await res.json()
      if (!res.ok || !body?.success) throw new Error(body?.error || "Deletion failed.")
      setDeleteTarget(null)
      setDeleteConfirm("")
      // Usage + count changed: refresh history, billing header and VM list.
      void loadHistory()
      void loadVms()
    } catch (e: any) {
      setDeleteError(e?.message || "Deletion failed.")
    } finally {
      setDeleting(false)
    }
  }

  const percent = backupProgress?.percent != null ? Math.max(0, Math.min(100, backupProgress.percent)) : 0

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground">Create and restore backups of your virtual servers. Restoring overwrites the server disk and requires the server to be stopped.</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/client-area/vps">Go to VMs</Link>
        </Button>
      </div>

      {billing && billing.entitlement ? (
        <Card className="border-border/40 bg-background/80">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-52 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="text-sm font-medium">
                    {billing.usage?.planName || "Backup plan"} <span className="ml-1 text-xs text-muted-foreground">({String(billing.usage?.status || "").toUpperCase()})</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Number(billing.usage?.backupCount || 0)}{billing.usage?.maxBackups != null ? ` / ${Number(billing.usage?.maxBackups)} backups used` : " backups used"}
                    {Number(billing.usage?.usedGb || 0) > 0 || Number(billing.usage?.storageQuotaGb || 0) > 0
                      ? ` · ${Number(billing.usage?.usedGb || 0)} GB / ${Number(billing.usage?.storageQuotaGb || 0)} GB used`
                      : ""}
                  </p>
                </div>
                <Progress value={Math.min(100, Math.round((Number(billing.usage?.usedGb || 0) / Math.max(1, Number(billing.usage?.storageQuotaGb || 1))) * 100))} className="mt-2 h-2" />
                {billing.usage?.remainingGb != null && Number(billing.usage?.storageQuotaGb || 0) > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">{Number(billing.usage?.remainingGb)} GB storage remaining</p>
                ) : null}
                {billing.usage?.remainingBackups != null && billing.usage?.remainingBackups > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {billing.usage?.remainingBackups} backup{billing.usage?.remainingBackups === 1 ? "" : "s"} slot{billing.usage?.remainingBackups === 1 ? "" : "s"} remaining
                  </p>
                ) : billing.usage?.remainingBackups === 0 ? (
                  <p className="mt-1 text-xs text-amber-300">Backup limit reached — delete an old backup or upgrade your plan to run a new one.</p>
                ) : null}
                {Number(billing.usage?.overStoragePercent || 0) > 100 ? (
                  <p className="mt-2 text-xs text-amber-300">Storage usage is above your quota. Overage is billing extra usage at ₹{Number(billing.usage?.overageRatePerGb || 0)}/GB.</p>
                ) : null}
                {String(billing.usage?.status || "").toLowerCase() === "grace" ? (
                  <p className="mt-2 text-xs text-amber-300">
                    Your plan is in its grace period{billing?.entitlement?.graceEndsAt ? ` until ${new Date(billing.entitlement.graceEndsAt).toLocaleDateString("en-IN")}` : ""}. Renew from the backup plans page to keep backups and restores active.
                  </p>
                ) : null}
                {String(billing.usage?.status || "").toLowerCase() === "expired" ? (
                  <p className="mt-2 text-xs text-red-300">Your plan has expired. Automated backups are paused until you purchase a new one.</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/client-area/backup-plans">Manage plan</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/client-area/billing">Add storage / billing</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : billing ? (
        <Card className="border-amber-400/30 bg-amber-400/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm font-medium">No active backup plan</p>
              <p className="text-xs text-muted-foreground">Backups require an active backup plan. Your stored backups are kept and protected during any grace period.</p>
            </div>
            <Button asChild size="sm" className="bg-amber-500/90 text-black hover:bg-amber-400">
              <Link href="/client-area/backup-plans">Choose a backup plan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border/40 bg-background/80 lg:col-span-3">
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="vm-select">Server</Label>
                <Select value={selectedId || "all"} onValueChange={(value) => setSelectedId(value === "all" ? "" : value)}>
                  <SelectTrigger id="vm-select" className="w-full">
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All servers</SelectItem>
                    {vms.map((vm) => (
                      <SelectItem key={vm.vmId} value={vm.vpsInstanceId}>
                        {vm.label || vm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status-select">Backup status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="status-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="search-input">Search</Label>
                <Input id="search-input" placeholder="name / backup id" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex items-end">
                {selectedVm ? (
                  <Button size="sm" className="w-full bg-amber-500/90 text-black hover:bg-amber-400" onClick={() => setBackupNowOpen(true)}>
                    Backup now
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled className="w-full">
                    Select a server to back up
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedVm ? (
        <Card className="border-border/40 bg-background/80">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{ctx?.instance?.name || selectedVm.name}</CardTitle>
              {ctxLoading ? <Spinner className="h-4 w-4" /> : null}
            </div>
            <CardDescription>Backup target for this server.</CardDescription>
          </CardHeader>
          <CardContent>
            {ctx ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm">
                    {ctx.vm ? (
                      <span className={ctx.vm.status === "running" ? "text-emerald-300" : "text-muted-foreground"}>
                        {String(ctx.vm.status).toUpperCase()}
                      </span>
                    ) : (
                      "UNKNOWN"
                    )}
                    {ctx.vm?.ip ? <span className="ml-2 font-mono text-xs text-muted-foreground">{ctx.vm.ip}</span> : null}
                  </p>
                  {ctx.vm && ctx.vm.mem > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {formatBytesDecimal(String(ctx.vm.maxmem))} RAM · {ctx.vm.maxcpu} CPU
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Storage quota</p>
                  <p className="text-sm">
                    {Number(billing?.usage?.usedGb || 0)} GB of {Number(billing?.usage?.storageQuotaGb || 0)} GB used
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {billing?.usage?.remainingGb != null ? `${Number(billing?.usage?.remainingGb)} GB remaining` : "No active plan"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Backup mode</p>
                  <p className="text-sm">Snapshot</p>
                  <p className="text-xs text-muted-foreground">No server restart required</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Latest backup</p>
                  {ctx.latestBackup ? (
                    <>
                      <p className="text-sm">{formatDate(ctx.latestBackup.completedAt, true)}</p>
                      <p className="text-xs text-muted-foreground">{ctx.latestBackup.sizeBytes ? `${formatBytesDecimal(ctx.latestBackup.sizeBytes)} · ${String(ctx.latestBackup.status).toUpperCase()}` : String(ctx.latestBackup.status).toUpperCase()}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No completed backup yet</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{ctxLoading ? "Loading server info…" : "Server info is unavailable right now."}</p>
            )}

            {ctx?.backupTarget?.policy ? (
              <div className="mt-4 border-t border-border/40 pt-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Schedule: every <strong className="text-foreground">{ctx.backupTarget.policy.scheduleMinutes}</strong> minute{ctx.backupTarget.policy.scheduleMinutes === 1 ? "" : "s"}
                  </span>
                  <span>
                    Retention: keep last <strong className="text-foreground">{ctx.backupTarget.policy.retention}</strong> successful backup{ctx.backupTarget.policy.retention === 1 ? "" : "s"}
                  </span>
                  {ctx.backupTarget.policy.nextRunAt ? <span>Next run: {formatDate(ctx.backupTarget.policy.nextRunAt, true)}</span> : null}
                  {ctx.backupTarget.policy.lastRunAt ? <span>Last run: {formatDate(ctx.backupTarget.policy.lastRunAt, true)}</span> : null}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      <Card className="border-border/40 bg-background/80">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Backup history {selectedVm ? `· ${selectedVm.name}` : ""}</CardTitle>
            <CardDescription>{backups.length} backup{backups.length === 1 ? "" : "s"} · newest first</CardDescription>
          </div>
          {loading ? <Spinner className="h-4 w-4" /> : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading backups…</div>
          ) : backups.length === 0 ? (
            error ? (
              <div className="flex flex-col items-center gap-3 py-10">
                <p className="text-sm text-red-200">Unable to load backups.</p>
                <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                  Retry
                </Button>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">No backups match the current filters.</div>
            )
          ) : (
            <div className="min-w-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Server</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => (
                    <TableRow key={backup.id}>
                      <TableCell className="font-medium">{backup.name}</TableCell>
                      <TableCell>{statusBadge(backup.status)}</TableCell>
                      <TableCell>{backup.sizeBytes ? formatBytesDecimal(backup.sizeBytes) : "-"}</TableCell>
                      <TableCell>{formatDate(backup.startedAt, true)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setDetails(backup)}>
                            Details
                          </Button>
                          {backup.status === "completed" ? (
                            <Button variant="default" size="sm" onClick={() => void openRestore(backup)} className="bg-amber-500/90 text-black hover:bg-amber-400">
                              Restore
                            </Button>
                          ) : null}
                          {["completed", "failed", "cancelled"].includes(String(backup.status).toLowerCase()) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-red-400/40 text-red-300 hover:bg-red-400/10 hover:text-red-200"
                              onClick={() => {
                                setDeleteTarget(backup)
                                setDeleteConfirm("")
                                setDeleteError(null)
                              }}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={backupNowOpen} onOpenChange={(open) => (open ? null : setBackupNowOpen(false))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a backup now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  A backup of <span className="font-medium">{selectedVm?.name}</span> will be created on your server&apos;s hosting node (snapshot mode). The backup
                  runs in the background and does not restart your server.
                </p>
                <p className="text-muted-foreground">A consistent snapshot is taken while your server keeps running (snapshot mode).</p>
                {progressError ? <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{progressError}</div> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startingBackup} onClick={() => setBackupNowOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction disabled={startingBackup} onClick={(e) => { e.preventDefault(); void startBackupNow() }}>
              {startingBackup ? "Starting…" : "Start backup"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={progressOpen} onOpenChange={(open) => (open ? null : closeProgressDialog())}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {progressStatus === "completed" ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : progressStatus === "failed" ? (
                <CircleAlert className="h-4 w-4 text-red-400" />
              ) : progressStatus === "cancelled" ? (
                <span className="text-muted-foreground">Backup cancelled</span>
              ) : (
                <Spinner className="h-4 w-4 text-accent" />
              )}
              {progressStatus === "completed" ? "Backup completed" : progressStatus === "failed" ? "Backup failed" : progressStatus === "cancelled" ? "Backup cancelled" : "Backing up server"}
            </DialogTitle>
            <DialogDescription>{selectedVm?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {progressStatus === "completed" ? (
              <div className="space-y-3 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-4">
                {progressMeta?.verification && !progressMeta.verification.passed ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-200">
                    <CircleAlert className="h-4 w-4" />
                    The backup finished but the archive could not be confirmed on storage yet.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
                    <ShieldCheck className="h-4 w-4" />
                    The backup completed and was verified on storage.
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  {progressMeta?.sizeBytes ? (
                    <div>
                      <dt className="text-muted-foreground">Size</dt>
                      <dd className="text-sm text-foreground">{formatBytesDecimal(progressMeta.sizeBytes)}</dd>
                    </div>
                  ) : null}
                  {progressMeta?.completedAt ? (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Completed</dt>
                      <dd className="text-sm text-foreground">{formatDate(progressMeta.completedAt, true)}</dd>
                    </div>
                  ) : null}
                  {progressMeta?.verification && progressMeta.verification.passed ? (
                    <div className="col-span-2 flex items-center gap-1.5 text-emerald-200">
                      <Check className="h-3.5 w-3.5" /> Verified archive
                    </div>
                  ) : null}
                </dl>
              </div>
            ) : progressStatus === "failed" ? (
              <div className="space-y-2 rounded-md border border-red-400/30 bg-red-400/5 p-4">
                <p className="text-sm font-medium text-red-200">The backup could not be completed.</p>
                {backupProgress?.error ? <p className="break-words text-xs text-red-200/90">{backupProgress.error}</p> : null}
                <p className="text-xs text-muted-foreground">You can start a new backup from the Backups page.</p>
              </div>
            ) : progressStatus === "cancelled" ? (
              <div className="space-y-2 rounded-md border border-border/50 bg-muted/40 p-4">
                <p className="text-sm font-medium">The backup was cancelled.</p>
                <p className="text-xs text-muted-foreground">You can start a new backup from the Backups page.</p>
              </div>
            ) : (
              <>
                {backupProgress?.percent != null ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{backupProgress.phase || "Backing up"}</span>
                      <span aria-live="polite">{backupProgress.percent}%</span>
                    </div>
                    <Progress value={percent} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner className="h-4 w-4" /> Waiting for the backup task…
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  {backupProgress?.transferredLabel ? (
                    <div className="min-w-0">
                      <span className="block text-muted-foreground/70">Transferred</span>
                      <span className="block truncate text-sm text-foreground">{backupProgress.transferredLabel}</span>
                    </div>
                  ) : null}
                  {backupProgress?.totalLabel ? (
                    <div className="min-w-0">
                      <span className="block text-muted-foreground/70">Total</span>
                      <span className="block truncate text-sm text-foreground">{backupProgress.totalLabel}</span>
                    </div>
                  ) : null}
                  {backupProgress?.speedLabel ? (
                    <div className="min-w-0">
                      <span className="block text-muted-foreground/70">Speed</span>
                      <span className="block truncate text-sm text-foreground">{backupProgress.speedLabel}</span>
                    </div>
                  ) : null}
                </div>
                {backupProgress?.phase && backupProgress.percent == null ? <p className="text-xs text-muted-foreground">{backupProgress.phase}</p> : null}
                <p className="text-xs text-muted-foreground">You can close this window — the backup continues in the background and stays protected.</p>
              </>
            )}
            {backupProgress?.logTail && backupProgress.logTail.length > 0 && progressStatus !== "completed" ? (
              <div className="max-h-32 overflow-y-auto rounded-md border border-border/40 bg-muted/40 p-2">
                {backupProgress.logTail.map((line, i) => (
                  <p key={i} className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            {backupProgress?.error && progressStatus !== "completed" ? <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{backupProgress.error}</div> : null}
            {progressError ? <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{progressError}</div> : null}
          </div>
          <DialogFooter>
            {["completed", "failed", "cancelled"].includes(progressStatus) ? (
              <Button onClick={closeProgressDialog}>{progressStatus === "completed" ? "Done" : "Close"}</Button>
            ) : (
              <Button variant="outline" onClick={closeProgressDialog}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(details)} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup details</DialogTitle>
            <DialogDescription>{details?.name} · {details ? formatDate(details.createdAt, true) : ""}</DialogDescription>
          </DialogHeader>
          {details ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Backup ID</dt>
                <dd className="break-all font-mono text-xs">{details.id}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">VM ID</dt>
                <dd>{details.vmId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status</dt>
                <dd>{statusBadge(details.status)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Size</dt>
                <dd>{details.sizeBytes ? formatBytesDecimal(details.sizeBytes) : "-"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd>{formatDate(details.startedAt, true)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Completed</dt>
                <dd>{formatDate(details.completedAt, true)}</dd>
              </div>
              {details.error ? (
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Error</dt>
                  <dd className="text-red-300">{details.error}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetails(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(restoreTarget)} onOpenChange={(open) => (open ? null : setRestoreTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Restoring <span className="font-medium">{restoreTarget?.name}</span> from {restoreTarget ? formatDate(restoreTarget.createdAt, true) : ""}{" "}
                  overwrites the server&apos;s disk with the backup contents.
                </p>
                <div className={`rounded-md border p-3 text-xs ${restoreVmStatus === "stopped" || restoreVmStatus === "not-running" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>
                  {restoreVmStatus === "stopped" || restoreVmStatus === "not-running" ? (
                    <p>The server is currently powered off and ready to restore.</p>
                  ) : restoreVmStatus === "unknown" ? (
                    <p>Checking the server state… restoring requires the server to be powered off.</p>
                  ) : (
                    <p>
                      The server is <strong className="uppercase">{restoreVmStatus}</strong>. You must shut it down before restoring. Use{" "}
                      <strong>Shut down &amp; continue</strong> below.
                    </p>
                  )}
                </div>
                {restoreResult ? (
                  <div className={`rounded-md border p-3 text-xs ${restoreResult.ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-red-400/30 bg-red-400/10 text-red-200"}`}>
                    {restoreResult.message}
                  </div>
                ) : null}
                {(restoreVmStatus === "stopped" || restoreVmStatus === "not-running") && confirmText.toUpperCase() !== "RESTORE" ? (
                  <>
                    <Label htmlFor="restore-confirm">Type RESTORE to confirm</Label>
                    <Input id="restore-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" autoComplete="off" />
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring} onClick={() => setRestoreTarget(null)}>
              Cancel
            </AlertDialogCancel>
            {restoreVmStatus !== "stopped" && restoreVmStatus !== "not-running" ? (
              <AlertDialogAction
                disabled={shuttingDown}
                onClick={(e) => {
                  e.preventDefault()
                  void doShutdownBeforeRestore()
                }}
                className="bg-amber-500/90 text-black hover:bg-amber-400"
              >
                {shuttingDown ? "Shutting down…" : "Shut down & continue"}
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                disabled={confirmText.toUpperCase() !== "RESTORE" || restoring}
                onClick={(e) => {
                  e.preventDefault()
                  void doRestore()
                }}
              >
                {restoring ? "Restoring…" : "Restore backup"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => (open ? null : setDeleteTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This permanently deletes the backup of <span className="font-medium">{deleteTarget?.name}</span> from storage and releases its quota. This
                  cannot be undone.
                </p>
                {deleteError ? <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-200">{deleteError}</div> : null}
                <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
                <Input id="delete-confirm" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="DELETE" autoComplete="off" />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteConfirm.toUpperCase() !== "DELETE" || deleting}
              onClick={(e) => {
                e.preventDefault()
                void doDeleteBackup()
              }}
              className="bg-red-500/90 text-white hover:bg-red-500"
            >
              {deleting ? "Deleting…" : "Delete backup"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {activeRunningBackup ? (
        <button
          type="button"
          onClick={resumeActiveBackup}
          className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md border border-sky-400/40 bg-background/95 p-3 text-left shadow-lg backdrop-blur transition-colors hover:border-sky-400/70"
        >
          <Spinner className="h-4 w-4 shrink-0 text-sky-300" />
          <span className="text-xs text-muted-foreground">
            A backup is running — <span className="font-medium text-sky-300">view progress</span>
          </span>
        </button>
      ) : null}

      <OperationProgressDialog
        operationId={restoreOperationId || ""}
        open={Boolean(restoreOperationId)}
        onClose={() => setRestoreOperationId(null)}
        onComplete={() => void loadHistory()}
      />
    </div>
  )
}