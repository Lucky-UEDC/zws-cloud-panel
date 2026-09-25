"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { CalendarPlus, Link2, MoreHorizontal, Network, Play, Power, ReceiptText, RefreshCw, RotateCw, Search, Settings2, ShieldAlert, Square, Terminal, Trash2 } from "lucide-react"
import { readJsonResponse } from "@/lib/client/safe-json"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { useAdminVmQuery } from "@/lib/hooks/use-admin-vm-query"
import { formatLastUpdated } from "@/lib/hooks/use-smart-polling"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

type VmRow = {
  id: string
  name: string
  vmid: number
  status: string
  ipAddress: string | null
  os?: string | null
  cpuCores?: number | null
  ramGb?: number | null
  diskGb?: number | null
  customer: { id: string; email: string; name: string | null } | null
  order: { id: string; orderNumber: string; status: string }
  nodeName: string | null
  health?: { vm?: string; payment?: string; provisioning?: string; network?: string; orderHealth?: string }
  provisioning?: { displayStatus?: string | null; error?: string | null }
  network?: { primaryAssignedIp?: string | null; issues?: string[] }
  live?: any
}

type VmListPayload = {
  success: boolean
  rows: VmRow[]
  pagination: { page: number; pageSize: number; total: number; pages: number }
}

type OsTemplate = {
  id: string
  name: string
  category?: string | null
  distro?: string | null
  family?: string | null
  osFamily?: string | null
  osType?: string | null
  osVersion?: string | null
  version?: string | null
  defaultUsername?: string | null
  supportsSSH?: boolean
  proxmoxNode?: { name?: string | null; nodeName?: string | null } | null
}

function statusVariant(status: string) {
  const value = String(status || "").toLowerCase()
  if (["running", "active", "healthy"].includes(value)) return "default"
  if (["failed", "critical", "mismatch", "error"].includes(value)) return "destructive"
  return "secondary"
}

function templateOsKind(template?: OsTemplate | null) {
  const value = [
    template?.osType,
    template?.category,
    template?.distro,
    template?.family,
    template?.osFamily,
    template?.name,
  ].filter(Boolean).join(" ").toLowerCase()
  return value.includes("windows") || /\bwin(?:dows)?\b/.test(value) ? "windows" : "linux"
}

function templateDefaultUsername(template?: OsTemplate | null) {
  if (!template) return "root"
  const fromTemplate = String(template.defaultUsername || "").trim()
  if (fromTemplate) return fromTemplate
  return templateOsKind(template) === "windows" ? "Administrator" : "root"
}

function normalizeVmRow(input: Partial<VmRow> | null | undefined): VmRow {
  const vmid = Number(input?.vmid || 0)
  return {
    id: String(input?.id || ""),
    name: String(input?.name || (vmid ? `VM ${vmid}` : "Unnamed VM")),
    vmid,
    status: String(input?.status || "unknown"),
    ipAddress: input?.ipAddress || input?.network?.primaryAssignedIp || null,
    os: input?.os || null,
    cpuCores: input?.cpuCores ?? null,
    ramGb: input?.ramGb ?? null,
    diskGb: input?.diskGb ?? null,
    customer: input?.customer || null,
    order: {
      id: String(input?.order?.id || ""),
      orderNumber: String(input?.order?.orderNumber || "Unlinked order"),
      status: String(input?.order?.status || "unknown"),
    },
    nodeName: input?.nodeName || null,
    health: input?.health || {},
    provisioning: input?.provisioning || {},
    network: input?.network || {},
    live: input?.live || null,
  }
}

function mergeLiveRow(row: VmRow, snapshot: any): VmRow {
  if (!snapshot || snapshot.vpsInstanceId !== row.id) return row
  return {
    ...row,
    status: String(snapshot.status || row.status),
    ipAddress: snapshot.ipAddress || row.ipAddress,
    nodeName: snapshot.node || row.nodeName,
    health: { ...(row.health || {}), vm: snapshot.powerState || snapshot.status || row.health?.vm, network: snapshot.networkStatus || row.health?.network },
    live: snapshot,
  }
}

function fmt(value: unknown) {
  if (!value) return "-"
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
}

