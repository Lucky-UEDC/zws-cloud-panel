"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { customerDatabaseRepairMessage } from "@/lib/client/database-error"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Monitor } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { formatLastUpdated, useSmartPolling } from "@/lib/hooks/use-smart-polling"
import { CopyableIp } from "@/components/copyable-ip"
import { TableSkeleton } from "@/components/ui/page-skeletons"

type Row = {
  id: string
  orderId: string
  orderNumber: string
  hostname: string | null
  ipAddress: string | null
  os: string | null
  plan: string
  status: string
  customerStatus?: string
  provisioningStatus: string
  provisioningError: string | null
  billingStatus: string
  consoleAvailable?: boolean
  progress: { displayStatus?: string; currentStep?: string; status?: string } | null
  currentStep?: string
  latestLog?: { title?: string; message?: string } | null
  customerEmail?: string | null
  resources?: { cpuCores?: number | null; ramGb?: number | null; diskGb?: number | null; bandwidthTb?: number | null }
  nextRenewalAt?: string | null
  renewalDueAt?: string | null
  deletionAt?: string | null
  lastReminderLevel?: string | null
  createdAt: string
}

function countdownLabel(target?: string | null, prefix = "DUE IN") {
  if (!target) return "-"
  const date = new Date(target)
  if (Number.isNaN(date.getTime())) return "-"
  const ms = date.getTime() - Date.now()
  const abs = Math.abs(ms)
  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  const label = days > 0 ? `${days} DAYS ${hours} HOURS` : `${Math.max(0, hours)} HOURS`
  return ms >= 0 ? `${prefix} ${label}` : `OVERDUE BY ${label}`
}

