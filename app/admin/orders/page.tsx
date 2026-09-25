"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import {
  clearHiddenSelection,
  removeSelectedIds,
  setVisibleSelection,
  summarizeVisibleSelection,
  toggleSelectedId,
} from "@/lib/admin-order-selection"
import { useAdminVmQuery } from "@/lib/hooks/use-admin-vm-query"
import { formatLastUpdated } from "@/lib/hooks/use-smart-polling"
import { AdminDiagnosticsDrawer } from "@/components/admin/admin-diagnostics-drawer"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MoreHorizontal } from "lucide-react"

type OrderRow = {
  order: {
    id: string
    orderNumber: string
    status: string
    orderType: string | null
    provisioningStatus: string | null
    provisioningError: string | null
    createdAt: string
    deletedAt: string | null
    payableAmount: number
    totalAmount: number
    billingTerm: number | null
    nodeId?: string | null
    nodeName?: string | null
    operatingSystem?: { id: string; name: string; osFamily?: string | null; osVersion?: string | null; osType?: string | null; category?: string | null } | null
  }
  customer: { id: string; email: string; name: string | null } | null
  invoice: { id: string; invoiceNumber: string; status: string; totalAmount: number } | null
  payment: {
    id: string
    status: string
    gateway: string
    amount: number
    createdAt: string
    gatewayOrderId: string | null
    gatewayPaymentId: string | null
    transactionId?: string | null
    verified?: boolean
    verifiedAt?: string | null
  } | null
  vm: {
    id: string
    name: string
    vmid: number
    status: string
    ipAddress: string | null
    nodeName: string | null
    nextRenewalAt: string | null
    renewalAmount: number | null
  } | null
  vmCount?: number
  bulk?: {
    bulkGroupId: string | null
    bulkIndex: number | null
    bulkQuantity: number | null
    groupHostnames: string[]
    provisioningProgress: number
  } | null
  provisioning: {
    status: string | null
    jobId: string | null
    jobStatus: string | null
    displayStatus: string | null
    latestUpid: string | null
    error: string | null
    source: "order" | "vm" | "none"
  }
  provisioningChecklist?: Array<{ key: string; label: string; status: "pending" | "running" | "completed" | "failed"; completedAt?: string | null }>
  network: {
    primaryAssignedIp: string | null
    eventStatus: string | null
    lastEventType: string | null
    issues: string[]
  }
  renewal: {
    type: "vm" | "dedicated" | "none"
    nextRenewalAt: string | null
    renewalAmount: number | null
  }
  health: {
    payment: "paid" | "pending" | "failed" | "reconciled"
    provisioning: "queued" | "provisioning" | "failed" | "active"
    network: "healthy" | "mismatch" | "repairing"
    vm: "running" | "stopped" | "locked" | "suspended"
    orderHealth: "healthy" | "attention" | "critical"
  }
  diagnostics: {
    supportCode: string
    issues: string[]
    staleVmState: boolean
  }
  dedicated: {
    id: string
    status: string
    serviceNumber: string
    primaryIp: string | null
    nextRenewalAt: string | null
    renewalAmount: number | null
  } | null
}

type OrdersPayload = {
  success: boolean
  rows: OrderRow[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pages: number
  }
  vmStatusPartial?: boolean
  partialWarnings?: string[]
}

type ProxmoxNodeOption = { id: string; name: string; nodeName: string; status?: string | null; isActive?: boolean }

type BulkAction = "" | "cancel_pending" | "delete_selected_unpaid_orders" | "export" | "retry_provisioning"

const PAID_ORDER_STATUSES = ["paid", "active", "completed", "verification_pending"]

function StatusBadge({ value }: { value: string }) {
  return <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{value || "unknown"}</span>
}