export default function AdminVmsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<VmRow | null>(null)
  const [details, setDetails] = useState<any>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  const endpoint = useMemo(() => {
    const params = new URLSearchParams()
    params.set("page", String(page))
    params.set("pageSize", "50")
    if (includeDeleted) params.set("includeDeleted", "true")
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (search.trim()) params.set("search", search.trim())
    return `/api/admin/vms?${params.toString()}`
  }, [page, includeDeleted, statusFilter, search])

  const { data, loading, error, reload, lastUpdatedAt } = useAdminVmQuery<VmListPayload>({
    endpoint,
    pollActive: false,
    deps: [endpoint],
    fallbackErrorMessage: "Unable to refresh VM state.",
  })
  const [streamData, setStreamData] = useState<VmListPayload | null>(null)

  const effectiveData = streamData || data
  const rows = useMemo(() => (effectiveData?.rows || []).map(normalizeVmRow).filter((row) => row.id), [effectiveData?.rows])
  const pagination: VmListPayload["pagination"] = effectiveData?.pagination || { page: 1, pageSize: 50, total: 0, pages: 1 }

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const source = new EventSource(`/api/admin/vms/live/stream?${endpoint.split("?")[1] || ""}`)
    source.addEventListener("initial", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data)
        if (payload?.rows) setStreamData(payload)
      } catch {
        // Ignore malformed stream messages; the regular fetch fallback remains available.
      }
    })
    source.addEventListener("vm-live", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data)
        const snapshot = payload?.snapshot
        if (!snapshot?.vpsInstanceId) return
        setStreamData((current) => {
          const base = current || data
          if (!base?.rows) return current
          return {
            ...base,
            rows: base.rows.map((row) => row.id === snapshot.vpsInstanceId ? mergeLiveRow(normalizeVmRow(row), snapshot) : row),
          }
        })
        setSelected((current) => current && current.id === snapshot.vpsInstanceId ? mergeLiveRow(current, snapshot) : current)
        setDetails((current: any) => current && snapshot.vpsInstanceId === current?.vps?.id ? { ...current, live: snapshot } : current)
      } catch {
        // Ignore malformed stream messages.
      }
    })
    source.onerror = () => {
      dedupedAdminErrorToast({ message: "Live VM stream disconnected. Manual refresh remains available.", key: "vm-live-stream" })
    }
    return () => source.close()
  }, [endpoint, data])

  useEffect(() => {
    const id = searchParams.get("vm")
    if (!id) {
      if (selected) setSelected(null)
      return
    }
    if (selected?.id === id) return
    const row = rows.find((item) => item.id === id)
    if (row) setSelected(row)
  }, [rows, searchParams, selected, selected?.id])

  useEffect(() => {
    if (!error) return
    dedupedAdminErrorToast({ message: error, key: "vm-list" })
  }, [error])

  useEffect(() => {
    if (!selected?.id) {
      setDetails(null)
      return
    }
    setDetailsLoading(true)
    fetch(`/api/admin/vms/${selected.id}`, { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((body) => setDetails(body))
      .catch((loadError) => setDetails({ success: false, warnings: [loadError?.message || "Unable to load VM details"] }))
      .finally(() => setDetailsLoading(false))
  }, [selected?.id])

  async function callAction(row: VmRow, action: string) {
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Action failed")
      if (body.live?.vpsInstanceId) {
        setStreamData((current) => {
          const base = current || data
          if (!base?.rows) return current
          return { ...base, rows: base.rows.map((item) => item.id === body.live.vpsInstanceId ? mergeLiveRow(normalizeVmRow(item), body.live) : item) }
        })
        setSelected((current) => current && current.id === body.live.vpsInstanceId ? mergeLiveRow(current, body.live) : current)
        setDetails((current: any) => current && body.live.vpsInstanceId === current?.vps?.id ? { ...current, live: body.live } : current)
      }
      await reload()
    } catch (actionError: any) {
      dedupedAdminErrorToast({ message: actionError?.message || "VM action failed", key: `vm-action:${action}:${row.id}` })
    } finally {
      setBusyId(null)
    }
  }

  function openVm(row: VmRow) {
    setSelected(row)
    router.push(`/admin/vms?vm=${encodeURIComponent(row.id)}`, { scroll: false })
  }

  function closeVm() {
    setSelected(null)
    setDetails(null)
    if (searchParams.get("vm")) router.replace("/admin/vms", { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Virtual Machines</h1>
          <p className="text-xs text-muted-foreground">{formatLastUpdated(lastUpdatedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild type="button" variant="outline"><Link href="/admin/vms/duplicates"><ShieldAlert className="mr-2 h-4 w-4" />Duplicate review</Link></Button>
          <Button type="button" variant="outline" onClick={() => void reload()} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1) }}>
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="active">Active</option>
            </select>
            <Input className="h-9 w-72" placeholder="Search order, customer, VM, IP" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
            <Button variant="outline" size="sm" onClick={() => { setIncludeDeleted((value) => !value); setPage(1) }}>
              {includeDeleted ? "Hide deleted" : "Show deleted"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Status</th>
                  <th>Hostname</th>
                  <th>Customer</th>
                  <th>Node</th>
                  <th>IP</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Disk</th>
                  <th>OS</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, idx) => (
                    <tr key={idx} className="border-b border-border/20">
                      {Array.from({ length: 10 }).map((__, cell) => <td key={cell} className="py-3 pr-3"><Skeleton className="h-4 w-24" /></td>)}
                    </tr>
                  ))
                ) : rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/20">
                      <td className="py-3 pr-3"><Badge variant={statusVariant(row.live?.powerState || row.health?.vm || row.status) as any}>{row.live?.powerState || row.health?.vm || row.status}</Badge></td>
                      <td>
                        <button type="button" className="text-left font-medium hover:underline" onClick={() => openVm(row)}>{row.name}</button>
                        <p className="text-xs text-muted-foreground">VMID {row.vmid}</p>
                      </td>
                      <td>
                        <p>{row.customer?.name || "Customer"}</p>
                        <p className="text-xs text-muted-foreground">{row.customer?.email || row.order.orderNumber}</p>
                      </td>
                      <td>{row.nodeName || "-"}</td>
                      <td className="font-mono text-xs">{row.ipAddress || "-"}</td>
                      <td>{row.live?.cpuPercent != null ? `${Number(row.live.cpuPercent).toFixed(1)}%` : row.cpuCores || "-"}</td>
                      <td>{row.live?.ramPercent != null ? `${Number(row.live.ramPercent).toFixed(1)}%` : row.ramGb ? `${row.ramGb} GB` : "-"}</td>
                      <td>{row.live?.diskPercent != null ? `${Number(row.live.diskPercent).toFixed(1)}%` : row.diskGb ? `${row.diskGb} GB` : "-"}</td>
                      <td className="max-w-[180px] truncate">{row.os || "-"}</td>
                      <td className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" disabled={busyId === row.id} aria-label="VM actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => openVm(row)}><Settings2 className="mr-2 h-4 w-4" />Manage</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void callAction(row, "start")}><Power className="mr-2 h-4 w-4" />Power Start</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void callAction(row, "reboot")}><RefreshCw className="mr-2 h-4 w-4" />Power Restart</DropdownMenuItem>
                            <DropdownMenuItem asChild><Link href={`/admin/vms/${row.id}/console`}><Terminal className="mr-2 h-4 w-4" />Console</Link></DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openVm(row)}><ReceiptText className="mr-2 h-4 w-4" />Billing</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => void callAction(row, "delete")}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={10} className="py-12 text-center text-muted-foreground">No virtual machines found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">Page {pagination.page} of {pagination.pages} · {pagination.total.toLocaleString()} total rows</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={pagination.page >= pagination.pages} onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) closeVm() }}>
        <SheetContent className="w-[min(980px,96vw)] sm:max-w-none">
          <SheetHeader>
            <SheetTitle>{selected?.name || "VM Details"}</SheetTitle>
            <SheetDescription>{selected ? `${selected.order.orderNumber} · ${selected.ipAddress || "no IP"} · VMID ${selected.vmid}` : "VM detail drawer"}</SheetDescription>
          </SheetHeader>
          <VmDrawerContent loading={detailsLoading} details={details} row={selected} onChanged={() => void reload()} callAction={callAction} busyId={busyId} />
        </SheetContent>
      </Sheet>
    </div>
  )
}

