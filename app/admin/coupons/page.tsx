"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Coupon = {
  id: string
  code: string
  discountType: "PERCENTAGE" | "FIXED"
  discountValue: number
  active: boolean
  usageCount: number
  usageLimit: number | null
  timesUsed?: number
  revenueImpact?: number
  discountGiven?: number
  remainingUses?: number | null
  customerUsage?: number
  lastUsed?: string | null
  duration?: string
}

type ProductOption = { id: string; name: string; slug: string }

export default function CouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    code: "",
    discountType: "FIXED",
    discountValue: "500",
    minOrderAmount: "",
    maxDiscountAmount: "",
    usageLimit: "",
    usageLimitPerUser: "",
    applicableProducts: "",
    applicableProductGroups: "",
    applicableBillingTerms: "",
    duration: "FIRST_INVOICE_ONLY",
    durationCycles: "",
  })

  async function loadCoupons() {
    setLoading(true)
    try {
      const r = await fetch("/api/admin/coupons")
      const body = await readJsonResponse<any>(r)
      if (!r.ok) throw new Error(body?.error || "Failed to load coupons")
      setCoupons(Array.isArray(body) ? body : [])
    } catch (e: any) {
      toast.error(e?.message || "Failed to load coupons")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCoupons()
    fetch("/api/admin/products?state=active", { cache: "no-store" })
      .then((res) => readJsonResponse<any>(res))
      .then((body) => setProducts(Array.isArray(body?.products) ? body.products.map((product: any) => ({ id: String(product.id), name: String(product.name), slug: String(product.slug || "") })) : []))
      .catch(() => setProducts([]))
  }, [])

  async function createCoupon(e: React.FormEvent) {
    e.preventDefault()
    try {
      const r = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          discountValue: Number(form.discountValue || 0),
          minOrderAmount: form.minOrderAmount || null,
          maxDiscountAmount: form.maxDiscountAmount || null,
          usageLimit: form.usageLimit || null,
          usageLimitPerUser: form.usageLimitPerUser || null,
          applicableProducts: form.applicableProducts.split(",").map((value) => value.trim()).filter(Boolean),
          applicableProductGroups: form.applicableProductGroups.split(",").map((value) => value.trim()).filter(Boolean),
          applicableBillingTerms: form.applicableBillingTerms.split(",").map((value) => value.trim()).filter(Boolean),
          duration: form.duration,
          durationCycles: form.durationCycles || null,
          active: true,
        }),
      })
      const body = await readJsonResponse<any>(r)
      if (!r.ok) throw new Error(body?.error || "Failed to create coupon")
      toast.success("Coupon created")
      setForm({
        code: "",
        discountType: "FIXED",
        discountValue: "500",
        minOrderAmount: "",
        maxDiscountAmount: "",
        usageLimit: "",
        usageLimitPerUser: "",
        applicableProducts: "",
        applicableProductGroups: "",
        applicableBillingTerms: "",
        duration: "FIRST_INVOICE_ONLY",
        durationCycles: "",
      })
      await loadCoupons()
    } catch (e: any) {
      toast.error(e?.message || "Failed to create coupon")
    }
  }

  async function toggleCoupon(coupon: Coupon) {
    try {
      const r = await fetch(`/api/admin/coupons/${coupon.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...coupon,
          active: !coupon.active,
        }),
      })
      const body = await readJsonResponse<any>(r)
      if (!r.ok) throw new Error(body?.error || "Failed to update coupon")
      await loadCoupons()
    } catch (e: any) {
      toast.error(e?.message || "Failed to update coupon")
    }
  }

  async function deleteCoupon(id: string) {
    if (!confirm("Delete this coupon?")) return
    const r = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" })
    if (!r.ok) {
      const body = await readJsonResponse<any>(r) || {}
      toast.error(body?.error || "Failed to delete coupon")
      return
    }
    toast.success("Coupon deleted")
    await loadCoupons()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Coupons</h1>
        <p className="mt-1 text-muted-foreground">Create and manage discount coupons.</p>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Create Coupon</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={createCoupon}>
            <Field label="Code" value={form.code} onChange={(v) => setForm((s) => ({ ...s, code: v }))} />
            <div className="space-y-2">
              <Label>Type</Label>
              <select className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm" value={form.discountType} onChange={(e) => setForm((s) => ({ ...s, discountType: e.target.value as any }))}>
                <option value="FIXED">Fixed Amount</option>
                <option value="PERCENTAGE">Percentage</option>
              </select>
            </div>
            <Field label="Value" value={form.discountValue} onChange={(v) => setForm((s) => ({ ...s, discountValue: v }))} type="number" />
            <Field label="Min Order" value={form.minOrderAmount} onChange={(v) => setForm((s) => ({ ...s, minOrderAmount: v }))} type="number" />
            <Field label="Max Discount" value={form.maxDiscountAmount} onChange={(v) => setForm((s) => ({ ...s, maxDiscountAmount: v }))} type="number" />
            <Field label="Usage Limit" value={form.usageLimit} onChange={(v) => setForm((s) => ({ ...s, usageLimit: v }))} type="number" />
            <Field label="Per User Limit" value={form.usageLimitPerUser} onChange={(v) => setForm((s) => ({ ...s, usageLimitPerUser: v }))} type="number" />
            <div className="space-y-2 md:col-span-2">
              <Label>Applicable Products</Label>
              <div className="max-h-40 overflow-auto rounded-md border border-border/40 p-2">
                {products.map((product) => {
                  const selected = form.applicableProducts.split(",").map((value) => value.trim()).filter(Boolean).includes(product.id)
                  return (
                    <label key={product.id} className="flex items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => setForm((current) => {
                          const ids = new Set(current.applicableProducts.split(",").map((value) => value.trim()).filter(Boolean))
                          if (event.target.checked) ids.add(product.id)
                          else ids.delete(product.id)
                          return { ...current, applicableProducts: Array.from(ids).join(",") }
                        })}
                      />
                      <span>{product.name}</span>
                      <span className="text-xs text-muted-foreground">{product.slug}</span>
                    </label>
                  )
                })}
                {!products.length ? <p className="text-xs text-muted-foreground">No active products found.</p> : null}
              </div>
            </div>
            <Field label="Applicable Product Groups" value={form.applicableProductGroups} onChange={(v) => setForm((s) => ({ ...s, applicableProductGroups: v }))} />
            <Field label="Billing Terms" value={form.applicableBillingTerms} onChange={(v) => setForm((s) => ({ ...s, applicableBillingTerms: v }))} />
            <div className="space-y-2">
              <Label>Duration</Label>
              <select className="h-10 w-full rounded-md border border-border/40 bg-background px-3 text-sm" value={form.duration} onChange={(e) => setForm((s) => ({ ...s, duration: e.target.value }))}>
                <option value="FIRST_INVOICE_ONLY">First Invoice Only</option>
                <option value="EVERY_RENEWAL">Every Renewal</option>
                <option value="CUSTOM_CYCLES">Custom Billing Cycles</option>
              </select>
            </div>
            {form.duration === "CUSTOM_CYCLES" ? <Field label="Billing Cycles" value={form.durationCycles} onChange={(v) => setForm((s) => ({ ...s, durationCycles: v }))} type="number" /> : null}
            <div className="flex items-end">
              <Button type="submit" className="w-full">Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Coupon List</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/30 text-left">
                    <th className="py-2">Code</th><th>Type</th><th>Value</th><th>Duration</th><th>Used</th><th>Discount Given</th><th>Remaining</th><th>Customers</th><th>Last Used</th><th>Status</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <tr key={coupon.id} className="border-b border-border/20">
                      <td className="py-2 font-semibold">{coupon.code}</td>
                      <td>{coupon.discountType === "PERCENTAGE" ? "Percentage" : "Fixed Amount"}</td>
                      <td>{coupon.discountValue}</td>
                      <td>{durationLabel(coupon.duration)}</td>
                      <td>{coupon.timesUsed ?? coupon.usageCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}</td>
                      <td>₹{Number(coupon.discountGiven ?? (coupon.revenueImpact || 0)).toLocaleString("en-IN")}</td>
                      <td>{coupon.remainingUses ?? "Unlimited"}</td>
                      <td>{coupon.customerUsage || 0}</td>
                      <td>{coupon.lastUsed ? new Date(coupon.lastUsed).toLocaleString() : "-"}</td>
                      <td>{coupon.active ? "Active" : "Disabled"}</td>
                      <td className="text-right space-x-2">
                        <Button size="sm" variant="outline" asChild><a href={`/admin/coupons/${coupon.id}`}>Details</a></Button>
                        <Button size="sm" variant="outline" onClick={() => toggleCoupon(coupon)}>{coupon.active ? "Disable" : "Enable"}</Button>
                        <Button size="sm" variant="destructive" onClick={() => deleteCoupon(coupon.id)}>Delete</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function durationLabel(value?: string) {
  if (value === "EVERY_RENEWAL") return "Every Renewal"
  if (value === "CUSTOM_CYCLES") return "Custom Cycles"
  return "First Invoice Only"
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} type={type} />
    </div>
  )
}
