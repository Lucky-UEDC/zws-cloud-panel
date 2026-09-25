"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Network, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Pool = {
  id: string
  name: string
  startIp: string
  endIp: string
  cidr: number
  type: string
  pricePerIp: number | string
  bulkEnabled: boolean
  isActive: boolean
  healthStatus?: string
  exhaustionDetected?: boolean
  duplicateIpsDetected?: boolean
  totalIps: number
  freeIps: number
  usedIps: number
  reservedIps: number
  nodeAssignments?: unknown[]
  productAssignments?: unknown[]
}

type Allocation = {
  id: string
  ipAddress: string
  status: string
  datacenter?: string | null
  nodeName?: string | null
  vmid?: number | null
  hostname?: string | null
  customer?: string | null
  assignedDate?: string | null
  lastChanged?: string | null
  poolName?: string | null
}

export default function AdminIpPoolsPage() {
  const [pools, setPools] = useState<Pool[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/ip-pools", { cache: "no-store" })
      const data = await readJsonResponse<any>(res)
      if (!res.ok) throw new Error(data?.error || "Failed to load IP pools")
      setPools(data.pools || [])
      setAllocations(data.allocations || [])
    } catch (error: any) {
      toast.error(error?.message || "Failed to load IP pools")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">IP Pools</h1>
          <p className="mt-1 text-muted-foreground">Manage pool capacity, node assignments, product restrictions, and premium address rules.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>
          <Button asChild className="gap-2"><Link href="/admin/ip-pools/new"><Plus className="h-4 w-4" />Add Range</Link></Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pools" value={pools.length} />
        <Stat label="Total IPs" value={pools.reduce((sum, pool) => sum + Number(pool.totalIps || 0), 0)} />
        <Stat label="Used / Reserved" value={pools.reduce((sum, pool) => sum + Number(pool.usedIps || 0) + Number(pool.reservedIps || 0), 0)} />
        <Stat label="Free" value={pools.reduce((sum, pool) => sum + Number(pool.freeIps || 0), 0)} />
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Network className="h-5 w-5" />Pool Inventory</CardTitle>
          <CardDescription>Row actions are intentionally limited. Use Manage for edits, delete workflow, allocations, and assignments.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Pool</th><th>Type</th><th>Range</th><th>Usage</th><th>Assignments</th><th>Health</th><th>Status</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={pool.id} className="border-b align-top">
                  <td className="py-2"><div className="font-medium">{pool.name}</div>{pool.type === "premium" ? <div className="text-xs text-muted-foreground">₹{Number(pool.pricePerIp || 0).toLocaleString("en-IN")}/IP {pool.bulkEnabled ? "bulk enabled" : ""}</div> : null}</td>
                  <td><Badge variant="outline" className="capitalize">{pool.type}</Badge></td>
                  <td className="font-mono text-xs">{pool.startIp} - {pool.endIp}/{pool.cidr}</td>
                  <td>{Number(pool.usedIps || 0) + Number(pool.reservedIps || 0)} / {pool.totalIps}</td>
                  <td className="text-xs text-muted-foreground">{pool.nodeAssignments?.length || 0} nodes · {pool.productAssignments?.length || 0} products</td>
                  <td className="text-xs text-muted-foreground">
                    <div className="capitalize">{pool.healthStatus || "healthy"}</div>
                    {pool.exhaustionDetected ? <div className="text-amber-600">Exhausted</div> : null}
                    {pool.duplicateIpsDetected ? <div className="text-destructive">Duplicate IPs</div> : null}
                  </td>
                  <td><Badge variant={pool.isActive ? "default" : "secondary"}>{pool.isActive ? "active" : "disabled"}</Badge></td>
                  <td className="text-right"><Button asChild size="sm" variant="outline"><Link href={`/admin/ip-pools/${pool.id}`}>Manage</Link></Button></td>
                </tr>
              ))}
              {!pools.length ? <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">{loading ? "Loading IP pools..." : "No IP pools configured."}</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>IP Inventory</CardTitle>
          <CardDescription>Every address with assignment, node, VM, customer, and timestamp details.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2">IP</th>
                <th>Status</th>
                <th>Datacenter</th>
                <th>Node</th>
                <th>VMID</th>
                <th>Hostname</th>
                <th>Customer</th>
                <th>Assigned Date</th>
                <th>Updated Date</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((allocation) => (
                <tr key={allocation.id} className="border-b align-top">
                  <td className="py-2 font-mono text-xs">{allocation.ipAddress}</td>
                  <td><Badge variant={String(allocation.status).toLowerCase().includes("free") || String(allocation.status).toLowerCase().includes("released") ? "secondary" : "default"}>{allocation.status}</Badge></td>
                  <td>{allocation.datacenter || "-"}</td>
                  <td>{allocation.nodeName || "-"}</td>
                  <td>{allocation.vmid || "-"}</td>
                  <td>{allocation.hostname || "-"}</td>
                  <td>{allocation.customer || "-"}</td>
                  <td>{allocation.assignedDate ? new Date(allocation.assignedDate).toLocaleString() : "-"}</td>
                  <td>{allocation.lastChanged ? new Date(allocation.lastChanged).toLocaleString() : "-"}</td>
                </tr>
              ))}
              {!allocations.length ? <tr><td colSpan={9} className="py-10 text-center text-muted-foreground">{loading ? "Loading IP inventory..." : "No IP allocations found."}</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="glass rounded-xl p-5"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</div></div>
}
