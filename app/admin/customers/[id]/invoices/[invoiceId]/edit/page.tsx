"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Trash2 } from "lucide-react"

export default function EditInvoicePage() {
  const params = useParams<{ id: string; invoiceId: string }>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [invoice, setInvoice] = useState<any>(null)
  const [lineItems, setLineItems] = useState<any[]>([])
  const [form, setForm] = useState({
    status: "draft",
    dueDate: "",
    issueDate: "",
    discount: "0",
    taxRate: "18",
    recurringCycle: "monthly",
    notes: "",
    invoiceNumber: "",
    currency: "INR",
    paidAt: "",
  })

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/admin/invoices/${params.invoiceId}`)
        const data = await readJsonResponse<any>(res)
        if (res.ok) {
          setInvoice(data.invoice)
          setForm({
            status: data.invoice.status,
            dueDate: data.invoice.dueDate ? String(data.invoice.dueDate).slice(0, 10) : "",
            issueDate: data.invoice.issueDate ? String(data.invoice.issueDate).slice(0, 10) : "",
            discount: String(data.invoice.discountAmount || "0"),
            taxRate: String(data.invoice.taxRate || data.invoice.gstPercent || "18"),
            recurringCycle: String(data.invoice.metadata?.recurringCycle || data.invoice.order?.billingCycle || "monthly"),
            notes: data.invoice.notes || "",
            invoiceNumber: String(data.invoice.invoiceNumber || ""),
            currency: String(data.invoice.currency || "INR"),
            paidAt: data.invoice.paidAt ? String(data.invoice.paidAt).slice(0, 10) : "",
          })
          // Handle lineItems if they are stored as JSON string
          const items = typeof data.invoice.lineItems === "string"
            ? JSON.parse(data.invoice.lineItems)
            : data.invoice.lineItems
          setLineItems(items || [])
        }
      } catch (e) {
        toast.error("Failed to load invoice")
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params.invoiceId])

  const calculateTotals = () => {
    let subtotal = 0
    let taxTotal = 0
    lineItems.forEach(item => {
      const qty = Number(item.quantity || 0)
      const price = Number(item.unitPrice || 0)
      const tax = Number(item.taxPercent || form.taxRate || 18)
      subtotal += qty * price
      taxTotal += (qty * price) * (tax / 100)
    })
    const total = subtotal + taxTotal - Number(form.discount || 0)
    return { subtotal, taxTotal, total }
  }

  const { subtotal, taxTotal, total } = calculateTotals()

  async function handleSave() {
    setSaving(true)
    try {
      const normalizedItems = lineItems.map((item) => ({ ...item, taxPercent: Number(item.taxPercent || form.taxRate || 18) }))
      const res = await fetch(`/api/admin/invoices/${params.invoiceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          lineItems: normalizedItems,
          metadata: { ...((invoice?.metadata && typeof invoice.metadata === "object") ? invoice.metadata : {}), recurringCycle: form.recurringCycle },
          dueDate: form.dueDate || invoice?.dueDate,
          issueDate: form.issueDate || invoice?.issueDate,
        }),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success("Invoice updated successfully")
    } catch (e) {
      toast.error("Error saving invoice")
    } finally {
      setSaving(false)
    }
  }

  async function handleForceDelete() {
    const confirmText = window.prompt('This permanently deletes the invoice (including paid ones) and its payment records. It does NOT touch the VM/service. Type "DELETE" to confirm.')
    if (String(confirmText || "").trim().toUpperCase() !== "DELETE") return
    const reason = window.prompt("Reason for deletion (optional):") || ""
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/invoices/${params.invoiceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, confirm: "DELETE", reason }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to delete invoice")
      toast.success("Invoice deleted")
      window.history.back()
    } catch (e: any) {
      toast.error(e?.message || "Error deleting invoice")
    } finally {
      setSaving(false)
    }
  }

  function addLineItem() {
    setLineItems([...lineItems, { description: "", quantity: 1, unitPrice: 0, taxPercent: Number(form.taxRate || 18) }])
  }

  function removeLineItem(index: number) {
    setLineItems(lineItems.filter((_, i) => i !== index))
  }

  function updateLineItem(index: number, field: string, value: any) {
    const newItems = [...lineItems]
    newItems[index] = { ...newItems[index], [field]: value }
    setLineItems(newItems)
  }

  if (loading) return <div className="p-10 text-center">Loading invoice...</div>

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Edit Invoice #{invoice?.invoiceNumber}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.history.back()}>Back</Button>
          <Button variant="destructive" onClick={handleForceDelete} disabled={saving}>Delete</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Invoice"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Product</CardTitle>
            <CardDescription>{invoice?.order?.product?.name || invoice?.order?.offer?.name || "Custom invoice items"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="pb-2">Description</th>
                    <th className="pb-2 w-20">Qty</th>
                    <th className="pb-2 w-32">Price</th>
                    <th className="pb-2 w-20">Tax%</th>
                    <th className="pb-2 w-24 text-right">Total</th>
                    <th className="pb-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="py-2 pr-2">
                        <Input value={item.description} onChange={e => updateLineItem(idx, "description", e.target.value)} />
                      </td>
                      <td className="py-2 pr-2">
                        <Input type="number" value={item.quantity} onChange={e => updateLineItem(idx, "quantity", e.target.value)} />
                      </td>
                      <td className="py-2 pr-2">
                        <Input type="number" value={item.unitPrice} onChange={e => updateLineItem(idx, "unitPrice", e.target.value)} />
                      </td>
                      <td className="py-2 pr-2">
                        <Input type="number" value={item.taxPercent} onChange={e => updateLineItem(idx, "taxPercent", e.target.value)} />
                      </td>
                      <td className="py-2 text-right font-medium">
                        ₹{(Number(item.quantity) * Number(item.unitPrice) * (1 + Number(item.taxPercent)/100)).toFixed(2)}
                      </td>
                      <td className="py-2 pl-2">
                        <Button variant="ghost" size="sm" onClick={() => removeLineItem(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addLineItem}>
              <Plus className="h-4 w-4" /> Add Line Item
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent / Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Invoice Number</Label>
                <Input value={form.invoiceNumber} onChange={e => setForm({...form, invoiceNumber: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Input value={form.currency} onChange={e => setForm({...form, currency: e.target.value.toUpperCase()})} />
              </div>
            </div>
            {form.status === "paid" && (
              <div className="space-y-2">
                <Label>Paid Date</Label>
                <Input type="date" value={form.paidAt} onChange={e => setForm({...form, paidAt: e.target.value})} />
              </div>
            )}
            <div className="grid gap-4 grid-cols-2">
              <div className="space-y-2">
                <Label>Issue Date</Label>
                <Input type="date" value={form.issueDate} onChange={e => setForm({...form, issueDate: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Discount</Label>
              <Input type="number" value={form.discount} onChange={e => setForm({...form, discount: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Tax</Label>
              <Input type="number" value={form.taxRate} onChange={e => setForm({...form, taxRate: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Recurring Settings</Label>
              <Select value={form.recurringCycle} onValueChange={v => setForm({...form, recurringCycle: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>

            <div className="pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax (GST)</span>
                <span>₹{taxTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Discount</span>
                <span className="text-destructive">- ₹{Number(form.discount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t">
                <span>Total</span>
                <span>₹{total.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">{invoice?.customer?.name || "Customer"}</p>
            <p className="text-muted-foreground">{invoice?.customer?.email}</p>
            <p className="text-muted-foreground">{invoice?.customer?.phone || "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Billing Address</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>{invoice?.billingAddress?.addressLine1 || invoice?.customer?.addressLine1 || "-"}</p>
            <p>{invoice?.billingAddress?.city || invoice?.customer?.city || "-"}, {invoice?.billingAddress?.state || invoice?.customer?.state || "-"}</p>
            <p>{invoice?.billingAddress?.postalCode || invoice?.customer?.postalCode || "-"} {invoice?.billingAddress?.country || invoice?.customer?.country || ""}</p>
            <p>GST: {invoice?.billingAddress?.gstin || invoice?.customer?.gstin || "-"}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
