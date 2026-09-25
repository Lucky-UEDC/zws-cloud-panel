"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowLeft, Save } from "lucide-react"
import { toast } from "sonner"
import { readJsonResponse } from "@/lib/client/safe-json"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"

type NodeOption = { id: string; name: string; nodeName: string }

const initialForm = {
  name: "",
  proxmoxNodeId: "",
  poolMode: "NODE_RESTRICTED",
  poolType: "NORMAL",
  type: "public",
  startIp: "",
  endIp: "",
  gateway: "",
  cidr: "24",
  dns1: "1.1.1.1",
  dns2: "8.8.8.8",
  bridge: "vmbr0",
  vlanTag: "",
  region: "",
  isActive: true,
}

export default function NewIpPoolPage() {
  const [nodes, setNodes] = useState<NodeOption[]>([])
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(async () => {
      const res = await fetch("/api/admin/proxmox-nodes", { cache: "no-store" })
      const body = await readJsonResponse<any>(res)
      if (res.ok) {
        setNodes((Array.isArray(body) ? body : []).map((row: any) => ({
          id: row.node?.id || row.id,
          name: row.node?.name || row.name,
          nodeName: row.node?.nodeName || row.nodeName,
        })).filter((row: NodeOption) => row.id))
      }
    })().catch(() => undefined)
  }, [])

  function update(field: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit() {
    setSaving(true)
    try {
      const dns = [form.dns1, form.dns2].map((item) => item.trim()).filter(Boolean).join(",")
      const res = await fetch("/api/admin/ip-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          proxmoxNodeId: form.proxmoxNodeId || null,
          poolMode: form.poolMode,
          poolType: form.poolType,
          assignedNodeIds: form.proxmoxNodeId ? [form.proxmoxNodeId] : [],
          type: form.type,
          startIp: form.startIp,
          endIp: form.endIp,
          gateway: form.gateway,
          cidr: Number(form.cidr || 24),
          dns,
          bridge: form.bridge,
          vlanTag: form.vlanTag === "" ? null : Number(form.vlanTag),
          region: form.region || null,
          regionTag: form.region || null,
          isActive: form.isActive,
        }),
      })
      const body = await readJsonResponse<any>(res) || {}
      if (!res.ok || !body.success) throw new Error(body.error || "Failed to create IP pool")
      toast.success(`IP pool created with ${body.createdIpRecords || 0} address records`)
      window.location.href = `/admin/ip-pools/${body.pool.id}`
    } catch (error: any) {
      toast.error(error?.message || "Failed to create IP pool")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2"><Link href="/admin/ip-pools"><ArrowLeft className="mr-2 h-4 w-4" />Back to IP Pools</Link></Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Add IP Pool</h1>
            <p className="mt-1 text-muted-foreground">Create a real assignable IP range and bind it to a Proxmox node.</p>
          </div>
          <Badge variant="outline">Creates ip_allocations records</Badge>
        </div>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Pool Details</CardTitle>
          <CardDescription>Gateway, range, and CIDR are validated before records are created.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(value) => update("name", value)} placeholder="Mumbai public pool 1" />
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Node</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.proxmoxNodeId} onChange={(event) => update("proxmoxNodeId", event.target.value)}>
              <option value="">Shared / select node</option>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.nodeName})</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Pool Mode</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.poolMode} onChange={(event) => update("poolMode", event.target.value)}>
              <option value="GLOBAL">Global</option>
              <option value="NODE_RESTRICTED">Node restricted</option>
              <option value="PRODUCT_RESTRICTED">Product restricted</option>
              <option value="HYBRID">Node + product restricted</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Pool Type</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.poolType} onChange={(event) => update("poolType", event.target.value)}>
              <option value="NORMAL">Normal</option>
              <option value="ADDON_ONLY">Addon only</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Public / Private</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.type} onChange={(event) => update("type", event.target.value)}>
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="premium">Premium Public</option>
            </select>
          </label>
          <Field label="Region" value={form.region} onChange={(value) => update("region", value)} placeholder="mumbai" />
          <Field label="Subnet / Start IP" value={form.startIp} onChange={(value) => update("startIp", value)} placeholder="203.0.113.10" />
          <Field label="End IP" value={form.endIp} onChange={(value) => update("endIp", value)} placeholder="203.0.113.50" />
          <Field label="Gateway" value={form.gateway} onChange={(value) => update("gateway", value)} placeholder="203.0.113.1" />
          <Field label="CIDR / Netmask" value={form.cidr} onChange={(value) => update("cidr", value)} placeholder="24" />
          <Field label="DNS 1" value={form.dns1} onChange={(value) => update("dns1", value)} placeholder="1.1.1.1" />
          <Field label="DNS 2" value={form.dns2} onChange={(value) => update("dns2", value)} placeholder="8.8.8.8" />
          <Field label="Bridge" value={form.bridge} onChange={(value) => update("bridge", value)} placeholder="vmbr0" />
          <Field label="VLAN" value={form.vlanTag} onChange={(value) => update("vlanTag", value)} placeholder="Optional" />
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={(event) => update("isActive", event.target.checked)} />
            Active pool
          </label>
          <div className="md:col-span-2">
            <Button onClick={submit} disabled={saving} className="gap-2"><Save className="h-4 w-4" />{saving ? "Creating..." : "Create IP Pool"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </div>
  )
}