function ChecklistSummary({ items = [] }: { items?: OrderRow["provisioningChecklist"] }) {
  if (!items?.length) return null
  const completed = items.filter((item) => item.status === "completed").length
  const activeItems = items.filter((item) => item.status !== "pending").slice(-3)
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border/40 bg-background/35 p-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Checklist</span>
        <span className="font-medium">{completed}/{items.length}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((completed / items.length) * 100)}%` }} />
      </div>
      {activeItems.map((item) => (
        <div key={item.key} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{item.label}</span>
          <span className={item.status === "failed" ? "text-destructive" : item.status === "completed" ? "text-emerald-400" : "text-amber-300"}>{item.status}</span>
        </div>
      ))}
    </div>
  )
}

function debugSelection(message: string, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[AdminOrdersSelection]", message, details)
  }
}

export default function AdminOrdersPage() {
  const query = useSearchParams()
  const focusOrderId = query.get("focus") || ""
  const focusBulkGroupId = query.get("focusBulk") || ""
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [search, setSearch] = useState(() => query.get("search") || "")
  const [page, setPage] = useState(1)

  const [provisioningId, setProvisioningId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<ProxmoxNodeOption[]>([])
  const [provisionModal, setProvisionModal] = useState<{ order: OrderRow; nodeId: string; ipAssignmentMode: "automatic" | "manual"; poolId: string; requestedIp: string; forceIpOverride: boolean } | null>(null)
  const [readiness, setReadiness] = useState<any>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [repairingAllOrders, setRepairingAllOrders] = useState(false)
  const [deletingOrder, setDeletingOrder] = useState<OrderRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set())
  const [bulkAction, setBulkAction] = useState<BulkAction>("")
  const [pendingBulkAction, setPendingBulkAction] = useState<BulkAction>("")
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkConfirmationText, setBulkConfirmationText] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [failures, setFailures] = useState<string[]>([])
  const [expandedBulkGroups, setExpandedBulkGroups] = useState<Set<string>>(() => new Set())
  const previousVisibleIdsRef = useRef<string>("")

  const endpoint = useMemo(() => {
    const params = new URLSearchParams()
    params.set("page", String(page))
    params.set("pageSize", "50")
    if (includeDeleted) params.set("includeDeleted", "true")
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (search.trim()) params.set("search", search.trim())
    return `/api/admin/orders/with-vm-status?${params.toString()}`
  }, [page, includeDeleted, statusFilter, search])

  const { data, loading, error, reload, lastUpdatedAt } = useAdminVmQuery<OrdersPayload>({
    endpoint,
    pollActive: true,
    deps: [endpoint],
    fallbackErrorMessage: "Unable to refresh VM state.",
  })

  useEffect(() => {
    if (!error) return
    setFailures((current) => Array.from(new Set([error, ...current])).slice(0, 8))
  }, [error])

  useEffect(() => {
    fetch("/api/admin/proxmox-nodes", { cache: "no-store" })
      .then(async (res) => {
        const body = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(body?.error || "Unable to load provision nodes")
        const rawNodes = Array.isArray(body) ? body : Array.isArray(body.nodes) ? body.nodes : []
        setNodes(rawNodes.map((node: any) => ({
          id: String(node.id || ""),
          name: String(node.name || node.nodeName || "Node"),
          nodeName: String(node.nodeName || node.name || "node"),
          status: node.status || null,
          isActive: node.isActive !== false,
        })).filter((node: ProxmoxNodeOption) => node.id && node.isActive))
      })
      .catch((loadError) => setFailures((current) => Array.from(new Set([loadError?.message || "Unable to load provision nodes", ...current])).slice(0, 8)))
  }, [])

  const rows: OrderRow[] = useMemo(() => data?.rows || [], [data?.rows])
  const pagination: OrdersPayload["pagination"] = data?.pagination || { page: 1, pageSize: 50, total: 0, pages: 1 }
  const showInitialError = Boolean(error && !rows.length && !loading)
  const vmStatusPartial = data?.vmStatusPartial === true

  const visibleOrderIds = useMemo(() => rows.map((row) => row.order.id), [rows])
  const selectedIds = useMemo(() => Array.from(selectedOrderIds), [selectedOrderIds])
  const selectedVisibleRows = useMemo(
    () => rows.filter((row) => selectedOrderIds.has(row.order.id)),
    [rows, selectedOrderIds],
  )
  const selectionSummary = useMemo(
    () => summarizeVisibleSelection(selectedOrderIds, visibleOrderIds),
    [selectedOrderIds, visibleOrderIds],
  )
  const selectedCount = selectionSummary.selectedCount
  const hasPaidVisibleSelection = useMemo(
    () => selectedVisibleRows.some((row) => PAID_ORDER_STATUSES.includes(String(row.order.status || "").toLowerCase())),
    [selectedVisibleRows],
  )
  const pendingBulkActionLabel = useMemo(() => {
    if (pendingBulkAction === "delete_selected_unpaid_orders") return "Delete selected orders"
    if (pendingBulkAction === "cancel_pending") return "Cancel pending orders"
    if (pendingBulkAction === "retry_provisioning") return "Retry provisioning"
    if (pendingBulkAction === "export") return "Export selected orders"
    return "Apply bulk action"
  }, [pendingBulkAction])
  const provisionModalOrderId = provisionModal?.order.order.id
  const provisionModalNodeId = provisionModal?.nodeId
  const provisionModalIpMode = provisionModal?.ipAssignmentMode
  const provisionModalPoolId = provisionModal?.poolId
  const provisionModalRequestedIp = provisionModal?.requestedIp
  const provisionModalForceIpOverride = provisionModal?.forceIpOverride
  const provisionModalNodes = useMemo(() => nodes, [nodes])

  useEffect(() => {
    const visibleKey = visibleOrderIds.join("|")
    if (previousVisibleIdsRef.current && previousVisibleIdsRef.current !== visibleKey) {
      debugSelection("visible rows refreshed", {
        previousVisibleIds: previousVisibleIdsRef.current,
        visibleIds: visibleKey,
        selectedCount,
      })
    }
    previousVisibleIdsRef.current = visibleKey
  }, [selectedCount, visibleOrderIds])

  useEffect(() => {
    debugSelection("selected count changed", { selectedCount })
  }, [selectedCount])

  useEffect(() => {
    if (!provisionModalOrderId || !provisionModalNodeId) {
      setReadiness(null)
      return
    }
    const controller = new AbortController()
    setReadinessLoading(true)
    const params = new URLSearchParams()
    params.set("nodeId", provisionModalNodeId)
    params.set("ipAssignmentMode", provisionModalIpMode || "automatic")
    if (provisionModalPoolId) params.set("poolId", provisionModalPoolId)
    if (provisionModalRequestedIp) params.set("requestedIp", provisionModalRequestedIp)
    if (provisionModalForceIpOverride) params.set("forceIpOverride", "true")
    fetch(`/api/admin/provision/${provisionModalOrderId}/readiness?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body = await readJsonResponse<any>(res)
        if (!res.ok) throw new Error(body?.error || "Unable to check node readiness")
        setReadiness(body)
      })
      .catch((readinessError) => {
        if (readinessError?.name !== "AbortError") setReadiness({ success: false, error: readinessError?.message || "Unable to check node readiness" })
      })
      .finally(() => setReadinessLoading(false))
    return () => controller.abort()
  }, [provisionModalOrderId, provisionModalNodeId, provisionModalIpMode, provisionModalPoolId, provisionModalRequestedIp, provisionModalForceIpOverride])

  useEffect(() => {
    if (!provisionModal || ["auto", "product_default"].includes(provisionModal.nodeId)) return
    if (!provisionModalNodes.some((node) => node.id === provisionModal.nodeId)) {
      setProvisionModal((current) => current ? { ...current, nodeId: "auto" } : current)
    }
  }, [provisionModal, provisionModalNodes])

  const toggleOrderSelection = useCallback((id: string, checked: boolean) => {
    setSelectedOrderIds((current) => {
      const next = toggleSelectedId(current, id, checked)
      debugSelection(checked ? "selection added" : "selection removed", { id, selectedCount: next.size })
      return next
    })
  }, [])

  const toggleVisibleSelection = useCallback(() => {
    setSelectedOrderIds((current) => {
      const summary = summarizeVisibleSelection(current, visibleOrderIds)
      const selectVisible = !summary.allVisibleSelected
      const next = setVisibleSelection(current, visibleOrderIds, selectVisible)
      debugSelection(selectVisible ? "visible rows selected" : "visible rows deselected", {
        visibleCount: visibleOrderIds.length,
        selectedCount: next.size,
      })
      return next
    })
  }, [visibleOrderIds])

  const clearSelection = useCallback(() => {
    setSelectedOrderIds(() => {
      debugSelection("selection cleared", { selectedCount: 0 })
      return new Set()
    })
  }, [])

  const clearHiddenSelected = useCallback(() => {
    setSelectedOrderIds((current) => {
      const next = clearHiddenSelection(current, visibleOrderIds)
      debugSelection("hidden selection cleared", {
        beforeCount: current.size,
        afterCount: next.size,
        visibleCount: visibleOrderIds.length,
      })
      return next
    })
  }, [visibleOrderIds])

  const stopSelectionEvent = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }, [])

  const toggleBulkGroup = useCallback((groupId: string) => {
    setExpandedBulkGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  async function handleProvision(orderId: string, nodeId = "product_default", ipOptions?: { ipAssignmentMode?: string; poolId?: string | null; requestedIp?: string | null; forceIpOverride?: boolean }) {
    setProvisioningId(orderId)
    try {
      const res = await fetch(`/api/admin/provision/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId, ...(ipOptions || {}) }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(body?.error || "Provisioning failed")
      await reload()
    } catch (provisionError: any) {
      const message = provisionError?.message || "Unable to refresh VM state."
      dedupedAdminErrorToast({ message, key: `provision:${orderId}` })
      setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
      await reload()
    } finally {
      setProvisioningId(null)
      setProvisionModal(null)
    }
  }

  async function repairAllOrders() {
    setRepairingAllOrders(true)
    try {
      const res = await fetch("/api/admin/orders/repair-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
      const body = (await readJsonResponse<any>(res)) || {}
      if (!res.ok || body.success === false) throw new Error(body.error || "Repair all orders failed")
      const result = body.result || {}
      const message = `Repair all: scanned ${result.scanned || 0}, repaired ${result.repaired || 0}, requeued ${result.requeued || 0}, failed ${result.failed || 0}`
      setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
      await reload()
    } catch (repairError: any) {
      const message = repairError?.message || "Repair all orders failed"
      dedupedAdminErrorToast({ message, key: "repair-all-orders" })
      setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
    } finally {
      setRepairingAllOrders(false)
    }
  }

  async function handleDeleteOrder() {
    if (!deletingOrder) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/admin/orders/${deletingOrder.order.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })
      const body = (await readJsonResponse<any>(res)) || {}
      if (!res.ok) throw new Error(body.error || "Failed to delete order")
      setDeletingOrder(null)
      await reload()
    } catch (deleteError: any) {
      const message = deleteError?.message || "Unable to refresh VM state."
      dedupedAdminErrorToast({ message, key: `delete:${deletingOrder.order.id}` })
      setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
    } finally {
      setDeleteLoading(false)
    }
  }

  const openBulkConfirmation = useCallback((action: BulkAction = bulkAction) => {
    if (!action || !selectedCount) return
    setPendingBulkAction(action)
    setBulkConfirmationText("")
    setBulkConfirmOpen(true)
  }, [bulkAction, selectedCount])

  async function runBulkAction(actionOverride?: BulkAction) {
    const action = actionOverride || pendingBulkAction || bulkAction
    if (!action || !selectedIds.length) return
    if (action === "delete_selected_unpaid_orders" && hasPaidVisibleSelection && bulkConfirmationText.trim() !== "DELETE ORDERS") return

    try {
      setBulkLoading(true)
      const res = await fetch("/api/admin/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds, confirmationText: bulkConfirmationText.trim() }),
      })
      const body = (await readJsonResponse<any>(res)) || {}

      if (!res.ok) {
        const message = body.error || "Bulk order action failed"
        dedupedAdminErrorToast({ message, key: `bulk:${action}` })
        setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
        return
      }

      setBulkConfirmOpen(false)

      if (action === "export") {
        const blob = new Blob([String(body.csv || "")], { type: "text/csv" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = "selected-orders.csv"
        link.click()
        URL.revokeObjectURL(url)
        return
      }

      setSelectedOrderIds((current) => {
        const next = removeSelectedIds(current, selectedIds)
        debugSelection("bulk action reconciled selection", {
          action,
          removedCount: selectedIds.length,
          selectedCount: next.size,
        })
        return next
      })
      await reload()
    } catch (bulkError: any) {
      const message = bulkError?.message || "Bulk order action failed"
      dedupedAdminErrorToast({ message, key: `bulk:${action}` })
      setFailures((current) => Array.from(new Set([message, ...current])).slice(0, 8))
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <Card className="glass border-border/40">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Unified order, VM, payment, provisioning, and network state.</CardDescription>
            <p className="text-xs text-muted-foreground">{formatLastUpdated(lastUpdatedAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <AdminDiagnosticsDrawer localFailures={failures} onRetry={reload} />
            <Button variant="outline" size="sm" onClick={() => void repairAllOrders()} disabled={repairingAllOrders}>
              {repairingAllOrders ? "Repairing..." : "Repair All Orders"}
            </Button>
            <Button asChild size="sm"><Link href="/admin/orders/new">Create Order</Link></Button>
            <Button variant="outline" size="sm" onClick={() => { setIncludeDeleted((value) => !value); setPage(1) }}>
              {includeDeleted ? "Hide deleted" : "Show deleted"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1) }}>
            <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
          <input
            className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Search order/customer/service"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1) }}
          />
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Select value={bulkAction || "none"} onValueChange={(value) => setBulkAction((value === "none" ? "" : value) as BulkAction)}>
            <SelectTrigger className="h-9 w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Bulk actions</SelectItem>
              <SelectItem value="cancel_pending">Cancel pending orders</SelectItem>
              <SelectItem value="delete_selected_unpaid_orders">Delete selected failed/cancelled/pending unpaid orders</SelectItem>
              <SelectItem value="export">Export selected</SelectItem>
              <SelectItem value="retry_provisioning">Retry provisioning for paid failed orders</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => openBulkConfirmation()} disabled={!bulkAction || !selectedCount}>Apply</Button>
          <span className="text-xs text-muted-foreground">{selectedCount} selected</span>
        </div>
        {selectedCount > 0 ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border-selected)] bg-[var(--accent-subtle)] px-3 py-2 text-sm shadow-sm shadow-black/20">
            <div>
              <span className="font-medium text-foreground">{selectedCount} orders selected</span>
              {selectionSummary.hiddenSelectedCount > 0 ? (
                <span className="ml-2 text-xs text-muted-foreground">{selectionSummary.hiddenSelectedCount} selected rows hidden by filters or pagination</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectionSummary.hiddenSelectedCount > 0 ? <Button size="sm" variant="outline" onClick={clearHiddenSelected}>Clear Hidden</Button> : null}
              <Button size="sm" variant="outline" onClick={clearSelection}>Clear</Button>
              <Button size="sm" variant="outline" onClick={() => openBulkConfirmation("export")}>Export</Button>
              <Button size="sm" variant="outline" onClick={() => openBulkConfirmation("cancel_pending")}>Cancel Pending</Button>
              <Button size="sm" variant="destructive" onClick={() => openBulkConfirmation("delete_selected_unpaid_orders")}>Delete</Button>
            </div>
          </div>
        ) : null}
        {showInitialError ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <span>Unable to load orders right now.</span>
            <Button size="sm" variant="outline" onClick={() => void reload()}>Retry</Button>
          </div>
        ) : null}
        {vmStatusPartial ? (
          <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Orders loaded with partial VM status. Pending or missing VM fields are shown with safe fallbacks.
          </div>
        ) : null}

        <table className="w-full min-w-[1180px] text-sm">
          <thead className="border-b border-border/40 text-left text-muted-foreground">
            <tr>
              <th className="w-10 py-2">
                <Checkbox
                  checked={selectionSummary.allVisibleSelected ? true : selectionSummary.partiallyVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={toggleVisibleSelection}
                  onClick={stopSelectionEvent}
                  onPointerDown={stopSelectionEvent}
                  aria-label="Select visible orders"
                  aria-checked={selectionSummary.partiallyVisibleSelected ? "mixed" : selectionSummary.allVisibleSelected}
                  disabled={!rows.length}
                />
              </th>
              <th className="py-2">Order</th>
              <th className="py-2">Customer</th>
              <th className="py-2">Service</th>
              <th className="py-2">Amount</th>
              <th className="py-2">Payment</th>
              <th className="py-2">Provisioning</th>
              <th className="py-2">Network/VM</th>
              <th className="py-2">Created</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const customerLabel = row.customer?.name || row.customer?.email || "Unknown customer"
              const serviceLabel = row.vm?.name || row.dedicated?.serviceNumber || row.order.orderType || "Provision pending"
              const ipLabel = row.vm?.ipAddress || row.network.primaryAssignedIp || row.dedicated?.primaryIp || "N/A"
              const nodeLabel = row.vm?.nodeName || "N/A"
              const vmLabel = row.vm?.status || (row.dedicated ? row.dedicated.status : "Provision pending")
              const bulkGroupId = row.bulk?.bulkGroupId || null
              const focused = row.order.id === focusOrderId || Boolean(focusBulkGroupId && bulkGroupId === focusBulkGroupId)
              const isBulkExpanded = Boolean(bulkGroupId && expandedBulkGroups.has(bulkGroupId))
              const bulkHostnames = row.bulk?.groupHostnames || []
              return (
                <Fragment key={row.order.id}>
                  <tr
                    className={`border-b align-top transition-colors ${focused ? "border-l-2 border-l-accent bg-accent/10" : selectedOrderIds.has(row.order.id) ? "selected-item border-l-2 border-b-border/30" : "border-l-2 border-l-transparent border-b-border/20 hover:bg-[rgba(255,255,255,0.04)]"}`}
                  >
                    <td className="py-3">
                      <Checkbox
                        checked={selectedOrderIds.has(row.order.id)}
                        onCheckedChange={(checked) => toggleOrderSelection(row.order.id, checked === true)}
                        onClick={stopSelectionEvent}
                        onPointerDown={stopSelectionEvent}
                        aria-label={`Select order ${row.order.orderNumber}`}
                      />
                    </td>
                    <td className="py-3">
                      <div className="font-mono">{row.order.orderNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.order.orderType || "standard"} · {row.order.billingTerm || 1}m
                      </div>
                      {bulkGroupId ? (
                        <Button size="sm" variant="outline" className="mt-2 h-7 px-2 text-xs" onClick={() => toggleBulkGroup(bulkGroupId)}>
                          {isBulkExpanded ? "Hide group" : `Show group (${row.bulk?.bulkQuantity || row.vmCount || 1})`}
                        </Button>
                      ) : null}
                    </td>
                    <td className="py-3">{customerLabel}</td>
                    <td className="py-3">
                      <div>{serviceLabel}</div>
                      {row.vm ? <div className="text-xs text-muted-foreground">VMID {row.vm.vmid}</div> : <div className="text-xs text-muted-foreground">Provision pending</div>}
                      <div className="text-xs text-muted-foreground">VM count: {row.vmCount || (row.vm ? 1 : 0)}</div>
                    </td>
                    <td className="py-3">₹{Number(row.order.payableAmount || row.order.totalAmount).toLocaleString("en-IN")}</td>
                    <td className="py-3">
                      <div className="space-y-1">
                        <StatusBadge value={row.health.payment} />
                        <div className="text-xs text-muted-foreground">{row.payment?.gateway || "N/A"}</div>
                        <div className="text-xs text-muted-foreground">{row.payment?.verified ? "Verified" : "Pending verification"}</div>
                        {row.payment?.transactionId ? <div className="font-mono text-xs text-muted-foreground">{row.payment.transactionId}</div> : null}
                        {row.invoice ? <div className="text-xs text-muted-foreground">{row.invoice.invoiceNumber}</div> : null}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="space-y-1">
                        <StatusBadge value={row.health.provisioning} />
                        <div className="text-xs text-muted-foreground">{row.provisioning.displayStatus || row.provisioning.status || "Pending"}</div>
                        {row.bulk ? <div className="text-xs text-muted-foreground">Group progress: {row.bulk.provisioningProgress}%</div> : null}
                        <ChecklistSummary items={row.provisioningChecklist} />
                        {row.provisioning.error ? <p className="max-w-xs text-xs text-destructive">{row.provisioning.error}</p> : null}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="space-y-1">
                        <StatusBadge value={row.health.network} />
                        <div className="text-xs text-muted-foreground">IP: {ipLabel}</div>
                        <div className="text-xs text-muted-foreground">NODE: {nodeLabel}</div>
                        <div className="text-xs text-muted-foreground">VM: {vmLabel}</div>
                        {row.diagnostics.issues[0] ? <div className="max-w-xs text-xs text-destructive">{row.diagnostics.issues[0]}</div> : null}
                      </div>
                    </td>
                    <td className="py-3">{new Date(row.order.createdAt).toLocaleString()}</td>
                    <td className="py-3 text-right">
                      {row.order.deletedAt ? (
                        <StatusBadge value="deleted" />
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="gap-2">
                              Actions
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuLabel>Order actions</DropdownMenuLabel>
                            <DropdownMenuItem asChild>
                              <Link href={row.vm ? `/admin/vms/${row.vm.id}` : row.dedicated ? "/admin/dedicated" : `/admin/orders?order=${encodeURIComponent(row.order.orderNumber)}`}>
                                Manage
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild disabled={!row.invoice}>
                              {row.invoice ? <Link href={`/invoice/${row.invoice.invoiceNumber}`}>Billing</Link> : <span>Billing</span>}
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild disabled={!row.vm}>
                              {row.vm ? <Link href={`/admin/vms/${row.vm.id}/console`}>Console</Link> : <span>Console</span>}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeletingOrder(row)}>
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                  {isBulkExpanded ? (
                    <tr className="border-b border-b-border/20 bg-background/30">
                      <td />
                      <td colSpan={9} className="py-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Grouped hostnames</span>
                          {(bulkHostnames.length ? bulkHostnames : [serviceLabel]).map((hostname) => (
                            <span key={hostname} className="rounded-md border border-border/40 px-2 py-1 font-mono">{hostname}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
            {!rows.length && (
              <tr><td className="py-10 text-center text-muted-foreground" colSpan={10}>{loading ? "Loading order health view..." : "No orders found for current filters."}</td></tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-muted-foreground">Page {pagination.page} of {pagination.pages} · {pagination.total.toLocaleString()} total rows</p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
            <Button size="sm" variant="outline" disabled={pagination.page >= pagination.pages} onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}>Next</Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={Boolean(provisionModal)} onOpenChange={(open) => !open && setProvisionModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Provision VM</DialogTitle>
            <DialogDescription>Select the exact node where this VM should be created.</DialogDescription>
          </DialogHeader>
          {provisionModal ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Provision Node</label>
                  <Select value={provisionModal.nodeId} onValueChange={(nodeId) => setProvisionModal((current) => current ? { ...current, nodeId } : current)}>
                    <SelectTrigger><SelectValue placeholder="Select node" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="product_default">Product Default</SelectItem>
                      <SelectItem value="auto">Auto Select</SelectItem>
                      {provisionModalNodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>{node.name} ({node.nodeName}){node.status ? ` - ${node.status}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">IP Assignment Mode</label>
                  <Select value={provisionModal.ipAssignmentMode} onValueChange={(ipAssignmentMode: "automatic" | "manual") => setProvisionModal((current) => current ? { ...current, ipAssignmentMode, requestedIp: ipAssignmentMode === "automatic" ? "" : current.requestedIp } : current)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">Automatic</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {provisionModal.ipAssignmentMode === "manual" ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">IP Pool</label>
                      <Select value={provisionModal.poolId || "auto"} onValueChange={(poolId) => setProvisionModal((current) => current ? { ...current, poolId: poolId === "auto" ? "" : poolId, requestedIp: "" } : current)}>
                        <SelectTrigger><SelectValue placeholder="Select pool" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto compatible pool</SelectItem>
                          {(readiness?.ipPools || []).map((pool: any) => (
                            <SelectItem key={pool.id} value={pool.id}>{pool.name} ({pool.freeIps || 0} free)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Available IP</label>
                      <Select value={provisionModal.requestedIp || "auto"} onValueChange={(requestedIp) => setProvisionModal((current) => current ? { ...current, requestedIp: requestedIp === "auto" ? "" : requestedIp } : current)}>
                        <SelectTrigger><SelectValue placeholder="Select IP" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">First available</SelectItem>
                          {(readiness?.availableIps || []).map((ip: string) => (
                            <SelectItem key={ip} value={ip}>{ip}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={provisionModal.forceIpOverride} onChange={(event) => setProvisionModal((current) => current ? { ...current, forceIpOverride: event.target.checked } : current)} />
                      Admin override
                    </label>
                  </>
                ) : null}
                <div className="rounded-lg border border-border/40 p-3 text-sm">
                  <div className="text-muted-foreground">Order</div>
                  <div className="font-medium">{provisionModal.order.order.orderNumber}</div>
                  <div className="text-xs text-muted-foreground">{provisionModal.order.customer?.email || "No customer"}</div>
                </div>
              </div>
              <div className="rounded-lg border border-border/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Readiness</p>
                  <span className="text-xs text-muted-foreground">{readinessLoading ? "Checking..." : readiness?.preflight?.ok ? "Ready" : readiness?.preflight ? "Needs attention" : "Not checked"}</span>
                </div>
                {readiness?.resolvedNode ? (
                  <p className="mb-2 text-xs text-muted-foreground">Resolved node: {readiness.resolvedNode.name} ({readiness.resolvedNode.nodeName})</p>
                ) : null}
                {readiness?.selectedPool ? (
                  <div className="mb-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-md border border-border/35 px-3 py-2">
                      <div className="text-muted-foreground">Selected pool</div>
                      <div className="font-medium">{readiness.selectedPool.name}</div>
                    </div>
                    <div className="rounded-md border border-border/35 px-3 py-2">
                      <div className="text-muted-foreground">Fallback pool</div>
                      <div className="font-medium">{readiness.fallbackPool?.name || "-"}</div>
                    </div>
                    <div className="rounded-md border border-border/35 px-3 py-2">
                      <div className="text-muted-foreground">Selected IP</div>
                      <div className="font-mono font-medium">{provisionModal.requestedIp || readiness.selectedIp || "-"}</div>
                    </div>
                  </div>
                ) : null}
                {(readiness?.ipPools || []).length ? (
                  <div className="mb-3 rounded-md border border-border/35 p-2 text-xs">
                    <div className="mb-1 font-medium">Compatible pools</div>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {readiness.ipPools.map((pool: any) => (
                        <div key={pool.id} className={pool.exhausted ? "text-amber-400" : "text-emerald-400"}>
                          {pool.name}: {pool.freeIps || 0} free{pool.exhausted ? " · exhausted" : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {(readiness?.preflight?.checks || []).map((check: any) => (
                    <div key={check.name} className={`rounded-md border px-3 py-2 text-xs ${check.ok ? "border-emerald-500/30 bg-emerald-500/10" : "border-destructive/30 bg-destructive/10"}`}>
                      <div className="font-medium">{check.name.replace(/_/g, " ")}</div>
                      <div className="mt-1 text-muted-foreground">{check.message}</div>
                    </div>
                  ))}
                </div>
                {readiness?.error ? <p className="text-sm text-destructive">{readiness.error}</p> : null}
                {!readinessLoading && !readiness?.preflight?.checks?.length && !readiness?.error ? <p className="text-sm text-muted-foreground">No readiness details returned.</p> : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setProvisionModal(null)}>Cancel</Button>
            <Button
              onClick={() => provisionModal && void handleProvision(provisionModal.order.order.id, provisionModal.nodeId, {
                ipAssignmentMode: provisionModal.ipAssignmentMode,
                poolId: provisionModal.poolId || null,
                requestedIp: provisionModal.requestedIp || null,
                forceIpOverride: provisionModal.forceIpOverride,
              })}
              disabled={!provisionModal || provisioningId === provisionModal.order.order.id || readinessLoading || (readiness?.preflight?.ok === false && !provisionModal.forceIpOverride)}
            >
              {provisionModal && provisioningId === provisionModal.order.order.id ? "Queueing..." : "Queue Provisioning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deletingOrder)} onOpenChange={(open) => !open && setDeletingOrder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete order record?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingOrder?.vm
                ? `This will destroy VMID ${deletingOrder.vm.vmid}, release assigned IPs, and mark the order deleted.`
                : "This will mark the order deleted. Deleted orders are hidden by default."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleDeleteOrder()
              }}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting..." : deletingOrder?.vm ? "Delete order and VM" : "Delete order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkConfirmOpen} onOpenChange={(open) => { if (!bulkLoading) setBulkConfirmOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingBulkActionLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingBulkAction === "delete_selected_unpaid_orders"
                ? `Delete ${selectedCount} selected orders? Paid or active records require typed confirmation and attached services will be cleaned up.`
                : pendingBulkAction === "cancel_pending"
                  ? `Cancel pending status for ${selectedCount} selected orders. Orders that are not pending will be skipped.`
                  : pendingBulkAction === "retry_provisioning"
                    ? `Retry provisioning for ${selectedCount} selected orders. Only paid failed provisioning orders will be retried.`
                    : `Export ${selectedCount} selected orders as CSV.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingBulkAction === "delete_selected_unpaid_orders" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                If this selection includes paid or completed records, type <span className="font-mono text-foreground">DELETE ORDERS</span> to confirm service cleanup.
              </p>
              <input
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                value={bulkConfirmationText}
                onChange={(event) => setBulkConfirmationText(event.target.value)}
                placeholder="DELETE ORDERS"
                aria-label="Paid order delete confirmation"
              />
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void runBulkAction()
              }}
              disabled={bulkLoading || (pendingBulkAction === "delete_selected_unpaid_orders" && hasPaidVisibleSelection && bulkConfirmationText.trim() !== "DELETE ORDERS")}
              className={pendingBulkAction === "delete_selected_unpaid_orders" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {bulkLoading ? "Applying..." : pendingBulkAction === "delete_selected_unpaid_orders" ? "Delete Orders" : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
