"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useMemo, useState } from "react"
import type React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type BackupRun = {
  id: string
  status: string
  triggerType: string
  scope: unknown
  sizeBytes?: string | number | null
  log?: string | null
  error?: string | null
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  restoreTests?: { id: string; status: string; createdAt: string; error?: string | null }[]
}

type Config = {
  backups?: Record<string, unknown>
  googleDriveBackups?: Record<string, unknown>
}

function formatBytes(value: unknown) {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatTime(value: unknown) {
  const date = value ? new Date(String(value)) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "No backups yet"
}

function duration(run?: BackupRun | null) {
  if (!run?.startedAt || !run?.completedAt) return "-"
  const start = new Date(run.startedAt).getTime()
  const end = new Date(run.completedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-"
  const seconds = Math.round((end - start) / 1000)
  return `${seconds}s`
}

function backupType(scope: unknown) {
  const values = Array.isArray(scope) ? scope.map(String) : [String(scope || "database")]
  if (values.includes("full")) return "Full"
  if (values.includes("files")) return "Files"
  return "Database"
}

function statusText(value: string) {
  return String(value || "").toLowerCase() === "completed" ? "Success" : String(value || "Failed")
}

export default function AdminBackupsPage() {
  const [runs, setRuns] = useState<BackupRun[]>([])
  const [health, setHealth] = useState<any>(null)
  const [config, setConfig] = useState<Config>({})
  const [provider, setProvider] = useState("local")
  const [rcloneRemote, setRcloneRemote] = useState("")
  const [retentionDays, setRetentionDays] = useState("30")
  const [busy, setBusy] = useState("")
  const [logsRun, setLogsRun] = useState<BackupRun | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [restoreRun, setRestoreRun] = useState<BackupRun | null>(null)
  const [restoreMode, setRestoreMode] = useState<"DRY_RUN" | "MERGE_RESTORE">("DRY_RUN")
  const [restoreTables, setRestoreTables] = useState("")
  const [restoreConfirmation, setRestoreConfirmation] = useState("")
  const latest = useMemo(() => runs[0] || null, [runs])

  const load = useCallback(async () => {
    const [runsRes, configRes] = await Promise.all([
      fetch("/api/admin/backups", { cache: "no-store" }),
      fetch("/api/admin/backups/config", { cache: "no-store" }),
    ])
    const runsData = await readJsonResponse<any>(runsRes)
    const configData = await readJsonResponse<any>(configRes)
    if (runsRes.ok) {
      setRuns(runsData.runs || [])
      setHealth(runsData.health || null)
    }
    if (configRes.ok) {
      setConfig(configData)
      const backupConfig = configData.backups || {}
      const driveConfig = configData.googleDriveBackups || {}
      const driveEnabled = driveConfig.enabled === true || String(driveConfig.enabled || "").toLowerCase() === "true"
      setProvider(String(backupConfig.provider || (driveEnabled ? "google_drive" : "local")))
      setRcloneRemote(String(backupConfig.rcloneRemote || backupConfig.remote || ""))
      setRetentionDays(String(backupConfig.retentionDays || 30))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function saveConfig() {
    setBusy("save")
    try {
      const driveEnabled = provider === "google_drive"
      const response = await fetch("/api/admin/backups/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backups: { provider, rcloneRemote, retentionDays: Number(retentionDays || 30) },
          googleDriveBackups: { ...(config.googleDriveBackups || {}), enabled: driveEnabled },
        }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Unable to save backup settings.")
      toast.success("Backup settings saved")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save backup settings.")
    } finally {
      setBusy("")
    }
  }

  async function runBackup(scope: "database" | "full") {
    setBusy(scope)
    try {
      const response = await fetch("/api/admin/backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: scope === "full" ? ["full"] : ["database"] }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.run?.error || data?.error || "Backup operation did not complete.")
      toast.success(scope === "full" ? "Full backup completed" : "Database backup completed")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup operation did not complete.")
      await load()
    } finally {
      setBusy("")
    }
  }

  async function restoreTest(id: string) {
    setBusy(`restore:${id}`)
    try {
      const response = await fetch(`/api/admin/backups/${id}/restore-test`, { method: "POST" })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.restore?.error || data?.error || "Restore test did not complete.")
      toast.success("Restore test passed")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Restore test did not complete.")
    } finally {
      setBusy("")
    }
  }

  async function deleteBackup(id: string) {
    setBusy(`delete:${id}`)
    try {
      const response = await fetch(`/api/admin/backups/${id}`, { method: "DELETE" })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Unable to delete backup.")
      toast.success("Backup deleted")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete backup.")
    } finally {
      setBusy("")
    }
  }

  async function retentionCleanup() {
    setBusy("retention")
    try {
      const response = await fetch("/api/admin/backups/retention-cleanup", { method: "POST" })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Retention cleanup did not complete.")
      toast.success(`Retention cleanup deleted ${Number(data?.result?.deleted || 0)} backup(s)`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retention cleanup did not complete.")
    } finally {
      setBusy("")
    }
  }

  async function testGoogleDrive() {
    setBusy("drive")
    try {
      const response = await fetch("/api/admin/backups/status", { method: "POST" })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Google Drive upload test did not complete.")
      toast.success("Google Drive upload test passed")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Google Drive upload test did not complete.")
    } finally {
      setBusy("")
    }
  }

  async function uploadBackup() {
    if (!uploadFile) return toast.error("Choose a .sql, .sql.gz, .dump, .backup, or .zip backup file.")
    setBusy("upload")
    try {
      const formData = new FormData()
      formData.set("file", uploadFile)
      const response = await fetch("/api/admin/backups/upload", { method: "POST", body: formData })
      const data = await readJsonResponse<any>(response)
      if (!response.ok) throw new Error(data?.error || "Backup upload failed.")
      toast.success("Backup uploaded")
      setUploadFile(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup upload failed.")
    } finally {
      setBusy("")
    }
  }

  async function restoreBackup() {
    if (!restoreRun) return
    setBusy(`restore-live:${restoreRun.id}`)
    try {
      const response = await fetch(`/api/admin/backups/${restoreRun.id}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: restoreMode,
          confirmation: restoreConfirmation,
          tables: restoreTables.split(",").map((table) => table.trim()).filter(Boolean),
        }),
      })
      const data = await readJsonResponse<any>(response)
      if (!response.ok || data?.success === false) throw new Error(data?.restore?.error || data?.error || "Backup restore failed.")
      toast.success(restoreMode === "DRY_RUN" ? "Dry run restore check completed" : "Database restore completed")
      setRestoreRun(null)
      setRestoreConfirmation("")
      setRestoreTables("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Backup restore failed.")
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Backups</h1>
          <p className="mt-1 text-muted-foreground">Run, verify, and monitor backup operations.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runBackup("database")} disabled={Boolean(busy)}>{busy === "database" ? "Running" : "Run Database Backup"}</Button>
          <Button variant="outline" onClick={() => runBackup("full")} disabled={Boolean(busy)}>{busy === "full" ? "Running" : "Run Full Backup"}</Button>
          <Button variant="outline" onClick={retentionCleanup} disabled={Boolean(busy)}>{busy === "retention" ? "Cleaning" : "Retention Cleanup"}</Button>
        </div>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Upload Backup</CardTitle><CardDescription>Import a database backup artifact for merge-only restore or verification.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
          <Field label="Backup file"><Input type="file" accept=".sql,.gz,.zip,.sql.gz,.dump,.backup" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} /></Field>
          <Button onClick={uploadBackup} disabled={Boolean(busy) || !uploadFile}>{busy === "upload" ? "Uploading" : "Upload Backup"}</Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Health</CardTitle><CardDescription>Current backup destination state.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Info label="Status" value={health?.ok ? "Healthy" : "Needs attention"} />
            <Info label="Provider" value={health?.provider || provider || "local"} />
            <Info label="Last Backup" value={formatTime(health?.lastRunAt)} />
            <Info label="Storage Used" value={formatBytes(health?.storageUsedBytes)} />
            <Info label="Retention Days" value={String(health?.retentionDays || retentionDays || 30)} />
          </CardContent>
        </Card>

        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Latest Backup</CardTitle><CardDescription>Most recent backup run.</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latest ? (
              <>
                <Info label="Status" value={statusText(latest.status)} />
                <Info label="Created" value={formatTime(latest.createdAt)} />
                <Info label="Size" value={formatBytes(latest.sizeBytes)} />
                <Info label="Duration" value={duration(latest)} />
              </>
            ) : <p className="text-muted-foreground">No backups have been created yet.</p>}
          </CardContent>
        </Card>

        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Backup Settings</CardTitle><CardDescription>Runtime backup destination.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">Local</SelectItem>
                  <SelectItem value="rclone">Rclone</SelectItem>
                  <SelectItem value="google_drive">Google Drive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {provider === "rclone" ? <Field label="Rclone Remote"><Input value={rcloneRemote} onChange={(event) => setRcloneRemote(event.target.value)} placeholder="remote:path" /></Field> : null}
            <Field label="Retention Days"><Input value={retentionDays} onChange={(event) => setRetentionDays(event.target.value)} inputMode="numeric" /></Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveConfig} disabled={Boolean(busy)}>{busy === "save" ? "Saving" : "Save Settings"}</Button>
              {provider === "google_drive" ? <Button variant="outline" asChild><a href="/api/admin/backups/google/start">Connect Drive</a></Button> : null}
              {provider === "google_drive" ? <Button variant="outline" onClick={testGoogleDrive} disabled={Boolean(busy)}>{busy === "drive" ? "Testing" : "Upload Test"}</Button> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Backup Runs</CardTitle><CardDescription>Run history and restore checks.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="flex flex-col gap-3 rounded-lg border border-border/40 p-4 md:flex-row md:items-center md:justify-between">
              <div className="grid gap-1 text-sm">
                <p className="font-medium">{statusText(run.status)}</p>
                <p><span className="text-muted-foreground">Backup Type:</span> {backupType(run.scope)}</p>
                <p><span className="text-muted-foreground">Created Time:</span> {formatTime(run.createdAt)}</p>
                <p><span className="text-muted-foreground">Size:</span> {formatBytes(run.sizeBytes)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setLogsRun(run)}>View Logs</Button>
                <Button variant="outline" asChild><a href={`/api/admin/backups/${run.id}/download`}>Download</a></Button>
                <Button variant="outline" onClick={() => restoreTest(run.id)} disabled={Boolean(busy) || run.status !== "completed"}>{busy === `restore:${run.id}` ? "Testing" : "Restore Test"}</Button>
                <Button variant="outline" onClick={() => { setRestoreRun(run); setRestoreMode("DRY_RUN"); setRestoreConfirmation(""); setRestoreTables("") }} disabled={Boolean(busy) || run.status !== "completed"}>Restore Backup</Button>
                <Button variant="outline" onClick={() => deleteBackup(run.id)} disabled={Boolean(busy)}>{busy === `delete:${run.id}` ? "Deleting" : "Delete Backup"}</Button>
              </div>
            </div>
          ))}
          {!runs.length ? <p className="text-sm text-muted-foreground">No backup runs yet.</p> : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(logsRun)} onOpenChange={(open) => { if (!open) setLogsRun(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Backup Logs</DialogTitle></DialogHeader>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border/40 bg-background p-4 text-xs">
            {[logsRun?.log, logsRun?.error].filter(Boolean).join("\n\n") || "No logs recorded."}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(restoreRun)} onOpenChange={(open) => { if (!open && !busy.startsWith("restore-live:")) setRestoreRun(null) }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Restore Backup</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Dry Run loads the artifact into an isolated import schema and reports additive changes. Merge Restore creates a rollback backup, adds only missing tables/columns, and imports only missing primary-key rows.
            </p>
            <Field label="Restore mode">
              <Select value={restoreMode} onValueChange={(value) => { setRestoreMode(value as "DRY_RUN" | "MERGE_RESTORE"); setRestoreConfirmation("") }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRY_RUN">Dry Run</SelectItem>
                  <SelectItem value="MERGE_RESTORE">Merge Restore</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {restoreMode === "MERGE_RESTORE" ? <Field label="Tables"><Input value={restoreTables} onChange={(event) => setRestoreTables(event.target.value)} placeholder="customers, orders, invoices" /></Field> : null}
            {restoreMode !== "DRY_RUN" ? (
              <Field label="Confirmation">
                <Input
                  value={restoreConfirmation}
                  onChange={(event) => setRestoreConfirmation(event.target.value)}
                  placeholder="MERGE RESTORE"
                />
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRestoreRun(null)} disabled={busy.startsWith("restore-live:")}>Cancel</Button>
              <Button
                variant={restoreMode === "DRY_RUN" ? "outline" : "destructive"}
                onClick={restoreBackup}
                disabled={busy.startsWith("restore-live:") || (restoreMode === "MERGE_RESTORE" && restoreConfirmation !== "MERGE RESTORE")}
              >
                {busy.startsWith("restore-live:") ? "Restoring" : restoreMode === "DRY_RUN" ? "Run Dry Run" : "Restore Backup"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <p><span className="text-muted-foreground">{label}:</span> {value}</p>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>
}
