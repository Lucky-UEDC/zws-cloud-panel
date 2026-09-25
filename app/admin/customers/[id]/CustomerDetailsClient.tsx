"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type CustomerDetails = {
  id: string
  name: string | null
  email: string
  emailVerifiedAt?: string | null
  pendingEmail?: string | null
  phone: string | null
  company: string | null
  accountType?: "INDIVIDUAL" | "BUSINESS"
  status?: "ACTIVE" | "SUSPENDED" | "PENDING" | "BANNED" | "CLOSED"
  suspendedReason?: string | null
  suspendMessage?: string | null
  suspendUntil?: string | null
  internalNotes?: string | null
  walletBalance: number
  serviceSpend?: number
  paymentsTotal?: number
  creditLimit?: number
  createdAt?: string
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  gstin?: string | null
  panNumber?: string | null
  walletTransactions: Array<{
    id: string
    type: string
    amount: number
    balanceBefore: number
    balanceAfter: number
    status: string
    reason: string | null
    note: string | null
    createdAt: string
  }>
  payments: Array<{ id: string; amount: number; status: string; purpose: string; createdAt: string }>
  invoices: Array<{
    id: string
    invoiceNumber: string
    status: string
    totalAmount: number
    createdAt: string
    orderId?: string | null
    order?: { id: string; orderNumber: string; status: string; vpsInstance?: { id: string; name: string; vmid: number; status: string } | null } | null
  }>
  orders: Array<{
    id: string
    orderNumber: string
    status: string
    totalAmount: number
    createdAt: string
    invoices?: { id: string; invoiceNumber: string; status: string; totalAmount: number; deletedAt?: string | null } | null
    vpsInstance?: { id: string; name: string; vmid: number; status: string; ipAddress?: string | null; deletedAt?: string | null } | null
    dedicatedService?: { id: string; serviceNumber: string; status: string; primaryIp?: string | null } | null
    product?: { id: string; name: string } | null
    offer?: { id: string; name: string } | null
  }>
  supportTickets: Array<{ id: string; ticketNumber: string; subject: string; status: string; createdAt: string }>
  auditLogs?: Array<{
    id: string
    action: string
    oldValue: string | null
    newValue: string | null
    adminId: string
    createdAt: string
  }>
}

function normalizeCustomerDetails(input: Partial<CustomerDetails> | null | undefined): CustomerDetails | null {
  if (!input?.id) return null
  return {
    id: String(input.id),
    name: input.name ?? null,
    email: String(input.email || ""),
    emailVerifiedAt: input.emailVerifiedAt ?? null,
    pendingEmail: input.pendingEmail ?? null,
    phone: input.phone ?? null,
    company: input.company ?? null,
    accountType: input.accountType || "INDIVIDUAL",
    status: input.status || "ACTIVE",
    suspendedReason: input.suspendedReason ?? null,
    suspendMessage: input.suspendMessage ?? null,
    suspendUntil: input.suspendUntil ?? null,
    internalNotes: input.internalNotes ?? null,
    walletBalance: Number(input.walletBalance || 0),
    serviceSpend: Number(input.serviceSpend || 0),
    paymentsTotal: Number(input.paymentsTotal || 0),
    creditLimit: Number(input.creditLimit || 0),
    createdAt: input.createdAt,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    postalCode: input.postalCode ?? null,
    country: input.country ?? null,
    gstin: input.gstin ?? null,
    panNumber: input.panNumber ?? null,
    walletTransactions: Array.isArray(input.walletTransactions) ? input.walletTransactions : [],
    payments: Array.isArray(input.payments) ? input.payments : [],
    invoices: Array.isArray(input.invoices) ? input.invoices : [],
    orders: Array.isArray(input.orders) ? input.orders : [],
    supportTickets: Array.isArray(input.supportTickets) ? input.supportTickets : [],
    auditLogs: Array.isArray(input.auditLogs) ? input.auditLogs : [],
  }
}

