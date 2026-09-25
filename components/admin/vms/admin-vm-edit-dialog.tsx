"use client"

import { useState } from "react"
import { Edit3, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readJsonResponse } from "@/lib/client/safe-json"

type NodeOption = { id: string; label: string }

type InitialVmEdit = {
  cpuCores?: number | null
  ramGb?: number | null
  diskGb?: number | null
  nodeId?: string | null
  ipAddress?: string | null
  username?: string | null
  hostname?: string | null
  macAddress?: string | null
  renewalDueAt?: string | null
}

function dateInput(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toISOString().slice(0, 10)
}

export function AdminVmEditDialog({ vpsId, initial, nodes }: { vpsId: string; initial: InitialVmEdit; nodes: NodeOption[] }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    cpuCores: initial.cpuCores ? String(initial.cpuCores) : "",
    ramGb: initial.ramGb ? String(initial.ramGb) : "",
    diskGb: initial.diskGb ? String(initial.diskGb) : "",
    nodeId: initial.nodeId || "",
    ipAddress: initial.ipAddress || "",
    username: initial.username || "",
    password: "",
    hostname: initial.hostname || "",
    macAddress: initial.macAddress || "",
    renewalDueAt: dateInput(initial.renewalDueAt),
    reason: "Admin VM edit",
  })

  function setField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || undefined]))
      const res = await fetch(`/api/admin/vms/${vpsId}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse<any>(res)
      if (!res.ok || !data?.success) throw new Error(data?.error || "Unable to edit VM")
      toast.success("VM updated")
      setOpen(false)
      window.location.reload()
    } catch (error: any) {
      toast.error(error?.message || "Unable to edit VM")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Edit3 className="h-4 w-4" />
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit VM</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <Field label="CPU" value={form.cpuCores} type="number" onChange={(value) => setField("cpuCores", value)} />
            <Field label="RAM GB" value={form.ramGb} type="number" onChange={(value) => setField("ramGb", value)} />
            <Field label="Disk GB" value={form.diskGb} type="number" onChange={(value) => setField("diskGb", value)} />
            <div className="grid gap-2">
              <Label htmlFor="edit-node">Node</Label>
              <select
                id="edit-node"
                value={form.nodeId}
                onChange={(event) => setField("nodeId", event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Current node</option>
                {nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
            </div>
            <Field label="IP" value={form.ipAddress} onChange={(value) => setField("ipAddress", value)} />
            <Field label="Username" value={form.username} onChange={(value) => setField("username", value)} />
            <Field label="Password" value={form.password} type="password" onChange={(value) => setField("password", value)} />
            <Field label="Hostname" value={form.hostname} onChange={(value) => setField("hostname", value)} />
            <Field label="MAC" value={form.macAddress} onChange={(value) => setField("macAddress", value)} />
            <Field label="Billing Date" value={form.renewalDueAt} type="date" onChange={(value) => setField("renewalDueAt", value)} />
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="edit-reason">Reason</Label>
              <Input id="edit-reason" value={form.reason} onChange={(event) => setField("reason", event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  const id = `edit-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}
