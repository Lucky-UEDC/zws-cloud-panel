"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CheckCircle2, Truck } from "lucide-react"
import { readJsonResponse } from "@/lib/client/safe-json"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

type NodeOption = { id: string; name: string; nodeName: string; status?: string | null }

export default function ManualDeliveryPage() {
  const [nodes, setNodes] = useState<NodeOption[]>([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [form, setForm] = useState({
    orderId: "",
    vmid: "",
    nodeId: "",
    ipAssignmentMode: "automatic",
    poolId: "",
    ip: "",
    gateway: "",
    cidr: "24",
    dns: "",
    username: "",
    password: "",
    hostname: "",
    notes: "",
  })

  useEffect(() => {
    fetch("/api/admin/proxmox-nodes", { cache: "no-store" })
      .then(async (res) => {
        const body = await readJsonResponse<any>(res)
        const rows = Array.isArray(body) ? body : Array.isArray(body?.nodes) ? body.nodes : []
        setNodes(rows.filter((node: any) => node.isActive !== false).map((node: any) => ({
          id: String(node.id),
          name: String(node.name || node.nodeName),
          nodeName: String(node.nodeName || node.name),
          status: node.status || null,
        })))
      })
      .catch((error) => toast.error(error?.message || "Unable to load nodes"))
  }, [])

  async function submit() {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch("/api/admin/manual-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, vmid: Number(form.vmid), cidr: Number(form.cidr) }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || body?.success === false) throw new Error(body?.error || "Manual delivery failed")
      setResult(body)
      toast.success("VM manually delivered")
    } catch (error: any) {
      toast.error(error?.message || "Manual delivery failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Deliver VM Manually</h1>
        <p className="mt-1 text-sm text-muted-foreground">Attach an existing VM, credentials, node, IP, billing, and customer order without running the provision engine.</p>
      </div>
      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Manual VM Delivery</CardTitle>
          <CardDescription>Order ID and VMID must refer to the VM being handed to the customer.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Order ID" value={form.orderId} onChange={(orderId) => setForm({ ...form, orderId })} />
          <Field label="VM ID" value={form.vmid} onChange={(vmid) => setForm({ ...form, vmid })} />
          <div className="space-y-2">
            <Label>Node</Label>
            <Select value={form.nodeId} onValueChange={(nodeId) => setForm({ ...form, nodeId })}>
              <SelectTrigger><SelectValue placeholder="Select compatible node" /></SelectTrigger>
              <SelectContent>{nodes.map((node) => <SelectItem key={node.id} value={node.id}>{node.name} ({node.nodeName}){node.status ? ` - ${node.status}` : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Field label="Hostname" value={form.hostname} onChange={(hostname) => setForm({ ...form, hostname })} />
          <Field label="Username" value={form.username} onChange={(username) => setForm({ ...form, username })} />
          <Field label="Password" value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <div className="space-y-2">
            <Label>IP Assignment Mode</Label>
            <Select value={form.ipAssignmentMode} onValueChange={(ipAssignmentMode) => setForm({ ...form, ipAssignmentMode })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">Automatic</SelectItem>
                <SelectItem value="manual_select">Manual select</SelectItem>
                <SelectItem value="manual_enter">Manual enter</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.ipAssignmentMode !== "automatic" ? (
            <>
              <Field label="Pool ID" value={form.poolId} onChange={(poolId) => setForm({ ...form, poolId })} />
              <Field label="IP Address" value={form.ip} onChange={(ip) => setForm({ ...form, ip })} />
            </>
          ) : null}
          {form.ipAssignmentMode === "manual_enter" ? (
            <>
              <Field label="Gateway" value={form.gateway} onChange={(gateway) => setForm({ ...form, gateway })} />
              <Field label="Subnet / CIDR" value={form.cidr} onChange={(cidr) => setForm({ ...form, cidr })} />
              <Field label="DNS" value={form.dns} onChange={(dns) => setForm({ ...form, dns })} />
            </>
          ) : null}
          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Button onClick={submit} disabled={saving || !form.orderId || !form.nodeId || !form.vmid || !form.password || !form.hostname}>{saving ? "Saving..." : "Save Manual Delivery"}</Button>
          </div>
        </CardContent>
      </Card>
      {result ? (
        <Card className="border-emerald-500/30">
          <CardContent className="flex items-center gap-3 pt-6 text-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            <span>Delivered VMID {result.vmid} with IP {result.ip || "pending"} and username {result.username}.</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