export default function CustomerDetailsClient() {
  const params = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState("profile")
  const [customer, setCustomer] = useState<CustomerDetails | null>(null)
  const [loading, setLoading] = useState(true)

  const [walletForm, setWalletForm] = useState({ type: "admin_add" as "admin_add" | "admin_deduct", amount: "", reason: "", note: "" })
  const [statusForm, setStatusForm] = useState({ status: "ACTIVE", reason: "", message: "", suspendUntil: "", notifyUser: true })
  const [emailForm, setEmailForm] = useState({ type: "support", subject: "", message: "" })
  const [password, setPassword] = useState("")

  const [profileForm, setProfileForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    accountType: "INDIVIDUAL" as "INDIVIDUAL" | "BUSINESS",
  })
  const [creditLimit, setCreditLimit] = useState("")

  async function saveCreditLimit() {
    try {
      const res = await fetch(`/api/admin/customers/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "profile", creditLimit: Number(creditLimit) }),
      })
      if (!res.ok) throw new Error("Failed to update credit limit")
      toast.success("Credit limit updated")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed")
    }
  }

  const [addressForm, setAddressForm] = useState({
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
    gstin: "",
    panNumber: "",
  })

  const [notes, setNotes] = useState("")

  const auditExportUrl = useMemo(() => {
    if (!params.id) return "#"
    return `/api/admin/audit?customerId=${encodeURIComponent(params.id)}&format=csv`
  }, [params.id])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/customers/${params.id}`)
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to load customer")
      setLoading(false)
      return
    }

    const nextCustomer = normalizeCustomerDetails(data.customer)
    if (!nextCustomer) {
      if (Array.isArray(data.warnings) && data.warnings.length) toast.error(data.error || "Customer profile loaded with errors")
      setCustomer(null)
      setLoading(false)
      return
    }
    if (Array.isArray(data.warnings) && data.warnings.length) {
      toast.warning("Customer profile loaded with partial data")
    }
    setCustomer(nextCustomer)
    setProfileForm({
      name: nextCustomer.name || "",
      email: nextCustomer.email || "",
      phone: nextCustomer.phone || "",
      company: nextCustomer.company || "",
      accountType: nextCustomer.accountType || "INDIVIDUAL",
    })

    setAddressForm({
      addressLine1: nextCustomer.addressLine1 || "",
      addressLine2: nextCustomer.addressLine2 || "",
      city: nextCustomer.city || "",
      state: nextCustomer.state || "",
      postalCode: nextCustomer.postalCode || "",
      country: nextCustomer.country || "",
      gstin: nextCustomer.gstin || "",
      panNumber: nextCustomer.panNumber || "",
    })

    setStatusForm((prev) => ({
      ...prev,
      status: nextCustomer.status || "ACTIVE",
      reason: nextCustomer.suspendedReason || "",
      message: nextCustomer.suspendMessage || "",
      suspendUntil: nextCustomer.suspendUntil ? nextCustomer.suspendUntil.slice(0, 16) : "",
    }))

    setNotes(nextCustomer.internalNotes || "")
    setCreditLimit(String(nextCustomer.creditLimit || 0))
    setLoading(false)
  }, [params.id, setAddressForm, setCustomer, setLoading, setNotes, setProfileForm, setStatusForm])

  useEffect(() => {
    if (params.id) void load()
  }, [load, params.id])

  async function patch(section: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/admin/customers/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section, ...payload }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      throw new Error(data.error || "Update failed")
    }
    return data
  }

  async function saveProfile() {
    try {
      await patch("profile", { ...profileForm, internalNotes: notes })
      toast.success("Profile updated")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update profile")
    }
  }

  async function saveAddress() {
    try {
      await patch("address", addressForm)
      toast.success("Address updated")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update address")
    }
  }

  async function resetPassword() {
    if (!password || password.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    try {
      await patch("password", { password })
      toast.success("Password reset and notification sent")
      setPassword("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset password")
    }
  }

  async function submitAdjustment() {
    const parsed = Number(walletForm.amount)
    if (!parsed || parsed <= 0 || !walletForm.reason.trim()) {
      toast.error("Amount and reason are required")
      return
    }

    const res = await fetch(`/api/admin/customers/${params.id}/wallet-adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...walletForm, amount: parsed }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Adjustment failed")
      return
    }
    toast.success("Wallet updated")
    setWalletForm({ type: "admin_add", amount: "", reason: "", note: "" })
    await load()
  }

  async function updateStatus() {
    const res = await fetch(`/api/admin/customers/${params.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusForm),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Status update failed")
      return
    }
    toast.success("Account status updated")
    await load()
  }

  async function forceLogout() {
    const res = await fetch(`/api/admin/customers/${params.id}/force-logout`, { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to force logout")
      return
    }
    toast.success(data.message || "Force logout requested")
  }

  async function loginAsCustomer() {
    const res = await fetch(`/api/admin/customers/${params.id}/impersonation-token`, { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Unable to create impersonation link")
      return
    }
    toast.success("Impersonation link created")
    window.open(String(data.url), "_blank", "noopener,noreferrer")
  }

  async function invoiceAction(invoiceId: string, action: string) {
    const reason = action === "mark_paid" ? window.prompt("Reason for marking paid:") || "" : ""
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Invoice action failed")
      return
    }
    toast.success(data.result?.message || "Invoice updated")
    await load()
  }

  async function deleteInvoice(invoiceId: string) {
    const reason = window.prompt("Reason for deleting invoice:") || ""
    const res = await fetch(`/api/admin/invoices/${invoiceId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Invoice delete failed")
      return
    }
    toast.success("Invoice deleted")
    await load()
  }

  async function markEmailVerified() {
    const res = await fetch(`/api/admin/customers/${params.id}/verify-email`, { method: "POST" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to mark email verified")
      return
    }
    toast.success("Email marked verified")
    await load()
  }

  async function sendEmailToUser() {
    if (!emailForm.subject.trim() || !emailForm.message.trim()) {
      toast.error("Subject and message are required")
      return
    }

    const res = await fetch(`/api/admin/customers/${params.id}/communication`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailForm),
    })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) {
      toast.error(data.error || "Failed to send email")
      return
    }
    toast.success("Email sent")
    setEmailForm({ type: "support", subject: "", message: "" })
  }

  if (loading) return <p className="text-muted-foreground">Loading customer...</p>
  if (!customer) return <p className="text-red-500">Customer not found.</p>

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">{customer.name || "Customer"}</h1>
            <p className="text-muted-foreground">{customer.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={loginAsCustomer}>Login as Customer</Button>
            <Button variant="outline" onClick={() => setActiveTab("profile")}>Edit Customer</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Customer Info</CardTitle>
            <CardDescription>Joined {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : "-"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {customer.name || "-"}</p>
            <p><span className="text-muted-foreground">Email:</span> {customer.email}</p>
            <p><span className="text-muted-foreground">Email verified:</span> {customer.emailVerifiedAt ? new Date(customer.emailVerifiedAt).toLocaleString() : "No"}</p>
            <p><span className="text-muted-foreground">Phone:</span> {customer.phone || "-"}</p>
            <p><span className="text-muted-foreground">Status:</span> {customer.status || "ACTIVE"}</p>
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Wallet Balance</CardTitle>
            <CardDescription>Add credit or deduct credit from the Credits tab with a required reason.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-3xl font-semibold">₹{Number(customer.walletBalance || 0).toLocaleString("en-IN")}</p>
            <Button variant="outline" onClick={() => { setActiveTab("credits"); setWalletForm({ ...walletForm, type: "admin_add" }) }}>Add Credit</Button>
            <Button variant="outline" onClick={() => { setActiveTab("credits"); setWalletForm({ ...walletForm, type: "admin_deduct" }) }}>Deduct Credit</Button>
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
          <CardHeader>
            <CardTitle>Service Spend</CardTitle>
            <CardDescription>Paid service invoices for active, non-deleted services.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">₹{Number(customer.serviceSpend ?? customer.paymentsTotal ?? 0).toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto grid-cols-2 gap-2 lg:grid-cols-11">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="address">Address & Billing</TabsTrigger>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="audit">Notes & Audit</TabsTrigger>
          <TabsTrigger value="communication">Communication</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Profile & Identity</CardTitle>
              <CardDescription>Manage user identity and account-level fields.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Name" value={profileForm.name} onChange={(v) => setProfileForm({ ...profileForm, name: v })} />
              <Field label="Email" value={profileForm.email} onChange={(v) => setProfileForm({ ...profileForm, email: v })} />
              <Field label="Phone" value={profileForm.phone} onChange={(v) => setProfileForm({ ...profileForm, phone: v })} />
              <Field label="Company" value={profileForm.company} onChange={(v) => setProfileForm({ ...profileForm, company: v })} />
              <div className="space-y-2">
                <Label>Account Type</Label>
                <Select value={profileForm.accountType} onValueChange={(v) => setProfileForm({ ...profileForm, accountType: v as "INDIVIDUAL" | "BUSINESS" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                    <SelectItem value="BUSINESS">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reset Password</Label>
                <div className="flex gap-2">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" />
                  <Button type="button" variant="outline" onClick={resetPassword}>Reset</Button>
                </div>
              </div>
              {customer.pendingEmail ? <p className="text-xs text-amber-400 md:col-span-2">Pending email change: {customer.pendingEmail}</p> : null}
              <div className="space-y-2 md:col-span-2">
                <Label>Email Verification</Label>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/30 p-3 text-sm">
                  <span className="text-muted-foreground">
                    {customer.emailVerifiedAt ? `Verified ${new Date(customer.emailVerifiedAt).toLocaleString()}` : "Customer email is not verified."}
                  </span>
                  {!customer.emailVerifiedAt ? (
                    <Button type="button" variant="outline" size="sm" onClick={markEmailVerified}>
                      Mark email verified
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="md:col-span-2">
                <Button onClick={saveProfile}>Save Profile</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="address">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Address & Billing</CardTitle>
              <CardDescription>Billing identity fields with GST/PAN support.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Address Line 1" value={addressForm.addressLine1} onChange={(v) => setAddressForm({ ...addressForm, addressLine1: v })} />
              <Field label="Address Line 2" value={addressForm.addressLine2} onChange={(v) => setAddressForm({ ...addressForm, addressLine2: v })} />
              <Field label="City" value={addressForm.city} onChange={(v) => setAddressForm({ ...addressForm, city: v })} />
              <Field label="State" value={addressForm.state} onChange={(v) => setAddressForm({ ...addressForm, state: v })} />
              <Field label="Postal Code" value={addressForm.postalCode} onChange={(v) => setAddressForm({ ...addressForm, postalCode: v })} />
              <Field label="Country" value={addressForm.country} onChange={(v) => setAddressForm({ ...addressForm, country: v })} />
              <Field label="GSTIN" value={addressForm.gstin} onChange={(v) => setAddressForm({ ...addressForm, gstin: v })} />
              <Field label="PAN" value={addressForm.panNumber} onChange={(v) => setAddressForm({ ...addressForm, panNumber: v })} />
              <div className="md:col-span-2">
                <Button onClick={saveAddress}>Save Address</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="status">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Account Status</CardTitle>
              <CardDescription>Suspend, unsuspend, ban, or close account access.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusForm.status} onValueChange={(v) => setStatusForm({ ...statusForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="SUSPENDED">Suspended</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="BANNED">Banned</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field label="Reason" value={statusForm.reason} onChange={(v) => setStatusForm({ ...statusForm, reason: v })} />
              <div className="space-y-2 md:col-span-2">
                <Label>Custom Message</Label>
                <Textarea value={statusForm.message} onChange={(e) => setStatusForm({ ...statusForm, message: e.target.value })} />
              </div>
              <Field label="Suspend Until (optional)" type="datetime-local" value={statusForm.suspendUntil} onChange={(v) => setStatusForm({ ...statusForm, suspendUntil: v })} />
              <div className="flex items-end gap-2">
                <Button onClick={updateStatus}>Apply Status</Button>
                <Button variant="outline" onClick={forceLogout}>Force Logout</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="glass border-border/40">
              <CardHeader>
                <CardTitle>Wallet & Limits</CardTitle>
                <CardDescription>Adjust user credit balance with reason.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xl font-semibold">Balance: ₹{Number(customer.walletBalance || 0).toLocaleString("en-IN")}</p>
                <div className="space-y-2">
              <Label>Credit Limit (₹)</Label>
              <div className="flex gap-2">
                <Input type="number" value={customer.creditLimit || 0} onChange={(e) => setCreditLimit(e.target.value)} />
                <Button variant="outline" size="sm" onClick={saveCreditLimit}>Update</Button>
              </div>
            </div>


                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={walletForm.type} onValueChange={(v: "admin_add" | "admin_deduct") => setWalletForm({ ...walletForm, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin_add">Admin Add</SelectItem>
                      <SelectItem value="admin_deduct">Admin Deduct</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Amount" value={walletForm.amount} onChange={(v) => setWalletForm({ ...walletForm, amount: v })} />
                <Field label="Reason" value={walletForm.reason} onChange={(v) => setWalletForm({ ...walletForm, reason: v })} />
                <div className="space-y-2">
                  <Label>Note</Label>
                  <Textarea value={walletForm.note} onChange={(e) => setWalletForm({ ...walletForm, note: e.target.value })} />
                </div>
                <Button onClick={submitAdjustment}>Apply Adjustment</Button>
              </CardContent>
            </Card>

            <Card className="glass border-border/40">
              <CardHeader>
                <CardTitle>Recent Payments & Invoices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-medium">Payments</p>
                {customer.payments.slice(0, 5).map((p) => (
                  <div key={p.id} className="rounded border border-border/30 px-3 py-2">
                    ₹{Number(p.amount).toLocaleString("en-IN")} • {p.status} • {p.purpose}
                  </div>
                ))}
                <p className="pt-2 font-medium">Invoices</p>
                {customer.invoices.slice(0, 5).map((inv) => (
                  <div key={inv.id} className="rounded border border-border/30 px-3 py-2">
                    {inv.invoiceNumber} • {inv.status} • ₹{Number(inv.totalAmount).toLocaleString("en-IN")}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="glass mt-4 border-border/40">
            <CardHeader>
              <CardTitle>Wallet History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="py-2">Time</th>
                      <th className="py-2">Type</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Before</th>
                      <th className="py-2">After</th>
                      <th className="py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.walletTransactions.map((t) => (
                      <tr key={t.id} className="border-b border-border/20">
                        <td className="py-2">{new Date(t.createdAt).toLocaleString()}</td>
                        <td className="py-2">{t.type}</td>
                        <td className="py-2">₹{Number(t.amount).toLocaleString("en-IN")}</td>
                        <td className="py-2">₹{Number(t.balanceBefore).toLocaleString("en-IN")}</td>
                        <td className="py-2">₹{Number(t.balanceAfter).toLocaleString("en-IN")}</td>
                        <td className="py-2">{t.reason || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Notes & Audit</CardTitle>
              <CardDescription>Internal notes and activity history.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Internal Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveProfile}>Save Notes</Button>
                <Button asChild variant="outline">
                  <a href={auditExportUrl}>Export CSV</a>
                </Button>
              </div>
              <div className="space-y-2 pt-2">
                {(customer.auditLogs || []).map((log) => (
                  <div key={log.id} className="rounded border border-border/30 px-3 py-2 text-sm">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()} • {log.adminId}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Orders</CardTitle><CardDescription>All recent orders for this customer.</CardDescription></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="py-2">Order</th>
                      <th className="py-2">Product</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Created</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orders.map((order) => {
                      const invoice = order.invoices && !order.invoices.deletedAt ? order.invoices : null
                      const vps = order.vpsInstance && !order.vpsInstance.deletedAt ? order.vpsInstance : null
                      return (
                        <tr key={order.id} className="border-b border-border/20">
                          <td className="py-3 font-medium">{order.orderNumber}</td>
                          <td className="py-3">{order.offer?.name || order.product?.name || "Custom service"}</td>
                          <td className="py-3">₹{Number(order.totalAmount).toLocaleString("en-IN")}</td>
                          <td className="py-3"><Badge variant="outline">{order.status}</Badge></td>
                          <td className="py-3">{new Date(order.createdAt).toLocaleString()}</td>
                          <td className="py-3">
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button size="sm" variant="outline" asChild><a href={`/admin/orders?search=${encodeURIComponent(order.orderNumber)}&focus=${encodeURIComponent(order.id)}`}>View</a></Button>
                              <Button size="sm" variant="outline" asChild><a href={`/admin/orders?search=${encodeURIComponent(order.orderNumber)}&focus=${encodeURIComponent(order.id)}`}>Manage</a></Button>
                              {vps ? <Button size="sm" variant="outline" asChild><a href={`/admin/vms/${vps.id}`}>Open VM</a></Button> : null}
                              {invoice ? <Button size="sm" variant="outline" asChild><a href={`/invoice/${invoice.invoiceNumber}`}>Open Invoice</a></Button> : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {!customer.orders.length ? <tr><td className="py-8 text-center text-muted-foreground" colSpan={6}>No orders found.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>Detailed billing history and invoice management.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-left text-muted-foreground">
                      <th className="py-2">Invoice #</th>
                      <th className="py-2">Amount</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Created</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-border/20">
                        <td className="py-3 font-medium">{inv.invoiceNumber}</td>
                        <td className="py-3">₹{Number(inv.totalAmount).toLocaleString("en-IN")}</td>
                        <td className="py-3">
                          <Badge variant={inv.status === "paid" ? "default" : "outline"}>{inv.status}</Badge>
                        </td>
                        <td className="py-3">{new Date(inv.createdAt).toLocaleDateString()}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button size="sm" variant="outline" asChild><a href={`/invoice/${inv.invoiceNumber}`}>View Invoice</a></Button>
                            <Button size="sm" variant="outline" asChild><a href={`/admin/customers/${customer.id}/invoices/${inv.id}/edit`}>Edit Invoice</a></Button>
                            <Button size="sm" variant="outline" asChild><a href={`/api/admin/invoices/${inv.id}/download`}>Download</a></Button>
                            {inv.status !== "paid" ? <Button size="sm" onClick={() => invoiceAction(inv.id, "mark_paid")}>Mark Paid</Button> : null}
                            <Button size="sm" variant="destructive" onClick={() => deleteInvoice(inv.id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!customer.invoices.length && (
                      <tr>
                        <td className="py-8 text-center text-muted-foreground" colSpan={5}>No invoices found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tickets">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Tickets</CardTitle><CardDescription>Support ticket history.</CardDescription></CardHeader>
            <CardContent><SimpleTable headers={["Ticket", "Subject", "Status", "Created"]} rows={customer.supportTickets.map((t) => [t.ticketNumber, t.subject, t.status, new Date(t.createdAt).toLocaleString()])} /></CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Activity Log</CardTitle><CardDescription>Admin changes and account events. Login history is shown here when recorded.</CardDescription></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(customer.auditLogs || []).map((log) => (
                  <div key={log.id} className="rounded border border-border/30 px-3 py-2 text-sm">
                    <p className="font-medium">{log.action}</p>
                    <p className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()} • {log.adminId}</p>
                  </div>
                ))}
                {!(customer.auditLogs || []).length ? <p className="text-sm text-muted-foreground">No activity recorded.</p> : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communication">
          <Card className="glass border-border/40">
            <CardHeader>
              <CardTitle>Communication</CardTitle>
              <CardDescription>Send direct email updates to this customer.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>From Class</Label>
                <Select value={emailForm.type} onValueChange={(v) => setEmailForm({ ...emailForm, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">Support</SelectItem>
                    <SelectItem value="billing">Billing</SelectItem>
                    <SelectItem value="accounts">Accounts</SelectItem>
                    <SelectItem value="noreply">No-reply</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field label="Subject" value={emailForm.subject} onChange={(v) => setEmailForm({ ...emailForm, subject: v })} />
              <div className="space-y-2 md:col-span-2">
                <Label>Message</Label>
                <Textarea rows={8} value={emailForm.message} onChange={(e) => setEmailForm({ ...emailForm, message: e.target.value })} />
              </div>
              <div>
                <Button onClick={sendEmailToUser}>Send Email</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border/40 text-left text-muted-foreground">
            {headers.map((header) => <th key={header} className="py-2">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border/20">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="py-2">{cell}</td>)}
            </tr>
          ))}
          {!rows.length ? (
            <tr><td className="py-8 text-center text-muted-foreground" colSpan={headers.length}>No records found.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
