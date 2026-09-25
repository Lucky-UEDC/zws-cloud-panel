"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function ComputeInfrastructureAdminPage() {
  const [nodes, setNodes] = useState<any[]>([])
  const [vms, setVms] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [scanResult, setScanResult] = useState<any>(null)
  const [importRows, setImportRows] = useState<any[]>([])
  const [toolBusy, setToolBusy] = useState<string | null>(null)
  const [tool, setTool] = useState({ nodeId: "", customerId: "", productId: "", termMonths: "1" })

  async function loadData() {
    setLoading(true)
    try {
      const [nodesRes, vmsRes, customersRes, productsRes] = await Promise.all([
        fetch("/api/admin/proxmox/nodes"),
        fetch("/api/admin/proxmox/vms"),
        fetch("/api/admin/customers?pageSize=100"),
        fetch("/api/admin/products"),
      ])

      const [nodesData, vmsData, customersData, productsData] = await Promise.all([
        readJsonResponse<any>(nodesRes),
        readJsonResponse<any>(vmsRes),
        readJsonResponse<any>(customersRes),
        readJsonResponse<any>(productsRes),
      ])

      if (nodesRes.ok) setNodes(nodesData.nodes || [])
      if (vmsRes.ok) setVms(vmsData.vms || [])
      if (customersRes.ok) setCustomers(customersData.customers || [])
      if (productsRes.ok) setProducts(productsData.products || [])
    } catch (error) {
      toast.error("Failed to fetch infrastructure data")
    } finally {
      setLoading(false)
    }
  }

  const nodeOptions = nodes.map((node: any) => ({
    id: String(node.id || node.proxmoxNodeId || node.nodeId || ""),
    name: String(node.name || node.node || node.nodeName || "Node"),
    nodeName: String(node.nodeName || node.node || node.name || ""),
  })).filter((node) => node.id)

  async function runScanner(repair = false) {
    setToolBusy(repair ? "repair" : "scan")
    try {
      const res = await fetch("/api/admin/vms/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: tool.nodeId || null, repair }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Scanner failed")
      setScanResult(body.result)
      toast.success(repair ? "Scanner repair completed" : "Scanner completed")
      await loadData()
    } catch (error: any) {
      toast.error(error?.message || "Scanner failed")
    } finally {
      setToolBusy(null)
    }
  }

  async function scanImportable() {
    setToolBusy("import-scan")
    try {
      const res = await fetch("/api/admin/vms/import/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: tool.nodeId || null }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Import scan failed")
      setImportRows(body.vms || [])
      toast.success(`Found ${(body.vms || []).length} VMs`)
    } catch (error: any) {
      toast.error(error?.message || "Import scan failed")
    } finally {
      setToolBusy(null)
    }
  }

  async function importVm(vm: any) {
    if (!tool.customerId || !tool.productId) return toast.error("Choose customer and product first")
    setToolBusy(`import:${vm.nodeId}:${vm.vmid}`)
    try {
      const res = await fetch("/api/admin/vms/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: vm.nodeId,
          vmid: vm.vmid,
          customerId: tool.customerId,
          productId: tool.productId,
          termMonths: Number(tool.termMonths || 1),
          allowDefaultMonthly: true,
          reason: "Bulk import existing VM",
        }),
      })
      const body = await readJsonResponse<any>(res)
      if (!res.ok || !body?.success) throw new Error(body?.error || "Import failed")
      toast.success(`Imported VMID ${vm.vmid}`)
      await scanImportable()
      await loadData()
    } catch (error: any) {
      toast.error(error?.message || "Import failed")
    } finally {
      setToolBusy(null)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function performAction(vmid: number, action: "start" | "stop" | "reboot") {
    const res = await fetch(`/api/admin/proxmox/vms/${vmid}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    })
    if (!res.ok) {
      const data = await readJsonResponse<any>(res)
      toast.error(data.error || "Action failed")
      return
    }
    toast.success(`VM ${vmid} ${action}ed successfully`)
    await loadData()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Compute Infrastructure</h1>
        <p className="mt-1 text-muted-foreground">Manage virtualization nodes and virtual machines.</p>
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>VM Scanner</CardTitle>
          <CardDescription>Verify service mappings, detect orphaned VMs, and repair migration-safe note matches.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Node</span>
              <select className="h-9 rounded-md border border-border bg-background px-3 text-sm" value={tool.nodeId} onChange={(event) => setTool({ ...tool, nodeId: event.target.value })}>
                <option value="">All nodes</option>
                {nodeOptions.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.nodeName})</option>)}
              </select>
            </label>
            <Button variant="outline" disabled={toolBusy !== null} onClick={() => void runScanner(false)}>Scan All Nodes</Button>
            <Button disabled={toolBusy !== null} onClick={() => void runScanner(true)}>Repair Broken Mappings</Button>
          </div>
          {scanResult ? (
            <div className="rounded-md border border-border/40 p-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-5">
                <Metric label="Valid" value={scanResult.summary?.validMappings} />
                <Metric label="Broken" value={scanResult.summary?.brokenMappings} />
                <Metric label="Orphan VMs" value={scanResult.summary?.orphanedVms} />
                <Metric label="Orphan Services" value={scanResult.summary?.orphanedServices} />
                <Metric label="Repairable" value={scanResult.summary?.repairable} />
              </div>
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">{JSON.stringify(scanResult.rows || [], null, 2)}</pre>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Import Existing VMs</CardTitle>
          <CardDescription>Scan Proxmox inventory and create paid orders/services without creating new VMs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Customer</span>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={tool.customerId} onChange={(event) => setTool({ ...tool, customerId: event.target.value })}>
                <option value="">Select customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name ? `${customer.name} (${customer.email})` : customer.email}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Product</span>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={tool.productId} onChange={(event) => setTool({ ...tool, productId: event.target.value })}>
                <option value="">Select product</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Billing Cycle</span>
              <select className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" value={tool.termMonths} onChange={(event) => setTool({ ...tool, termMonths: event.target.value })}>
                <option value="1">1 month</option>
                <option value="3">3 months</option>
                <option value="6">6 months</option>
                <option value="12">12 months</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button variant="outline" disabled={toolBusy !== null} onClick={() => void scanImportable()}>Scan VMs</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VMID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>RAM</TableHead>
                  <TableHead>Disk</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Import</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importRows.map((vm) => (
                  <TableRow key={`${vm.nodeId}:${vm.vmid}`}>
                    <TableCell className="font-mono text-xs">{vm.vmid}</TableCell>
                    <TableCell>{vm.name}</TableCell>
                    <TableCell>{vm.nodeName}</TableCell>
                    <TableCell>{vm.cpu || "-"}</TableCell>
                    <TableCell>{vm.ramGb ? `${vm.ramGb} GB` : "-"}</TableCell>
                    <TableCell>{vm.diskGb ? `${vm.diskGb} GB` : "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{vm.ip || "-"}</TableCell>
                    <TableCell><Badge variant={vm.assigned ? "destructive" : vm.status === "running" ? "default" : "secondary"}>{vm.assigned ? "assigned" : vm.status}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" disabled={Boolean(vm.assigned) || toolBusy !== null} onClick={() => void importVm(vm)}>Import</Button></TableCell>
                  </TableRow>
                ))}
                {!importRows.length ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Scan a node to display importable VMs.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nodes.map((node) => (
          <Card key={node.node} className="glass border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {node.node}
                <Badge variant={node.stats?.status === "online" ? "default" : "destructive"}>
                  {node.stats?.status || "unknown"}
                </Badge>
              </CardTitle>
              <CardDescription>Node Status & Resources</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">CPU Usage:</span>
                <span>{node.cpuPercent ?? 0}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">RAM Usage:</span>
                <span>{node.memPercent ?? 0}%</span>
              </div>
              {node.memUsedGb != null ? (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">RAM:</span>
                  <span>{node.memUsedGb} GB / {node.memTotalGb} GB</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Virtual Machines</CardTitle>
          <CardDescription>All running and stopped instances across the cluster.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">Loading VMs...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>VMID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>RAM</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vms.map((vm) => (
                  <TableRow key={vm.vmid}>
                    <TableCell className="font-mono text-xs">{vm.vmid}</TableCell>
                    <TableCell>{vm.name}</TableCell>
                    <TableCell>{vm.node}</TableCell>
                    <TableCell>
                      <Badge variant={vm.status === "running" ? "default" : "secondary"}>
                        {vm.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{vm.cpus} vCPU</TableCell>
                    <TableCell>{(vm.maxmem / 1024 / 1024 / 1024).toFixed(1)} GB</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" onClick={() => performAction(vm.vmid, "start")}>
                        Start
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => performAction(vm.vmid, "stop")}>
                        Stop
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => performAction(vm.vmid, "reboot")}>
                        Reboot
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-border/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{Number(value || 0).toLocaleString()}</div>
    </div>
  )
}
