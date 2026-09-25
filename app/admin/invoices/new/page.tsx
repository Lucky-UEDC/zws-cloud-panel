"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

type Customer = {
  id: string
  email: string
  name?: string | null
  phone?: string | null
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  gstin?: string | null
  walletBalance?: number
}

type Product = {
  id: string
  name: string
  cpuCores: number
  ramGb: number
  storageGb: number
  bandwidthTb: number
  price1m: number
  price3m?: number | null
  price6m?: number | null
  price12m?: number | null
  backupEnabled?: boolean
  backupPrice?: number
  snapshotEnabled?: boolean
  snapshotPrice?: number
  extraIpv4Price?: number
}

const cycles = [
  ["monthly", "Monthly", 1],
  ["quarterly", "Quarterly", 3],
  ["semi_annual", "Semi Annual", 6],
  ["annual", "Annual", 12],
] as const

function money(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
}

function termForCycle(value: string) {
  return cycles.find((cycle) => cycle[0] === value)?.[2] || 1
}

export default function AdminNewInvoicePage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [customerQuery, setCustomerQuery] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [productMode, setProductMode] = useState<"existing" | "custom">("existing")
  const [productId, setProductId] = useState("")
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "paid">("pending")
  const [billingCycle, setBillingCycle] = useState("monthly")
  const [discount, setDiscount] = useState("0")
  const [taxRate, setTaxRate] = useState("18")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState({
    cpuCores: "2",
    ramGb: "4",
    diskGb: "80",
    bandwidthTb: "1",
    os: "Ubuntu",
    ipv4Count: "1",
    backupSlots: "0",
    snapshots: "0",
    actualCost: "0",
    sellingPrice: "999",
  })

  useEffect(() => {
    ;(async () => {
      const [customersRes, productsRes] = await Promise.all([
        fetch("/api/admin/customers?pageSize=200"),
        fetch("/api/admin/products?state=active"),
      ])
      const [customersBody, productsBody] = await Promise.all([readJsonResponse<any>(customersRes), readJsonResponse<any>(productsRes)])
      if (customersRes.ok) setCustomers(customersBody.customers || [])
      if (productsRes.ok) setProducts(productsBody.products || [])
    })().catch((error) => toast.error(error?.message || "Failed to load invoice data"))
  }, [])

  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const selectedProduct = products.find((product) => product.id === productId)
  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase()
    if (!q) return customers.slice(0, 30)
    return customers.filter((customer) => [customer.name, customer.email, customer.phone].some((value) => String(value || "").toLowerCase().includes(q))).slice(0, 30)
  }, [customers, customerQuery])
  const termMonths = termForCycle(billingCycle)
  const productMonthly = productMode === "existing"
    ? Number((selectedProduct as any)?.[`price${termMonths}m`] || selectedProduct?.price1m || 0)
    : Number(custom.sellingPrice || 0)
  const base = productMonthly * termMonths
  const addOns = productMode === "existing" && selectedProduct
    ? Number(selectedProduct.backupEnabled ? selectedProduct.backupPrice || 0 : 0) + Number(selectedProduct.snapshotEnabled ? selectedProduct.snapshotPrice || 0 : 0) + Math.max(0, Number(custom.ipv4Count || 1) - 1) * Number(selectedProduct.extraIpv4Price || 0)
    : Math.max(0, Number(custom.ipv4Count || 1) - 1) * 0
  const subtotal = Math.max(0, base + addOns)
  const discountAmount = Math.min(subtotal, Math.max(0, Number(discount || 0)))
  const taxable = Math.max(0, subtotal - discountAmount)
  const taxAmount = Number((taxable * (Number(taxRate || 0) / 100)).toFixed(2))
  const total = Number((taxable + taxAmount).toFixed(2))
  const invoiceNumber = `INV-MANUAL-${Date.now()}`

  async function createInvoice() {
    if (!customerId) return toast.error("Select a customer")
    if (productMode === "existing" && !productId) return toast.error("Select a product")
    if (total <= 0) return toast.error("Invoice total must be positive")
    setSaving(true)
    try {
      const description = productMode === "existing" ? selectedProduct?.name || "Product" : "Custom Product"
      const lineItems = [
        {
          description,
          quantity: 1,
          unitPrice: subtotal,
          taxPercent: Number(taxRate || 0),
          termMonths,
          total: subtotal,
          productMode,
          ...(productMode === "existing" && selectedProduct ? {
            cpu: selectedProduct.cpuCores,
            ram: selectedProduct.ramGb,
            disk: selectedProduct.storageGb,
            bandwidth: selectedProduct.bandwidthTb,
            backup: selectedProduct.backupEnabled,
            snapshot: selectedProduct.snapshotEnabled,
          } : custom),
        },
      ]
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber,
          customerId,
          productMode,
          productId: productMode === "existing" ? productId : null,
          customProduct: productMode === "custom" ? custom : { ...custom, ipv4Count: custom.ipv4Count },
          paymentStatus,
          billingCycle,
          termMonths,
          subtotal,
          discountAmount,
          taxRate: Number(taxRate || 0),
          taxAmount,
          totalAmount: total,
          lineItems,
          notes,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Failed to create invoice")
      toast.success(paymentStatus === "paid" ? "Paid invoice and order created" : "Pending invoice created")
      router.push(data.order?.id ? `/admin/orders?search=${encodeURIComponent(data.order.orderNumber)}&focus=${encodeURIComponent(data.order.id)}` : "/admin/invoices")
    } catch (error: any) {
      toast.error(error?.message || "Failed to create invoice")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Create Invoice</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search a customer, choose an existing or custom product, then create a pending or paid invoice.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Step 1 · Customer</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Search Name, Email, Phone</Label>
                <Input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Start typing customer details" />
              </div>
              <Select value={customerId || "none"} onValueChange={(value) => setCustomerId(value === "none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select customer</SelectItem>
                  {filteredCustomers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.name || customer.email} · {customer.email}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedCustomer ? (
                <div className="grid gap-2 rounded-md border border-border/40 p-3 text-sm md:grid-cols-2">
                  <p><span className="text-muted-foreground">Name:</span> {selectedCustomer.name || "-"}</p>
                  <p><span className="text-muted-foreground">Email:</span> {selectedCustomer.email}</p>
                  <p><span className="text-muted-foreground">Address:</span> {[selectedCustomer.addressLine1, selectedCustomer.city, selectedCustomer.state, selectedCustomer.postalCode].filter(Boolean).join(", ") || "-"}</p>
                  <p><span className="text-muted-foreground">GST:</span> {selectedCustomer.gstin || "-"}</p>
                  <p><span className="text-muted-foreground">Wallet:</span> {money(Number(selectedCustomer.walletBalance || 0))}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Step 2 · Invoice Type</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <SelectField label="Invoice Type" value={productMode} onChange={(value) => setProductMode(value as "existing" | "custom")} options={[["existing", "Existing Product"], ["custom", "Custom Product"]]} />
              <SelectField label="Billing Cycle" value={billingCycle} onChange={setBillingCycle} options={cycles.map((cycle) => [cycle[0], cycle[1]])} />
              {productMode === "existing" ? (
                <>
                  <SelectField label="Product" value={productId} onChange={setProductId} options={[["", "Select product"], ...products.map((product) => [product.id, product.name] as [string, string])]} />
                  {selectedProduct ? <ProductSnapshot product={selectedProduct} /> : null}
                </>
              ) : (
                <>
                  <Field label="CPU" value={custom.cpuCores} onChange={(value) => setCustom({ ...custom, cpuCores: value })} />
                  <Field label="RAM (GB)" value={custom.ramGb} onChange={(value) => setCustom({ ...custom, ramGb: value })} />
                  <Field label="Disk (GB)" value={custom.diskGb} onChange={(value) => setCustom({ ...custom, diskGb: value })} />
                  <Field label="Bandwidth (TB)" value={custom.bandwidthTb} onChange={(value) => setCustom({ ...custom, bandwidthTb: value })} />
                  <Field label="OS" value={custom.os} onChange={(value) => setCustom({ ...custom, os: value })} />
                  <Field label="IPv4 Count" value={custom.ipv4Count} onChange={(value) => setCustom({ ...custom, ipv4Count: value })} />
                  <Field label="Backup Slots" value={custom.backupSlots} onChange={(value) => setCustom({ ...custom, backupSlots: value })} />
                  <Field label="Snapshots" value={custom.snapshots} onChange={(value) => setCustom({ ...custom, snapshots: value })} />
                  <Field label="Actual Cost" value={custom.actualCost} onChange={(value) => setCustom({ ...custom, actualCost: value })} />
                  <Field label="Selling Price" value={custom.sellingPrice} onChange={(value) => setCustom({ ...custom, sellingPrice: value })} />
                </>
              )}
            </CardContent>
          </Card>

          <Card className="glass border-border/40">
            <CardHeader><CardTitle>Step 3 · Payment Status</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <SelectField label="Payment Status" value={paymentStatus} onChange={(value) => setPaymentStatus(value as "pending" | "paid")} options={[["pending", "Pending"], ["paid", "Paid"]]} />
              <Field label="Discount" value={discount} onChange={setDiscount} />
              <Field label="Tax Percent" value={taxRate} onChange={setTaxRate} />
              <div className="space-y-2 md:col-span-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="glass h-fit border-border/40">
          <CardHeader><CardTitle>Live Totals</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Base Price" value={money(base)} />
            <Row label="Add-ons" value={money(addOns)} />
            <Row label="Discount" value={`-${money(discountAmount)}`} />
            <Row label="Tax" value={money(taxAmount)} />
            <div className="border-t pt-3">
              <Row label="Total" value={money(total)} strong />
            </div>
            <Badge variant={paymentStatus === "paid" ? "default" : "outline"}>{paymentStatus === "paid" ? "Creates order and starts provisioning when ready" : "Sends payment link; order after payment"}</Badge>
            <Button className="w-full" onClick={createInvoice} disabled={saving}>{saving ? "Creating..." : paymentStatus === "paid" ? "Create Paid Invoice" : "Create Invoice"}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} /></div>
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value || "none"} onValueChange={(next) => onChange(next === "none" ? "" : next)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([key, labelText]) => <SelectItem key={key || "none"} value={key || "none"}>{labelText}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

function ProductSnapshot({ product }: { product: Product }) {
  return (
    <div className="grid gap-2 rounded-md border border-border/40 p-3 text-sm md:col-span-2 md:grid-cols-4">
      <p>CPU: {product.cpuCores}</p>
      <p>RAM: {product.ramGb} GB</p>
      <p>Disk: {product.storageGb} GB</p>
      <p>Bandwidth: {Number(product.bandwidthTb)} TB</p>
      <p>Backup: {product.backupEnabled ? money(Number(product.backupPrice || 0)) : "Disabled"}</p>
      <p>Snapshot: {product.snapshotEnabled ? money(Number(product.snapshotPrice || 0)) : "Disabled"}</p>
      <p>IPv4 extra: {money(Number(product.extraIpv4Price || 0))}</p>
      <p>Monthly: {money(Number(product.price1m || 0))}</p>
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? "text-lg font-semibold" : ""}`}><span className="text-muted-foreground">{label}</span><span>{value}</span></div>
}