export default function ClientVpsListPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [actionId, setActionId] = useState<string | null>(null)

  async function loadRows() {
    try {
      const res = await fetch("/api/client/vps")
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Something could not load. Please retry.")
      if (res.ok) {
        const items = Array.isArray(data.items) ? data.items : [...(data.instances || []), ...(data.pending || [])]
        setRows(items)
        const activeRows = items.filter((row: Row) => ["ACTIVE", "STOPPED", "OVERLOADED"].includes(String(row.status || "").toUpperCase()))
        if (activeRows.length === 1 && items.length === 1) {
          router.replace(`/client-area/vps/${activeRows[0].id}`)
        }
      }
      setError(null)
    } catch (err: any) {
      setError(err?.message || "Something could not load. Please retry.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasTransition = rows.some((row) => ["CREATING", "QUEUED", "CLONING_TEMPLATE", "RESIZING_DISK", "ASSIGNING_IP", "APPLYING_CLOUD_INIT", "STARTING_VM", "VERIFYING_VM", "UPGRADE_QUEUED", "UPDATING_CONFIG", "REINSTALLING"].includes(String(row.currentStep || row.provisioningStatus || row.status || "").toUpperCase()))
  const { lastUpdatedAt } = useSmartPolling(loadRows, hasTransition, [router])

  async function powerAction(row: Row, action: "start" | "stop" | "reboot" | "forceStop") {
    setActionId(`${row.id}:${action}`)
    try {
      const res = await fetch(`/api/client/vps/${row.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await readJsonResponse<any>(res) || {}
      if (!res.ok) throw new Error(customerDatabaseRepairMessage(data))
      toast.success(`Cloud server ${action === "forceStop" ? "force stop" : action} completed`)
      const refreshed = await fetch("/api/client/vps").then((r) => readJsonResponse<any>(r))
      setRows(Array.isArray(refreshed.items) ? refreshed.items : [...(refreshed.instances || []), ...(refreshed.pending || [])])
    } catch (error: any) {
      toast.error(customerDatabaseRepairMessage(error?.message || "Action failed"))
    } finally {
      setActionId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / 10))
  const pageRows = rows.slice((page - 1) * 10, page * 10)

  function renderRowActions(row: Row, opts: { running: boolean; stopped: boolean; consoleDisabled: boolean; consoleTitle: string }) {
    return (
      <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <Button asChild size="sm" variant="outline"><Link href={`/client-area/vps/${row.id}`}>Manage</Link></Button>
        <Button asChild={!opts.consoleDisabled} size="sm" variant="outline" disabled={opts.consoleDisabled} title={opts.consoleTitle}>
          {opts.consoleDisabled ? (
            <span className="inline-flex items-center"><Monitor className="mr-2 h-4 w-4" />Console</span>
          ) : (
            <Link href={`/client-area/vps/${row.id}/console`}><Monitor className="mr-2 h-4 w-4" />Console</Link>
          )}
        </Button>
        {opts.stopped ? <Button size="sm" variant="outline" disabled={actionId === `${row.id}:start`} onClick={() => powerAction(row, "start")}>Start</Button> : null}
        {opts.running ? <Button size="sm" variant="outline" disabled={actionId === `${row.id}:stop`} onClick={() => powerAction(row, "stop")}>Stop</Button> : null}
        {opts.running ? <Button size="sm" variant="outline" disabled={actionId === `${row.id}:reboot`} onClick={() => powerAction(row, "reboot")}>Reboot</Button> : null}
      </div>
    )
  }

  function rowBadge(state: string) {
    return (
      <Badge variant={state === "FAILED" || state === "OVERLOADED" ? "destructive" : state === "ACTIVE" ? "default" : "secondary"}>
        {state === "ACTIVE" || state === "OVERLOADED" ? "Running" : state === "STOPPED" ? "Stopped" : state === "SUSPENDED" ? "Suspended" : "Provisioning"}
      </Badge>
    )
  }

  function rowStateNote(state: string) {
    return state === "ACTIVE" || state === "OVERLOADED" ? "Live and available" : state === "STOPPED" ? "Stopped by action" : state === "SUSPENDED" ? "Account action required" : "Preparing your cloud server"
  }

  function rowBilling(row: Row) {
    const due = (row as any).renewalDueAt || (row as any).nextRenewalAt
    if (!due) return "-"
    return new Date(due).toLocaleString()
  }

  return (
    <Card className="glass border-border/40">
      <CardHeader>
            <CardTitle>Cloud Server Management</CardTitle>
            <CardDescription>Monitor your cloud instances, manage lifecycle actions, and review billing status.</CardDescription>
            <p className="text-xs text-muted-foreground">{formatLastUpdated(lastUpdatedAt)}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : error ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
            <p className="text-lg font-medium">Something could not load. Please retry.</p>
            <Button className="mt-4" variant="outline" onClick={loadRows}>Retry</Button>
          </div>
        ) : !loading && rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
            <p className="text-lg font-medium">No cloud servers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Deploy your first Cloud VPS instance to start managing cloud servers here.</p>
            <Button asChild className="mt-4"><Link href="/client-area/deploy">Deploy Cloud Server</Link></Button>
          </div>
        ) : (
        <>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-3">Cloud Server</th>
                <th className="py-3">IP Address</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Next Billing Date</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const state = String(row.status || "").toUpperCase()
                const running = state === "ACTIVE" || state === "OVERLOADED"
                const stopped = state === "STOPPED"
                const consoleDisabled = row.consoleAvailable === false || ["TERMINATED", "DELETED", "CANCELLED", "EXPIRED"].includes(state)
                const consoleTitle = consoleDisabled ? "Console unavailable for this service state" : "Open console"
                return (
                <tr key={row.id} className="cursor-pointer border-b align-top hover:bg-foreground/[0.03]" onClick={() => router.push(`/client-area/vps/${row.id}`)}>
                  <td className="py-3">
                    <div className="font-medium">{row.hostname || row.orderNumber}</div>
                    <div className="text-xs text-muted-foreground">{row.os || "Operating system provisioning"}</div>
                  </td>
                  <td className="py-3"><CopyableIp ipAddress={row.ipAddress} /></td>
                  <td>
                    <div className="font-medium">{row.plan}</div>
                    <div className="text-xs text-muted-foreground">{row.resources?.cpuCores || "-"} vCPU · {row.resources?.ramGb || "-"} GB RAM</div>
                  </td>
                  <td>
                    {rowBadge(state)}
                    <div className="mt-1 text-xs text-muted-foreground">{rowStateNote(state)}</div>
                  </td>
                  <td className="py-3">
                    <div>{rowBilling(row)}</div>
                    <div className={state === "PENDING_TERMINATION" ? "text-xs font-semibold text-red-500 animate-pulse" : "text-xs text-muted-foreground"}>
                      {state === "PENDING_TERMINATION" ? countdownLabel((row as any).deletionAt, "PERMANENTLY DELETED IN") : countdownLabel((row as any).renewalDueAt || (row as any).nextRenewalAt, "DUE IN")}
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">{renderRowActions(row, { running, stopped, consoleDisabled, consoleTitle })}</div>
                  </td>
                </tr>
              )})}
              {!rows.length ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">{loading ? "Loading..." : "No cloud servers found."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {rows.length > 10 ? (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:hidden">
          {pageRows.map((row) => {
            const state = String(row.status || "").toUpperCase()
            const running = state === "ACTIVE" || state === "OVERLOADED"
            const stopped = state === "STOPPED"
            const consoleDisabled = row.consoleAvailable === false || ["TERMINATED", "DELETED", "CANCELLED", "EXPIRED"].includes(state)
            const consoleTitle = consoleDisabled ? "Console unavailable for this service state" : "Open console"
            return (
              <div key={row.id} className="cursor-pointer rounded-lg border border-border/40 p-3 hover:bg-foreground/[0.03]" onClick={() => router.push(`/client-area/vps/${row.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.hostname || row.orderNumber}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.os || "Operating system provisioning"}</div>
                  </div>
                  {rowBadge(state)}
                </div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">IP address</span>
                    <CopyableIp ipAddress={row.ipAddress} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Plan</span>
                    <span className="truncate text-right font-medium">{row.plan}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Resources</span>
                    <span className="text-right">{row.resources?.cpuCores || "-"} vCPU · {row.resources?.ramGb || "-"} GB RAM</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Next billing</span>
                    <span className="text-right">{rowBilling(row)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-muted-foreground">Renewal</span>
                    <span className={state === "PENDING_TERMINATION" ? "font-semibold text-red-500 animate-pulse" : ""}>
                      {state === "PENDING_TERMINATION" ? countdownLabel((row as any).deletionAt, "PERMANENTLY DELETED IN") : countdownLabel((row as any).renewalDueAt || (row as any).nextRenewalAt, "DUE IN")}
                    </span>
                  </div>
                </div>
                <div className="mt-3">{renderRowActions(row, { running, stopped, consoleDisabled, consoleTitle })}</div>
              </div>
            )
          })}
          {!pageRows.length ? <div className="py-6 text-center text-sm text-muted-foreground">No cloud servers found.</div> : null}
          {rows.length > 10 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</Button>
              </div>
            </div>
          ) : null}
        </div>
        </>
        )}
      </CardContent>
    </Card>
  )
}
