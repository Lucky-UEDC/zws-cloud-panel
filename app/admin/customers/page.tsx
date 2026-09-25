"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Link from "next/link"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Download, Eye, Pencil, Plus, Search, ShieldCheck, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
import EditCustomerModal from "@/components/admin/EditCustomerModal"


type Customer = {
  id: string
  email: string
  name: string | null
  phone: string | null
  company: string | null
  internalNotes: string | null
  isActive: boolean
  status: "ACTIVE" | "SUSPENDED" | "PENDING" | "BANNED" | "CLOSED"
  walletBalance: number
  paymentsTotal: number
  serviceSpend?: number
  createdAt: string
  _count: { orders: number; payments: number; invoices: number; supportTickets: number }
}

type EditForm = {
  name: string
  email: string
  phone: string
  company: string
  walletBalance: string
  status: string
  internalNotes: string
  walletReason: string
}

const emptyEditForm: EditForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  walletBalance: "0",
  status: "ACTIVE",
  internalNotes: "",
  walletReason: "",
}

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function AdminCustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("ALL")
  const [selected, setSelected] = useState<string[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(emptyEditForm)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams({ pageSize: "100" })
      if (search.trim()) params.set("search", search.trim())
      if (status !== "ALL") params.set("status", status)
      const res = await fetch(`/api/admin/customers?${params.toString()}`)
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to load customers")
      setCustomers(data?.customers || [])
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      const message = error?.message || "Unable to load customers right now."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const selectedCustomers = useMemo(
    () => customers.filter((customer) => selected.includes(customer.id)),
    [customers, selected],
  )
  const allSelected = customers.length > 0 && customers.every((customer) => selected.includes(customer.id))

  function toggle(id: string) {
    setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }

  function openEdit(customer: Customer) {
    setEditing(customer)
    setEditOpen(true)
  }


  async function saveEdit() {
    if (!editing) return
    const currentBalance = Number(editing.walletBalance || 0)
    const nextBalance = Number(editForm.walletBalance || 0)
    if (currentBalance !== nextBalance && !editForm.walletReason.trim()) {
      toast.error("Wallet balance changes require a reason")
      return
    }

    const res = await fetch(`/api/admin/customers/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editForm, walletBalance: nextBalance }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to save customer")
      return
    }
    toast.success("Customer updated")
    setEditOpen(false)
    await load()
  }

  async function resetPassword() {
    if (!editing) return
    const res = await fetch(`/api/admin/customers/${editing.id}/reset-password`, { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to send reset email")
      return
    }
    toast.success("Password reset email sent")
  }

  async function updateStatus(customer: Customer) {
    const action = customer.status === "ACTIVE" ? "suspend" : "activate"
    const res = await fetch("/api/admin/customers/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [customer.id], action }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Status update failed")
      return
    }
    toast.success(action === "activate" ? "Customer activated" : "Customer suspended")
    await load()
  }

  async function bulkAction(action: "activate" | "suspend" | "delete") {
    const res = await fetch("/api/admin/customers/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selected, action }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Bulk action failed")
      return
    }
    if (action === "delete" && data.blockedIds?.length) {
      toast.warning(`${data.deleted || 0} deleted. ${data.blockedIds.length} skipped because of active orders.`)
    } else {
      toast.success("Bulk action completed")
    }
    setSelected([])
    setBulkDeleteOpen(false)
    await load()
  }

  async function deleteCustomer() {
    if (!deleteTarget) return
    const res = await fetch(`/api/admin/customers/${deleteTarget.id}`, { method: "DELETE" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Customer delete failed")
      return
    }
    toast.success("Customer deleted")
    setDeleteTarget(null)
    setDeleteOpen(false)
    await load()
  }

  function exportSelected() {
    downloadCsv("selected-customers.csv", [
      ["Name", "Email", "Wallet Balance", "Orders Count", "Service Spend", "Tickets Count", "Status", "Created At", "Last Login"],
      ...selectedCustomers.map((customer) => [
        customer.name || "",
        customer.email,
        customer.walletBalance,
        customer._count.orders,
        customer.serviceSpend ?? customer.paymentsTotal,
        customer._count.supportTickets,
        customer.status,
        customer.createdAt,
        "",
      ]),
    ])
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Customers</h1>
          <p className="mt-1 text-muted-foreground">Manage customers, balances, account status, and lifecycle actions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="gap-1.5">
            <a href="/api/admin/customers/export">
              <Download className="h-4 w-4" />
              Export All (CSV)
            </a>
          </Button>
          <Button asChild className="gap-1.5">
            <Link href="/admin/customers/new">
              <Plus className="h-4 w-4" />
              Add Customer
            </Link>
          </Button>
        </div>
      </div>

      <Card className="glass border-border/40">
        <CardHeader className="gap-4">
          <div>
            <CardTitle>All Customers</CardTitle>
            <CardDescription>Linked orders, payments, wallet, and support totals.</CardDescription>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email" className="pl-9" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              Unable to load customers right now. {loadError}
            </div>
          ) : null}
          {selected.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/40 p-3">
              <p className="text-sm text-muted-foreground">{selected.length} selected</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={exportSelected}>Bulk Export Selected (CSV)</Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction("activate")}>Bulk Activate</Button>
                <Button size="sm" variant="outline" onClick={() => bulkAction("suspend")}>Bulk Suspend</Button>
                <Button size="sm" variant="destructive" onClick={() => setBulkDeleteOpen(true)}>Bulk Delete</Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border/40 text-left text-muted-foreground">
                    <th className="py-2 pr-3">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) => {
                          const visibleIds = customers.map((customer) => customer.id)
                          setSelected((ids) => checked
                            ? [...new Set([...ids, ...visibleIds])]
                            : ids.filter((id) => !visibleIds.includes(id)))
                        }}
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Select all customers"
                      />
                    </th>
                    <th className="py-2">Customer</th>
                    <th className="py-2">Wallet</th>
                    <th className="py-2">Orders</th>
                    <th className="py-2">Service Spend</th>
                    <th className="py-2">Tickets</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Created</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <CustomerRow
                      key={customer.id}
                      customer={customer}
                      selected={selected.includes(customer.id)}
                      onOpen={() => router.push(`/admin/customers/${customer.id}`)}
                      onToggle={() => toggle(customer.id)}
                      onEdit={() => openEdit(customer)}
                      onStatus={() => updateStatus(customer)}
                      onDelete={() => {
                        setDeleteTarget(customer)
                        setDeleteOpen(true)
                      }}
                    />
                  ))}
                  {!customers.length && (
                    <tr>
                      <td className="py-8 text-center text-muted-foreground" colSpan={9}>No customers found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editOpen && (
        <EditCustomerModal
          customer={editing!}
          onClose={() => {
            setEditOpen(false);
            setEditing(null);
          }}
          onSave={() => {
            setEditOpen(false);
            setEditing(null);
            load();
          }}
        />
      )}


      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected customers?</AlertDialogTitle>
            <AlertDialogDescription>Customers with active orders will be skipped. This action removes account records and related history for deletable customers.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => bulkAction("delete")} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Trash2 className="h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={(open) => {
        setDeleteOpen(open)
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.email || "This customer"} will be deleted only if no active orders or live services remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCustomer} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Trash2 className="h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "ACTIVE"
  const suspended = status === "SUSPENDED"
  return (
    <Badge variant={suspended ? "destructive" : "outline"} className={active ? "border-accent/40 text-accent" : ""}>
      {status}
    </Badge>
  )
}

const CustomerRow = memo(function CustomerRow({
  customer,
  selected,
  onOpen,
  onToggle,
  onEdit,
  onStatus,
  onDelete,
}: {
  customer: Customer
  selected: boolean
  onOpen: () => void
  onToggle: () => void
  onEdit: () => void
  onStatus: () => void
  onDelete: () => void
}) {
  return (
    <tr
      className="group cursor-pointer border-b border-border/20 transition duration-200 hover:bg-[rgba(255,255,255,0.04)]"
      onClick={onOpen}
    >
      <td className="py-3 pr-3" onClick={(event) => event.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${customer.email}`} />
      </td>
      <td className="py-3">
        <p className="font-medium transition-colors group-hover:text-[var(--text-primary)]">{customer.name || "Unnamed"}</p>
        <p className="text-xs text-muted-foreground">{customer.email}</p>
      </td>
      <td className="py-3">{money(customer.walletBalance)}</td>
      <td className="py-3">{customer._count.orders}</td>
      <td className="py-3 font-medium">{money(customer.serviceSpend ?? customer.paymentsTotal)}</td>
      <td className="py-3">{customer._count.supportTickets}</td>
      <td className="py-3"><StatusBadge status={customer.status} /></td>
      <td className="py-3">{new Date(customer.createdAt).toLocaleDateString()}</td>
      <td className="py-3" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-end gap-2">
          <Button asChild size="icon" variant="outline" title="View customer"><Link href={`/admin/customers/${customer.id}`}><Eye className="h-3.5 w-3.5" /></Link></Button>
          <Button size="icon" variant="outline" title="Edit customer" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onStatus}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {customer.status === "ACTIVE" ? "Suspend" : "Activate"}
          </Button>
          <Button size="icon" variant="destructive" title="Delete customer" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </td>
    </tr>
  )
})

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
