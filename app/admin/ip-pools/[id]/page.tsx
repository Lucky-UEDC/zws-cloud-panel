"use client"

import { adminApiErrorMessage, adminApiJson } from "@/lib/client/admin-api"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ArrowLeft, Save, ShieldCheck, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Assignment = { id: string; nodeId?: string; productId?: string; poolId: string; priority?: number; active?: boolean }
type Pool = {
  id: string
  name: string
  startIp: string
  endIp: string
  gateway: string
  cidr: number
  dns: string
  bridge: string
  region?: string | null
  allocationPriority?: number
  fallbackPriority?: number
  appliesToAllNodes?: boolean
  appliesToAllProducts?: boolean
  poolMode?: string
  poolType?: string
  staticOnly?: boolean
  failoverPoolIds?: string[]
  type: string
  isActive: boolean
  totalIps: number
  freeIps: number
  usedIps: number
  utilizationPercent?: number
  reservedIps: number
  blockedIps?: number
  damagedIps?: number
  maintenanceIps?: number
  allocations: Array<{ id: string; ipAddress: string; status: string; displayStatus?: string; vmid: number | null; hostname: string | null; nodeName?: string | null; nodeId?: string | null; assignedDate?: string; lastChanged?: string; vpsInstance?: { name: string; customer?: { email: string; name: string | null } | null } | null }>
  poolNodeAssignments?: Array<{ id: string; nodeId: string; poolId: string; priority: number; active: boolean }>
  poolProductAssignments?: Array<{ id: string; productId: string; poolId: string; priority: number; active: boolean }>
}
type NodeRow = { id: string; name: string; nodeName: string; isActive: boolean }
type ProductRow = { id: string; name: string; slug: string; isActive: boolean; status: string }

type RowDraft = { enabled: boolean; priority: number }