function VmDrawerContent({
  loading,
  details,
  row,
  onChanged,
  callAction,
  busyId,
}: {
  loading: boolean
  details: any
  row: VmRow | null
  onChanged: () => void
  callAction: (row: VmRow, action: string) => Promise<void>
  busyId: string | null
}) {
  const overview = details?.overview || {}
  const [actionDialog, setActionDialog] = useState<null | "change-ip" | "reinstall" | "billing" | "delete" | "reassign">(null)
  if (!row) return null
  const live = row.live || details?.live || details?.snapshot || null
  const currentStatus = live?.powerState || overview.powerState || row.health?.vm || row.status
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
      <div data-testid="vm-drawer-action-bar" className="sticky top-0 z-10 mb-4 space-y-3 border-b border-border/40 bg-background/95 py-3 backdrop-blur">
        <div className="grid gap-2 text-xs sm:grid-cols-4">
          <Fact label="Status" value={currentStatus} />
          <Fact label="Node" value={live?.node || overview.node || row.nodeName || "-"} />
          <Fact label="IP" value={live?.ipAddress || overview.ipv4 || row.ipAddress || "-"} mono />
          <Fact label="VMID" value={row.vmid || "-"} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="gap-2"><Link href={`/admin/vms/${row.id}/console`}><Terminal className="h-4 w-4" />Console</Link></Button>
          <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void callAction(row, "start")} className="gap-2"><Play className="h-4 w-4" />Start</Button>
          <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void callAction(row, "stop")} className="gap-2"><Square className="h-4 w-4" />Stop</Button>
          <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => void callAction(row, "reboot")} className="gap-2"><RotateCw className="h-4 w-4" />Restart</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("change-ip")} className="gap-2"><Network className="h-4 w-4" />Change IP</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("reinstall")} className="gap-2"><RefreshCw className="h-4 w-4" />Reinstall</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("reassign")} className="gap-2"><Link2 className="h-4 w-4" />Reassign VM</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("billing")} className="gap-2"><CalendarPlus className="h-4 w-4" />Extend Service</Button>
          <Button size="sm" variant="outline" onClick={() => setActionDialog("billing")} className="gap-2"><ReceiptText className="h-4 w-4" />Billing</Button>
          <Button size="sm" variant="destructive" onClick={() => setActionDialog("delete")} className="gap-2"><Trash2 className="h-4 w-4" />Delete</Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : (
      <Tabs defaultValue="overview" className="min-h-0 overflow-hidden">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="network">Network</TabsTrigger>
        <TabsTrigger value="console">Console</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>
      <div className="mt-4 min-h-0 overflow-y-auto">
        <TabsContent value="overview"><InfoGrid rows={[
          ["Status", live?.status || overview.status || row.status],
          ["Power", live?.powerState || overview.powerState || row.health?.vm || "-"],
          ["Node", live?.node || overview.node || row.nodeName || "-"],
          ["OS", overview.os || row.os || "-"],
          ["CPU", live?.cpuPercent != null ? `${Number(live.cpuPercent).toFixed(1)}%` : overview.cpu || row.cpuCores || "-"],
          ["RAM", live?.ramPercent != null ? `${Number(live.ramPercent).toFixed(1)}%` : overview.ramGb ? `${overview.ramGb} GB` : row.ramGb ? `${row.ramGb} GB` : "-"],
          ["Disk", live?.diskPercent != null ? `${Number(live.diskPercent).toFixed(1)}%` : overview.diskGb ? `${overview.diskGb} GB` : row.diskGb ? `${row.diskGb} GB` : "-"],
          ["Renewal", fmt(overview.renewalDueAt || overview.renewalDate)],
        ]} /></TabsContent>
        <TabsContent value="network"><InfoGrid rows={[
          ["IPv4", live?.ipAddress || overview.ipv4 || row.ipAddress || "-"],
          ["IPv6", overview.ipv6 || "-"],
          ["Bandwidth", overview.bandwidth ? `${overview.bandwidth} TB` : "-"],
          ["Network Health", live?.networkStatus || details?.diagnostics?.runtimeHealth?.networkStatus || row.health?.network || "-"],
          ["Agent", live?.agentStatus || "-"],
        ]} /></TabsContent>
        <TabsContent value="console" className="space-y-3">
          <p className="text-sm text-muted-foreground">Open the live console in a dedicated secure view.</p>
          <Button asChild><Link href={`/admin/vms/${row.id}/console`}><Terminal className="mr-2 h-4 w-4" />Open Console</Link></Button>
        </TabsContent>
        <TabsContent value="billing"><InfoGrid rows={[
          ["Order", row.order.orderNumber],
          ["Order Status", row.order.status],
          ["Renewal Due", fmt(overview.renewalDueAt)],
          ["Suspend At", fmt(overview.suspendAt)],
          ["Delete At", fmt(overview.deletionAt)],
        ]} /></TabsContent>
        <TabsContent value="logs" className="space-y-3">
          {(details?.logs || []).slice(0, 80).map((log: any) => (
            <div key={log.id || `${log.createdAt}-${log.message}`} className="rounded-md border border-border/40 p-3">
              <p className="text-sm">{log.message || log.event || log.status || "Log entry"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{fmt(log.createdAt)} · {log.level || log.status || "-"}</p>
            </div>
          ))}
          {!(details?.logs || []).length ? <p className="text-sm text-muted-foreground">No provisioning logs available.</p> : null}
        </TabsContent>
        <TabsContent value="advanced"><InfoGrid rows={[
          ["Lifecycle State", details?.stateMachine?.lifecycleState || "-"],
          ["Automation State", details?.stateMachine?.automationState || "-"],
          ["Latest UPID", overview.latestUpid || "-"],
          ["Latest Step", overview.latestStep || "-"],
          ["Config Available", details?.diagnostics?.proxmoxConfigAvailable ? "Yes" : "No"],
          ["Runtime Available", details?.diagnostics?.proxmoxStatusAvailable ? "Yes" : "No"],
        ]} /></TabsContent>
      </div>
    </Tabs>
      )}

      <Dialog open={actionDialog === "change-ip"} onOpenChange={(open) => setActionDialog(open ? "change-ip" : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Change Primary IP</DialogTitle>
            <DialogDescription>Select an available address, validate the plan, then apply the change.</DialogDescription>
          </DialogHeader>
          <ChangeIpPanel row={row} onChanged={onChanged} />
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === "reinstall"} onOpenChange={(open) => setActionDialog(open ? "reinstall" : null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl grid-rows-[auto,minmax(0,1fr)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Reinstall VM</DialogTitle>
            <DialogDescription>Queue an operating system reinstall for this VM.</DialogDescription>
          </DialogHeader>
          <ReinstallPanel row={row} details={details} overview={overview} onChanged={onChanged} />
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === "billing"} onOpenChange={(open) => setActionDialog(open ? "billing" : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Billing And Extension</DialogTitle>
            <DialogDescription>Extend service dates or open billing context without leaving the drawer.</DialogDescription>
          </DialogHeader>
          <BillingPanel row={row} overview={overview} onChanged={onChanged} />
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === "reassign"} onOpenChange={(open) => setActionDialog(open ? "reassign" : null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Reassign VM</DialogTitle>
            <DialogDescription>Update this service to a different infrastructure node and VMID.</DialogDescription>
          </DialogHeader>
          <ReassignPanel row={row} onChanged={() => { onChanged(); setActionDialog(null) }} />
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === "delete"} onOpenChange={(open) => setActionDialog(open ? "delete" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete VM</DialogTitle>
            <DialogDescription>This queues the existing full VM delete workflow.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Confirm deletion for {row.name} / VMID {row.vmid}.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
              <Button variant="destructive" disabled={busyId === row.id} onClick={() => { setActionDialog(null); void callAction(row, "delete") }}>Delete</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ReassignPanel({ row, onChanged }: { row: VmRow; onChanged: () => void }) {
  const [nodes, setNodes] = useState<Array<{ id: string; name: string; nodeName: string }>>([])
  const [nodeId, setNodeId] = useState("")
  const [vmid, setVmid] = useState("")
  const [reason, setReason] = useState("admin_vm_reassign")
  const [busy, setBusy] = useState<"manual" | "find" | "apply" | null>(null)
  const [autoResult, setAutoResult] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/proxmox-nodes", { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((body) => {
        if (cancelled) return
        const raw = Array.isArray(body) ? body : Array.isArray(body?.nodes) ? body.nodes : []
        const next = raw.map((node: any) => ({ id: String(node.id || ""), name: String(node.name || node.nodeName || "Node"), nodeName: String(node.nodeName || node.name || "") })).filter((node: any) => node.id)
        setNodes(next)
        if (!nodeId && next.length) setNodeId(next[0].id)
      })
      .catch((error) => dedupedAdminErrorToast({ message: error?.message || "Unable to load nodes.", key: `reassign-nodes:${row.id}` }))
    return () => {
      cancelled = true
    }
  }, [row.id, nodeId])

  async function manualSave() {
    if (!nodeId || !vmid) return dedupedAdminErrorToast({ message: "Choose a node and VMID.", key: `reassign-required:${row.id}` })
    setBusy("manual")
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, vmid: Number(vmid), reason }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Reassignment failed")
      onChanged()
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "Reassignment failed.", key: `reassign:${row.id}` })
    } finally {
      setBusy(null)
    }
  }

  async function autoFind(apply: boolean) {
    if (!nodeId) return dedupedAdminErrorToast({ message: "Choose a node first.", key: `auto-find-node:${row.id}` })
    setBusy(apply ? "apply" : "find")
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/reassign/auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, apply }),
      })
      const body = await readJsonResponse<any>(res)
      setAutoResult(body?.result || body)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Auto discovery failed")
      if (apply && body.result?.reassigned) onChanged()
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "Auto discovery failed.", key: `auto-find:${row.id}` })
    } finally {
      setBusy(null)
    }
  }

  const match = autoResult?.match
  return (
    <div className="space-y-4">
      <InfoGrid rows={[
        ["Current Node", row.nodeName || "-"],
        ["Current VMID", row.vmid || "-"],
        ["Order", row.order.orderNumber],
        ["Customer", row.customer?.email || "-"],
      ]} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">New Node</span>
          <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
            <option value="">Select node</option>
            {nodes.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.nodeName})</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">New VMID</span>
          <Input inputMode="numeric" value={vmid} onChange={(event) => setVmid(event.target.value)} />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Reason</span>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void autoFind(false)} className="gap-2">
          {busy === "find" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Auto Find VM
        </Button>
        <Button type="button" variant="outline" disabled={busy !== null || !match} onClick={() => void autoFind(true)} className="gap-2">
          {busy === "apply" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Apply Found VM
        </Button>
        <Button type="button" disabled={busy !== null} onClick={() => void manualSave()}>
          {busy === "manual" ? "Saving..." : "Save Manual Mapping"}
        </Button>
      </div>
      {autoResult ? (
        <div className="rounded-md border border-border/40 p-3 text-sm">
          <p className="font-medium">{match ? `Found VMID ${match.vmid} by ${match.method}` : autoResult.reason || "No match found"}</p>
          <pre className="mt-3 max-h-56 overflow-auto rounded bg-muted/30 p-2 text-xs">{JSON.stringify(autoResult, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  )
}

function Fact({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/40 px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className={mono ? "mt-1 truncate font-mono font-medium" : "mt-1 truncate font-medium"}>{String(value ?? "-")}</p>
    </div>
  )
}

function ReinstallPanel({ row, details, overview, onChanged }: { row: VmRow; details: any; overview: any; onChanged: () => void }) {
  const [templates, setTemplates] = useState<OsTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<{ template?: string; password?: string; ssh?: string; confirm?: string }>({})
  const [reinstall, setReinstall] = useState({
    templateId: "",
    hostname: row.name,
    loginMethod: "password",
    password: "",
    sshPublicKey: "",
    sshKeyId: "",
    preserveIp: true,
    confirmReinstall: false,
    reason: "",
  })

  const nodeId = String(details?.vps?.proxmoxNodeId || overview.proxmoxNodeId || "")
  const selectedTemplate = templates.find((template) => template.id === reinstall.templateId) || null
  const selectedReinstallOsKind = templateOsKind(selectedTemplate)
  const isWindows = selectedReinstallOsKind !== "linux"

  useEffect(() => {
    setReinstall((current) => ({
      ...current,
      templateId: String(details?.vps?.operatingSystemId || overview.operatingSystemId || current.templateId || ""),
      hostname: String(overview.hostname || row.name || current.hostname || ""),
    }))
  }, [details?.vps?.operatingSystemId, overview.operatingSystemId, overview.hostname, row.name])

  useEffect(() => {
    let cancelled = false
    setTemplatesLoading(true)
    const url = `/api/admin/os-templates?purpose=reinstall&nodeId=${encodeURIComponent(nodeId)}`
    fetch(url, { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((data) => {
        if (cancelled) return
        setTemplates(Array.isArray(data?.items) ? data.items : [])
      })
      .catch((error) => {
        if (!cancelled) dedupedAdminErrorToast({ message: error?.message || "Unable to load reinstall templates.", key: `reinstall-templates:${row.id}` })
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [nodeId, row.id])

  useEffect(() => {
    if (!isWindows) return
    setReinstall((current) => ({ ...current, loginMethod: "password", sshKeyId: "", sshPublicKey: "" }))
  }, [isWindows])

  async function submitReinstall() {
    const nextErrors: typeof errors = {}
    if (!reinstall.templateId) nextErrors.template = "Select a reinstall template."
    if (selectedReinstallOsKind === "windows" && !reinstall.password.trim()) nextErrors.password = "Windows reinstall requires a password."
    if (selectedReinstallOsKind === "linux" && !reinstall.password.trim() && !reinstall.sshPublicKey.trim() && !reinstall.sshKeyId.trim()) {
      nextErrors.ssh = "Linux reinstall requires a password or SSH key."
    }
    if (!reinstall.confirmReinstall) nextErrors.confirm = "Confirm the reinstall before queuing."
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    setBusy(true)
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reinstall",
          templateId: reinstall.templateId,
          hostname: reinstall.hostname || row.name,
          loginMethod: isWindows ? "password" : reinstall.loginMethod,
          password: reinstall.password,
          sshKeyId: isWindows ? "" : reinstall.sshKeyId,
          sshPublicKey: isWindows ? "" : reinstall.sshPublicKey,
          preserveIp: reinstall.preserveIp,
          reason: reinstall.reason || "admin_reinstall_drawer",
        }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Unable to queue reinstall.")
      onChanged()
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "Unable to queue reinstall.", key: `reinstall:${row.id}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      <InfoGrid rows={[
        ["Current OS", overview.os || row.os || "-"],
        ["Template VMID", overview.templateUsed || "-"],
        ["Provisioning", overview.provisioningStatus || row.provisioning?.displayStatus || "-"],
        ["Latest Error", overview.latestError || "-"],
      ]} />

      <div className="rounded-md border border-border/40 p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Template</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={reinstall.templateId}
              onChange={(event) => setReinstall((current) => ({ ...current, templateId: event.target.value }))}
            >
              <option value="">{templatesLoading ? "Loading templates..." : "Select template"}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            {errors.template ? <span className="text-xs text-destructive">{errors.template}</span> : null}
            {!templatesLoading && !templates.length ? <span className="text-xs text-muted-foreground">No reinstall templates available</span> : null}
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Hostname</span>
            <Input value={reinstall.hostname} onChange={(event) => setReinstall((current) => ({ ...current, hostname: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Username</span>
            <Input value={templateDefaultUsername(selectedTemplate)} readOnly />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Login Method</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={isWindows ? "password" : reinstall.loginMethod}
              disabled={isWindows}
              onChange={(event) => setReinstall((current) => ({ ...current, loginMethod: event.target.value }))}
            >
              <option value="password">Password only</option>
              <option value="ssh">SSH key only</option>
              <option value="password_ssh">Password + SSH key</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Password</span>
            <Input type="password" value={reinstall.password} onChange={(event) => setReinstall((current) => ({ ...current, password: event.target.value }))} />
            {errors.password ? <span className="text-xs text-destructive">{errors.password}</span> : null}
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">SSH Key ID</span>
            <Input disabled={isWindows} value={reinstall.sshKeyId} onChange={(event) => setReinstall((current) => ({ ...current, sshKeyId: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium">SSH Public Key (optional)</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              disabled={isWindows}
              value={reinstall.sshPublicKey}
              onChange={(event) => setReinstall((current) => ({ ...current, sshPublicKey: event.target.value }))}
            />
            {errors.ssh ? <span className="text-xs text-destructive">{errors.ssh}</span> : null}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reinstall.preserveIp} onChange={(event) => setReinstall((current) => ({ ...current, preserveIp: event.target.checked }))} />
            Preserve assigned IP
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={reinstall.confirmReinstall} onChange={(event) => setReinstall((current) => ({ ...current, confirmReinstall: event.target.checked }))} />
            Confirm reinstall and disk overwrite
          </label>
          {errors.confirm ? <span className="text-xs text-destructive md:col-span-2">{errors.confirm}</span> : null}
          <label className="space-y-1 text-sm">
            <span className="font-medium">Reason</span>
            <Input value={reinstall.reason} onChange={(event) => setReinstall((current) => ({ ...current, reason: event.target.value }))} />
          </label>
        </div>
        <div className="sticky bottom-0 -mx-4 mt-4 flex justify-end border-t border-border/40 bg-background/95 px-4 py-3 backdrop-blur">
          <Button type="button" disabled={busy || templatesLoading} onClick={() => void submitReinstall()}>
            {busy ? "Queuing..." : "Queue Reinstall"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ChangeIpPanel({ row, onChanged }: { row: VmRow; onChanged: () => void }) {
  const [loading, setLoading] = useState(true)
  const [options, setOptions] = useState<Array<{ poolId: string; poolName: string; ipAddress: string; nodeName?: string | null }>>([])
  const [selected, setSelected] = useState("")
  const [preserveOldIp, setPreserveOldIp] = useState(false)
  const [confirmRisky, setConfirmRisky] = useState(false)
  const [reason, setReason] = useState("admin_change_ip_drawer")
  const [busy, setBusy] = useState<"validate" | "apply" | null>(null)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/admin/ip-pools", { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((data) => {
        if (cancelled) return
        const next: Array<{ poolId: string; poolName: string; ipAddress: string; nodeName?: string | null }> = []
        for (const pool of data?.pools || []) {
          for (const ip of pool.availableIps || []) {
            next.push({
              poolId: String(ip.poolId || pool.id),
              poolName: String(ip.poolName || pool.name || "Pool"),
              ipAddress: String(ip.ipAddress || ""),
              nodeName: ip.node?.nodeName || ip.node?.name || pool.proxmoxNode?.nodeName || pool.proxmoxNode?.name || null,
            })
          }
        }
        setOptions(next.filter((item) => item.ipAddress && item.ipAddress !== row.ipAddress))
      })
      .catch((error) => dedupedAdminErrorToast({ message: error?.message || "Unable to load available IPs.", key: `change-ip-options:${row.id}` }))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row.id, row.ipAddress])

  const [poolId, ipAddress] = selected.split("|")

  async function submit(dryRun: boolean) {
    if (!poolId || !ipAddress) {
      dedupedAdminErrorToast({ message: "Select an available IP first.", key: `change-ip-select:${row.id}` })
      return
    }
    setBusy(dryRun ? "validate" : "apply")
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/network/change-primary-ip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poolId,
          selectedTargetIp: ipAddress,
          preserveOldIp,
          reason,
          dryRun,
          confirmRisky,
        }),
      })
      const body = await readJsonResponse<any>(res)
      setResult(body)
      if (!res.ok || !body?.success) {
        if (body?.result?.requiresConfirmation) {
          setConfirmRisky(true)
          return
        }
        throw new Error(body?.error || "IP change failed")
      }
      if (!dryRun) onChanged()
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "IP change failed.", key: `change-ip:${row.id}` })
    } finally {
      setBusy(null)
    }
  }

  const preflight = result?.result?.preflight || result?.preflight || []
  const plan = result?.result?.plan || result?.plan || null
  const hasBlockingIssues = preflight.some((item: any) => item.blocking === true)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Available IP</span>
          <select
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={loading}
          >
            <option value="">{loading ? "Loading available IPs..." : "Select Available IP"}</option>
            {options.map((option) => (
              <option key={`${option.poolId}:${option.ipAddress}`} value={`${option.poolId}|${option.ipAddress}`}>
                {option.ipAddress} · {option.poolName}{option.nodeName ? ` · ${option.nodeName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Reason</span>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={preserveOldIp} onChange={(event) => setPreserveOldIp(event.target.checked)} />
          Preserve old IP as secondary
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmRisky} onChange={(event) => setConfirmRisky(event.target.checked)} />
          Confirm bridge/routing risk
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy !== null || loading} onClick={() => void submit(true)}>
          {busy === "validate" ? "Validating..." : "Validate"}
        </Button>
        <Button type="button" disabled={busy !== null || loading || hasBlockingIssues} title={hasBlockingIssues ? "Fix blocking validation issues before applying" : undefined} onClick={() => void submit(false)}>
          {busy === "apply" ? "Applying..." : "Apply Change IP"}
        </Button>
      </div>
      {plan || preflight.length || result ? (
        <div className="rounded-md border border-border/40 p-3 text-sm">
          <p className="font-medium">Validation Result</p>
          {plan?.riskClass ? <p className="mt-1 text-muted-foreground">Risk: {plan.riskClass}</p> : null}
          {preflight.length ? (
            <div className="mt-2 space-y-1">
              {preflight.map((item: any, index: number) => (
                <p key={index} className={item.blocking ? "text-destructive" : "text-muted-foreground"}>
                  {item.blocking ? "Blocking: " : ""}{item.message || item.code || JSON.stringify(item)}
                </p>
              ))}
            </div>
          ) : null}
          <pre className="mt-3 max-h-56 overflow-auto rounded bg-muted/30 p-2 text-xs">{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  )
}

function BillingPanel({ row, overview, onChanged }: { row: VmRow; overview: any; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [reason, setReason] = useState("admin_extend_service_drawer")

  async function submit(action: string) {
    setBusy(action)
    try {
      const res = await fetch(`/api/admin/vms/${row.id}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Billing update failed")
      onChanged()
    } catch (error: any) {
      dedupedAdminErrorToast({ message: error?.message || "Billing update failed.", key: `billing:${row.id}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <InfoGrid rows={[
        ["Order", row.order.orderNumber],
        ["Order Status", row.order.status],
        ["Renewal Due", fmt(overview.renewalDueAt)],
        ["Suspend At", fmt(overview.suspendAt)],
        ["Delete At", fmt(overview.deletionAt)],
      ]} />
      <label className="space-y-1 text-sm">
        <span className="font-medium">Reason</span>
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void submit("extend_7d")}>{busy === "extend_7d" ? "Extending..." : "Extend 7 Days"}</Button>
        <Button disabled={busy !== null} onClick={() => void submit("extend_30d")}>{busy === "extend_30d" ? "Extending..." : "Extend 30 Days"}</Button>
      </div>
    </div>
  )
}

function InfoGrid({ rows }: { rows: Array<[string, unknown]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border/40 p-3">
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 break-words text-sm font-medium">{String(value ?? "-")}</p>
        </div>
      ))}
    </div>
  )
}
