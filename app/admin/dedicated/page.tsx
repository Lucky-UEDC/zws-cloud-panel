"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { readJsonResponse } from "@/lib/client/safe-json"
import { formatPrice } from "@/lib/pricing"

type Service = {
  id: string
  serviceNumber: string
  orderNumber: string
  customer: { email: string; name: string | null } | null
  product: { name: string } | null
  status: string
  selectedOs: string | null
  hostname: string | null
  paymentConfirmedAt: string | null
  estimatedDeliveryAt: string | null
  deliveredAt: string | null
  primaryIp: string | null
  username: string | null
  panelUrl: string | null
  installedOs: string | null
  invoice: { id: string; invoiceNumber: string; status: string; totalAmount: number } | null
  paymentStatus: string
  createdAt: string
}
type OsOption = { id: string; family: string; familyLabel: string; name: string; version: string | null; iconUrl?: string | null; isActive: boolean; isRecommended: boolean; sortOrder: number }

const blankDelivery = { primaryIp: "", username: "", password: "", panelUrl: "", installedOs: "", notes: "" }
const blankOsForm = { familyLabel: "", name: "", version: "", iconUrl: "" }

export default function AdminDedicatedPage() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [deliveryService, setDeliveryService] = useState<Service | null>(null)
  const [deliveryForm, setDeliveryForm] = useState(blankDelivery)
  const [actionId, setActionId] = useState<string | null>(null)
  const [osOptions, setOsOptions] = useState<OsOption[]>([])
  const [osForm, setOsForm] = useState(blankOsForm)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/admin/dedicated", { cache: "no-store" })
      const [data, osRes] = await Promise.all([
        readJsonResponse<any>(res),
        fetch("/api/admin/dedicated/os-options", { cache: "no-store" }).then((r) => readJsonResponse<any>(r)).catch((error) => {
          console.error("Admin fetch failed:", error)
          return null
        }),
      ])
      if (!res.ok) throw new Error(data?.error || "Failed to load dedicated services")
      setServices(Array.isArray(data?.services) ? data.services : [])
      if (Array.isArray(osRes?.options)) setOsOptions(osRes.options)
    } catch (error: any) {
      console.error("Admin fetch failed:", error)
      const message = error?.message || "Unable to load dedicated servers right now."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function postAction(service: Service, action: "installing" | "cancel" | "refund") {
    setActionId(`${service.id}:${action}`)
    try {
      const res = await fetch(`/api/admin/dedicated/${service.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Action failed")
      toast.success("Dedicated service updated")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Action failed")
    } finally {
      setActionId(null)
    }
  }

  async function deliver() {
    if (!deliveryService) return
    setActionId(`${deliveryService.id}:deliver`)
    try {
      const res = await fetch(`/api/admin/dedicated/${deliveryService.id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deliveryForm),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Delivery failed")
      toast.success("Dedicated server marked delivered")
      setDeliveryService(null)
      setDeliveryForm(blankDelivery)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Delivery failed")
    } finally {
      setActionId(null)
    }
  }

  async function updateOsOption(option: OsOption, patch: Partial<OsOption>) {
    try {
      const res = await fetch(`/api/admin/dedicated/os-options/${option.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Unable to update OS option")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Unable to update OS option")
    }
  }

  async function createOsOption() {
    if (!osForm.familyLabel.trim() || !osForm.name.trim()) {
      toast.error("Group and name are required.")
      return
    }
    try {
      const res = await fetch("/api/admin/dedicated/os-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          familyLabel: osForm.familyLabel,
          name: osForm.name,
          version: osForm.version || null,
          iconUrl: osForm.iconUrl || null,
          isActive: true,
        }),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Unable to add OS option")
      setOsForm(blankOsForm)
      toast.success("OS option added")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Unable to add OS option")
    }
  }

  async function deleteOsOption(option: OsOption) {
    if (!window.confirm(`Remove ${option.name}? Existing service history will be preserved.`)) return
    try {
      const res = await fetch(`/api/admin/dedicated/os-options/${option.id}`, { method: "DELETE" })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data.error || "Unable to remove OS option")
      toast.success(data.deleted === false ? "OS option disabled because it is in use" : "OS option removed")
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Unable to remove OS option")
    }
  }

  return (
    <div className="space-y-5">
    <Card className="glass border-border/40">
      <CardHeader>
        <CardTitle>Dedicated Servers</CardTitle>
        <CardDescription>Manual delivery workflow for dedicated and bare metal server orders.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loadError ? (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            Unable to load dedicated servers right now. {loadError}
          </div>
        ) : null}
        <table className="w-full text-sm">
          <thead className="border-b border-border/40 text-left text-muted-foreground">
            <tr>
              <th className="py-2">Order</th>
              <th>Customer</th>
              <th>Product</th>
              <th>OS</th>
              <th>Status</th>
              <th>Invoice</th>
              <th>Delivery</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.id} className="border-b border-border/20 align-top">
                <td className="py-3 font-mono">{service.orderNumber}</td>
                <td>{service.customer?.name || service.customer?.email || "-"}</td>
                <td>{service.product?.name || "Dedicated Server"}</td>
                <td>{service.selectedOs || "-"}</td>
                <td><Badge variant={service.status === "delivered" ? "default" : "secondary"}>{service.status.replace(/_/g, " ")}</Badge></td>
                <td>{service.invoice ? <Link className="text-accent hover:underline" href={`/invoice/${service.invoice.invoiceNumber}`}>{service.invoice.status} - {formatPrice(service.invoice.totalAmount)}</Link> : "-"}</td>
                <td>
                  <div>{service.deliveredAt ? new Date(service.deliveredAt).toLocaleString() : service.estimatedDeliveryAt ? new Date(service.estimatedDeliveryAt).toLocaleString() : "-"}</div>
                  {service.primaryIp ? <div className="text-xs text-muted-foreground">{service.primaryIp}</div> : null}
                </td>
                <td>
                  <div className="flex flex-wrap justify-end gap-2">
                    {service.status !== "delivered" ? <Button size="sm" variant="outline" disabled={actionId === `${service.id}:installing`} onClick={() => postAction(service, "installing")}>Mark installing</Button> : null}
                    {service.status !== "delivered" ? <Button size="sm" onClick={() => { setDeliveryService(service); setDeliveryForm({ ...blankDelivery, installedOs: service.selectedOs || "" }) }}>Mark delivered</Button> : null}
                    {!["cancelled", "delivered", "refunded"].includes(service.status) ? <Button size="sm" variant="destructive" disabled={actionId === `${service.id}:cancel`} onClick={() => postAction(service, "cancel")}>Cancel</Button> : null}
                    {service.status !== "refunded" ? <Button size="sm" variant="outline" disabled={actionId === `${service.id}:refund`} onClick={() => postAction(service, "refund")}>Refund marker</Button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {!services.length ? <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">{loading ? "Loading dedicated services..." : "No dedicated orders found."}</td></tr> : null}
          </tbody>
        </table>
      </CardContent>

      <Dialog open={Boolean(deliveryService)} onOpenChange={(open) => !open && setDeliveryService(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark dedicated server delivered</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <Field label="Primary IP" value={deliveryForm.primaryIp} onChange={(primaryIp) => setDeliveryForm({ ...deliveryForm, primaryIp })} />
            <Field label="Username" value={deliveryForm.username} onChange={(username) => setDeliveryForm({ ...deliveryForm, username })} />
            <Field label="Password" type="password" value={deliveryForm.password} onChange={(password) => setDeliveryForm({ ...deliveryForm, password })} />
            <Field label="IPMI / Panel URL" value={deliveryForm.panelUrl} onChange={(panelUrl) => setDeliveryForm({ ...deliveryForm, panelUrl })} />
            <Field label="Installed OS" value={deliveryForm.installedOs} onChange={(installedOs) => setDeliveryForm({ ...deliveryForm, installedOs })} />
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={deliveryForm.notes} onChange={(event) => setDeliveryForm({ ...deliveryForm, notes: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeliveryService(null)}>Cancel</Button>
            <Button onClick={deliver} disabled={actionId?.endsWith(":deliver")}>Mark delivered</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    <Card className="glass border-border/40">
      <CardHeader>
        <CardTitle>Dedicated OS / Platform Options</CardTitle>
        <CardDescription>Manage grouped install choices shown on dedicated checkout.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="mb-4 grid gap-3 rounded-lg border border-border/40 p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Field label="Group" value={osForm.familyLabel} onChange={(familyLabel) => setOsForm((current) => ({ ...current, familyLabel }))} />
          <Field label="Name" value={osForm.name} onChange={(name) => setOsForm((current) => ({ ...current, name }))} />
          <Field label="Version" value={osForm.version} onChange={(version) => setOsForm((current) => ({ ...current, version }))} />
          <Field label="Logo URL" value={osForm.iconUrl} onChange={(iconUrl) => setOsForm((current) => ({ ...current, iconUrl }))} />
          <div className="flex items-end">
            <Button type="button" onClick={createOsOption} className="w-full">Add</Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Group</th><th>Name</th><th>Version</th><th>Logo</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {osOptions.map((option) => (
              <tr key={option.id} className="border-b border-border/20">
                <td className="py-2">{option.familyLabel}</td>
                <td>{option.name}</td>
                <td>{option.version || "-"}</td>
                <td className="max-w-48 truncate text-xs text-muted-foreground">{option.iconUrl || "-"}</td>
                <td><Badge variant={option.isActive ? "default" : "secondary"}>{option.isActive ? "Active" : "Hidden"}</Badge>{option.isRecommended ? <Badge className="ml-2" variant="outline">Recommended</Badge> : null}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => updateOsOption(option, { isActive: !option.isActive })}>{option.isActive ? "Hide" : "Show"}</Button>
                    <Button size="sm" variant="outline" onClick={() => updateOsOption(option, { isRecommended: !option.isRecommended })}>{option.isRecommended ? "Unset recommended" : "Recommend"}</Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteOsOption(option)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
    </div>
  )
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <div className="space-y-2"><Label>{label}</Label><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