export default function AdminIpPoolDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id
  const [pool, setPool] = useState<Pool | null>(null)
  const [nodes, setNodes] = useState<NodeRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [allPools, setAllPools] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: "",
    startIp: "",
    endIp: "",
    gateway: "",
    cidr: "24",
    dns: "1.1.1.1",
    bridge: "vmbr0",
    region: "",
    allocationPriority: "100",
    fallbackPriority: "100",
    appliesToAllNodes: false,
    appliesToAllProducts: false,
    poolMode: "NODE_RESTRICTED",
    poolType: "NORMAL",
    staticOnly: true,
    failoverPoolIds: [] as string[],
    isActive: true,
  })
  const [nodeDraft, setNodeDraft] = useState<Record<string, RowDraft>>({})
  const [productDraft, setProductDraft] = useState<Record<string, RowDraft>>({})
  const [rangeAction, setRangeAction] = useState({ startIp: "", endIp: "", status: "reserved" })
  const [stepUp, setStepUp] = useState({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })
  const pendingStepUpAction = useRef<null | (() => Promise<unknown>)>(null)

  async function load() {
    if (!id) return
    let data: any
    try {
      data = await adminApiJson<any>(`/api/admin/ip-pools/${id}`)
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "Failed to load IP pool"))
      return
    }
    setPool(data.pool)
    setNodes(data.nodes || [])
    setProducts(data.products || [])
    setAllPools((data.targetPools || []).map((p: any) => ({ id: p.id, name: p.name })))

    const nodeMap: Record<string, RowDraft> = {}
    for (const n of data.nodes || []) nodeMap[n.id] = { enabled: false, priority: 100 }
    for (const row of data.pool.poolNodeAssignments || []) nodeMap[row.nodeId] = { enabled: Boolean(row.active), priority: Number(row.priority || 100) }
    setNodeDraft(nodeMap)

    const productMap: Record<string, RowDraft> = {}
    for (const p of data.products || []) productMap[p.id] = { enabled: false, priority: 100 }
    for (const row of data.pool.poolProductAssignments || []) productMap[row.productId] = { enabled: Boolean(row.active), priority: Number(row.priority || 100) }
    setProductDraft(productMap)

    setForm({
      name: data.pool.name || "",
      startIp: data.pool.startIp || "",
      endIp: data.pool.endIp || "",
      gateway: data.pool.gateway || "",
      cidr: String(data.pool.cidr || 24),
      dns: data.pool.dns || "1.1.1.1",
      bridge: data.pool.bridge || "vmbr0",
      region: data.pool.region || data.pool.regionTag || "",
      allocationPriority: String(data.pool.allocationPriority || 100),
      fallbackPriority: String(data.pool.fallbackPriority || 100),
      appliesToAllNodes: Boolean(data.pool.appliesToAllNodes),
      appliesToAllProducts: Boolean(data.pool.appliesToAllProducts),
      poolMode: data.pool.poolMode || "NODE_RESTRICTED",
      poolType: data.pool.poolType || "NORMAL",
      staticOnly: data.pool.staticOnly !== false,
      failoverPoolIds: Array.isArray(data.pool.failoverPoolIds) ? data.pool.failoverPoolIds.map((v: unknown) => String(v)) : [],
      isActive: Boolean(data.pool.isActive),
    })
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const activeAllocations = useMemo(() => (pool?.allocations || []).filter((row) => ["USED", "used", "ASSIGNED", "assigned", "RESERVED", "reserved", "BLOCKED", "blocked", "DAMAGED", "damaged", "MAINTENANCE", "maintenance"].includes(String(row.status))), [pool])

  async function startStepUp(action: () => Promise<unknown>) {
    pendingStepUpAction.current = action
    try {
      const data = await adminApiJson<any>("/api/auth/mfa/step-up/start", {
        method: "POST",
        body: "{}",
        redirectOnAuthError: false,
      })
      if (data.code === "mfa_not_required") {
        pendingStepUpAction.current = null
        await action()
        return
      }
      setStepUp({ open: true, busy: false, challengeToken: data.challengeToken, method: data.method, maskedTarget: data.maskedTarget || "", code: "" })
    } catch (error) {
      pendingStepUpAction.current = null
      toast.error(adminApiErrorMessage(error, "Unable to start MFA verification"))
    }
  }

  async function verifyStepUp() {
    setStepUp((state) => ({ ...state, busy: true }))
    try {
      await adminApiJson<any>("/api/auth/mfa/step-up/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken: stepUp.challengeToken, method: stepUp.method, code: stepUp.code }),
        redirectOnAuthError: false,
      })
      const action = pendingStepUpAction.current
      pendingStepUpAction.current = null
      setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })
      toast.success("MFA verified")
      if (action) await action()
    } catch (error) {
      setStepUp((state) => ({ ...state, busy: false }))
      toast.error(adminApiErrorMessage(error, "MFA verification failed"))
    }
  }

  async function handleStepUpResponse(error: unknown, retry: () => Promise<unknown>) {
    const code = String((error as any)?.code || (error as any)?.data?.code || "")
    if (code === "recent_mfa_required" || code === "mfa_required") {
      await startStepUp(retry)
      return true
    }
    return false
  }

  async function savePool() {
    if (!id) return
    setSaving(true)
    try {
      await adminApiJson<any>(`/api/admin/ip-pools/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          cidr: Number(form.cidr),
          allocationPriority: Number(form.allocationPriority || 100),
          fallbackPriority: Number(form.fallbackPriority || 100),
          appliesToAllNodes: form.appliesToAllNodes,
          appliesToAllProducts: form.appliesToAllProducts,
          poolMode: form.poolMode,
          poolType: form.poolType,
          failoverPoolIds: form.failoverPoolIds,
          assignedNodeIds: form.appliesToAllNodes ? [] : nodes.filter((node) => nodeDraft[node.id]?.enabled).map((node) => node.id),
        }),
      })
      toast.success("IP pool saved")
      await load()
    } catch (error: any) {
      toast.error(adminApiErrorMessage(error, "Failed to save pool"))
    } finally {
      setSaving(false)
    }
  }

  async function saveAssignments() {
    if (!id) return
    setSaving(true)
    try {
      await adminApiJson(`/api/admin/ip-pools/${id}/assignments`, {
        method: "PATCH",
        redirectOnAuthError: false,
        body: JSON.stringify({
          nodeAssignments: nodes
            .filter((node) => nodeDraft[node.id]?.enabled)
            .map((node) => ({ nodeId: node.id, priority: Number(nodeDraft[node.id]?.priority || 100), active: true })),
          productAssignments: products
            .filter((product) => productDraft[product.id]?.enabled)
            .map((product) => ({ productId: product.id, priority: Number(productDraft[product.id]?.priority || 100), active: true })),
        }),
      })
      toast.success("Assignments saved")
      await load()
    } catch (error: any) {
      if (await handleStepUpResponse(error, saveAssignments)) return
      toast.error(error?.message || "Failed to save assignments")
    } finally {
      setSaving(false)
    }
  }

  async function deletePool() {
    if (!id || !confirm("Delete this IP pool? Active allocations will block deletion.")) return
    try {
      await adminApiJson(`/api/admin/ip-pools/${id}`, { method: "DELETE" })
      toast.success("IP pool deleted")
      router.push("/admin/ip-pools")
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "Failed to delete pool"))
    }
  }

  async function applyRangeStatus() {
    if (!id || !rangeAction.startIp.trim()) return
    setSaving(true)
    try {
      const ips = expandRange(rangeAction.startIp.trim(), rangeAction.endIp.trim() || rangeAction.startIp.trim())
      const action = rangeAction.status === "reserved"
        ? "reserve"
        : rangeAction.status === "blocked"
          ? "block"
          : rangeAction.status === "damaged"
            ? "damage"
            : rangeAction.status === "maintenance"
              ? "maintenance"
              : "free"
      for (const ipAddress of ips) {
        await adminApiJson(`/api/admin/ip-pools/${id}/allocations`, {
          method: "POST",
          body: JSON.stringify({ action, poolId: id, ipAddress, forceOverride: true }),
        })
      }
      toast.success(`Updated ${ips.length} IPs`)
      await load()
    } catch (error) {
      toast.error(adminApiErrorMessage(error, "IP range update failed"))
    } finally {
      setSaving(false)
    }
  }

  if (!pool) return <p className="text-muted-foreground">Loading IP pool...</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2"><Link href="/admin/ip-pools"><ArrowLeft className="mr-2 h-4 w-4" />Back to IP Pools</Link></Button>
          <h1 className="text-3xl font-semibold">{pool.name}</h1>
          <p className="text-muted-foreground">{pool.startIp} - {pool.endIp}/{pool.cidr}</p>
        </div>
        <Button variant="destructive" onClick={deletePool} className="gap-2"><Trash2 className="h-4 w-4" />Delete</Button>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Pool Policy</CardTitle><CardDescription>Enterprise static-only pool policy and failover setup.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="startIp" value={form.startIp} onChange={(value) => setForm((current) => ({ ...current, startIp: value }))} />
          <Field label="endIp" value={form.endIp} onChange={(value) => setForm((current) => ({ ...current, endIp: value }))} />
          <Field label="gateway" value={form.gateway} onChange={(value) => setForm((current) => ({ ...current, gateway: value }))} />
          <Field label="cidr" value={form.cidr} onChange={(value) => setForm((current) => ({ ...current, cidr: value }))} />
          <Field label="dns" value={form.dns} onChange={(value) => setForm((current) => ({ ...current, dns: value }))} />
          <Field label="bridge" value={form.bridge} onChange={(value) => setForm((current) => ({ ...current, bridge: value }))} />
          <Field label="region" value={form.region} onChange={(value) => setForm((current) => ({ ...current, region: value }))} />
          <Field label="allocationPriority" value={form.allocationPriority} onChange={(value) => setForm((current) => ({ ...current, allocationPriority: value }))} />
          <Field label="fallbackPriority" value={form.fallbackPriority} onChange={(value) => setForm((current) => ({ ...current, fallbackPriority: value }))} />
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Pool mode</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.poolMode} onChange={(event) => setForm((current) => ({ ...current, poolMode: event.target.value }))}>
              <option value="GLOBAL">Global</option>
              <option value="NODE_RESTRICTED">Node restricted</option>
              <option value="PRODUCT_RESTRICTED">Product restricted</option>
              <option value="HYBRID">Node + product restricted</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Pool type</span>
            <select className="h-10 w-full rounded-md border border-border/50 bg-background px-3" value={form.poolType} onChange={(event) => setForm((current) => ({ ...current, poolType: event.target.value }))}>
              <option value="NORMAL">Normal</option>
              <option value="ADDON_ONLY">Addon only</option>
            </select>
          </label>

          <div className="md:col-span-3">
            <div className="mb-2 text-sm font-medium">Usage</div>
            <div className="h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.max(0, pool.utilizationPercent || 0))}%` }} />
            </div>
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-5">
              <span>Total: {pool.totalIps}</span>
              <span>Free: {pool.freeIps}</span>
              <span>Assigned: {pool.usedIps}</span>
              <span>Reserved: {pool.reservedIps}</span>
              <span>Blocked: {(pool.blockedIps || 0) + (pool.damagedIps || 0) + (pool.maintenanceIps || 0)}</span>
            </div>
          </div>

          <div className="space-y-2 md:col-span-3">
            <Label>Failover Pools</Label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {allPools.map((p) => {
                const checked = form.failoverPoolIds.includes(p.id)
                return (
                  <label key={p.id} className="flex items-center gap-2 rounded-md border border-border/35 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        failoverPoolIds: event.target.checked
                          ? [...current.failoverPoolIds, p.id]
                          : current.failoverPoolIds.filter((id) => id !== p.id),
                      }))}
                    />
                    <span>{p.name}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.staticOnly} onChange={(event) => setForm((current) => ({ ...current, staticOnly: event.target.checked }))} />Static-only mode</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} />Active</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.appliesToAllNodes} onChange={(event) => setForm((current) => ({ ...current, appliesToAllNodes: event.target.checked }))} />Assign to all nodes</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.appliesToAllProducts} onChange={(event) => setForm((current) => ({ ...current, appliesToAllProducts: event.target.checked }))} />Assign to all products</label>

          <div className="md:col-span-3"><Button onClick={savePool} disabled={saving} className="gap-2"><Save className="h-4 w-4" />Save Pool Policy</Button></div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <AssignmentCard title="Assigned Nodes" description="Enable pool usage per node and define allocation priority (lower = preferred).">
          {nodes.map((node) => {
            const row = nodeDraft[node.id] || { enabled: false, priority: 100 }
            return (
              <div key={node.id} className="grid gap-2 rounded-md border border-border/35 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <div className="min-w-0 truncate font-medium">{node.name} ({node.nodeName})</div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={row.enabled} onChange={(event) => setNodeDraft((prev) => ({ ...prev, [node.id]: { ...row, enabled: event.target.checked } }))} />Allowed</label>
                <Input className="h-8 w-24" value={String(row.priority)} onChange={(event) => setNodeDraft((prev) => ({ ...prev, [node.id]: { ...row, priority: Number(event.target.value || 100) } }))} />
              </div>
            )
          })}
        </AssignmentCard>
        <AssignmentCard title="Allowed Products" description="Enable pool usage per product and define allocation priority (lower = preferred).">
          {products.map((product) => {
            const row = productDraft[product.id] || { enabled: false, priority: 100 }
            return (
              <div key={product.id} className="grid gap-2 rounded-md border border-border/35 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                <div className="min-w-0 truncate font-medium">{product.name}</div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={row.enabled} onChange={(event) => setProductDraft((prev) => ({ ...prev, [product.id]: { ...row, enabled: event.target.checked } }))} />Allowed</label>
                <Input className="h-8 w-24" value={String(row.priority)} onChange={(event) => setProductDraft((prev) => ({ ...prev, [product.id]: { ...row, priority: Number(event.target.value || 100) } }))} />
              </div>
            )
          })}
        </AssignmentCard>
      </div>
      <Button onClick={saveAssignments} disabled={saving} className="gap-2"><Save className="h-4 w-4" />Save Assignments</Button>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>IP Controls</CardTitle><CardDescription>Reserve, blacklist, damage, maintain, release, import, or export addresses.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <Field label="startIp" value={rangeAction.startIp} onChange={(startIp) => setRangeAction((current) => ({ ...current, startIp }))} />
          <Field label="endIp" value={rangeAction.endIp} onChange={(endIp) => setRangeAction((current) => ({ ...current, endIp }))} />
          <div className="space-y-2">
            <Label>Status</Label>
            <select className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm" value={rangeAction.status} onChange={(event) => setRangeAction((current) => ({ ...current, status: event.target.value }))}>
              <option value="reserved">Reserve range</option>
              <option value="blocked">Blacklist range</option>
              <option value="damaged">Mark damaged</option>
              <option value="maintenance">Maintenance</option>
              <option value="free">Force release</option>
            </select>
          </div>
          <div className="flex items-end"><Button onClick={applyRangeStatus} disabled={saving || !rangeAction.startIp} className="w-full">Apply</Button></div>
          <div className="flex items-end"><Button variant="outline" className="w-full" onClick={() => navigator.clipboard.writeText(JSON.stringify(pool.allocations, null, 2)).then(() => toast.success("Allocations exported"))}>Export IPs</Button></div>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Active Allocations</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">IP</th><th>Status</th><th>VMID</th><th>Hostname</th><th>Node Name</th><th>Node ID</th><th>Assigned Date</th><th>Last Changed</th><th>Customer</th></tr></thead>
            <tbody>
              {activeAllocations.map((row) => <tr key={row.id} className="border-b"><td className="py-2 font-mono">{row.ipAddress}</td><td><Badge variant="outline">{row.displayStatus || row.status}</Badge></td><td>{row.vmid || "-"}</td><td>{row.vpsInstance?.name || row.hostname || "-"}</td><td>{row.nodeName || "-"}</td><td className="font-mono text-xs">{row.nodeId || "-"}</td><td>{row.assignedDate ? new Date(row.assignedDate).toLocaleString() : "-"}</td><td>{row.lastChanged ? new Date(row.lastChanged).toLocaleString() : "-"}</td><td>{row.vpsInstance?.customer?.name || row.vpsInstance?.customer?.email || "-"}</td></tr>)}
              {!activeAllocations.length ? <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No active allocations.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Dialog open={stepUp.open} onOpenChange={(open) => setStepUp((state) => ({ ...state, open }))}>
        <DialogContent className="glass border-border/40">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Enter MFA code to continue</DialogTitle>
            <DialogDescription>
              {stepUp.method === "totp" ? "Use your authenticator app." : stepUp.maskedTarget ? `Code sent to ${stepUp.maskedTarget}.` : "Verify this IP pool assignment change."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>MFA code</Label>
            <Input value={stepUp.code} onChange={(event) => setStepUp((state) => ({ ...state, code: event.target.value.trim() }))} autoComplete="one-time-code" inputMode="numeric" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepUp({ open: false, busy: false, challengeToken: "", method: "", maskedTarget: "", code: "" })}>Cancel</Button>
            <Button onClick={verifyStepUp} disabled={stepUp.busy || stepUp.code.length < 6}>Verify</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label className="capitalize">{label}</Label><Input value={value} onChange={(event) => onChange(event.target.value)} /></div>
}

function AssignmentCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="glass border-border/40"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="max-h-[420px] space-y-2 overflow-y-auto">{children}</CardContent></Card>
}

function ipToNumber(ip: string) {
  return ip.split(".").reduce((sum, part) => (sum * 256) + Number(part || 0), 0) >>> 0
}

function numberToIp(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".")
}

function expandRange(startIp: string, endIp: string) {
  const start = ipToNumber(startIp)
  const end = ipToNumber(endIp)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error("Invalid IP range")
  const ips: string[] = []
  for (let value = start; value <= end && ips.length < 2048; value += 1) ips.push(numberToIp(value))
  if (end - start >= 2048) throw new Error("Range is too large for a manual UI action")
  return ips
}
