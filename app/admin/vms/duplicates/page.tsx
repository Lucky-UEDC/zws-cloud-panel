"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { readJsonResponse } from "@/lib/client/safe-json"
import { toast } from "sonner"

export default function DuplicateVmReviewPage() {
  const [rows, setRows] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const body = await readJsonResponse<any>(await fetch("/api/admin/vms/duplicates", { cache: "no-store" }))
    if (!body.success) throw new Error(body.error || "Unable to load duplicate incidents")
    setRows(body.incidents || [])
  }, [])

  useEffect(() => { void load().catch((error) => toast.error(error.message)) }, [load])

  async function scanToday() {
    setBusy("scan")
    try {
      const response = await fetch("/api/admin/vms/duplicates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: true, createdFrom: "2026-07-02T00:00:00.000Z" }) })
      const body = await readJsonResponse<any>(response)
      if (!response.ok || !body.success) throw new Error(body.error || "Scan failed")
      toast.success(`Scanned ${body.result.scanned}; quarantined ${body.result.quarantined}.`)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Scan failed")
    } finally {
      setBusy(null)
    }
  }

  async function remove(row: any) {
    if (!window.confirm(`Permanently delete duplicate VMID ${row.vmid}? Primary VMID ${row.primaryVmid} will be revalidated first.`)) return
    setBusy(row.id)
    try {
      const response = await fetch(`/api/admin/vms/duplicates/${encodeURIComponent(row.id)}/delete`, { method: "POST" })
      const body = await readJsonResponse<any>(response)
      if (!response.ok || !body.success) throw new Error(body.error || "Cleanup failed")
      toast.success(`Duplicate VMID ${row.vmid} deleted.`)
      await load()
    } catch (error: any) {
      toast.error(error?.message || "Cleanup failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm"><Link href="/admin/vms"><ArrowLeft className="mr-2 h-4 w-4" />Virtual Machines</Link></Button>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold"><ShieldAlert className="h-6 w-6 text-amber-500" />Duplicate VM Review</h1>
          <p className="text-sm text-muted-foreground">Quarantined machines are stopped and excluded from customer automation. Deletion always requires approval.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          <Button disabled={busy === "scan"} onClick={() => void scanToday()}>Scan today and quarantine</Button>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle>Cleanup queue ({rows.filter((row) => row.status !== "DELETED").length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Status</th><th>Order</th><th>Node</th><th>Duplicate</th><th>Primary</th><th>IP</th><th>Detected</th><th className="text-right">Action</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} className="border-b last:border-0">
              <td className="py-3"><Badge variant={row.status === "DELETED" ? "secondary" : "destructive"}>{row.status}</Badge></td>
              <td>{row.order?.orderNumber || row.orderId}</td><td>{row.proxmoxNode?.nodeName || row.proxmoxNodeId}</td><td>VMID {row.vmid}</td><td>VMID {row.primaryVmid}</td><td>{row.detectedIp || "-"}</td><td>{new Date(row.detectedAt).toLocaleString()}</td>
              <td className="text-right"><Button size="sm" variant="destructive" disabled={row.status === "DELETED" || busy === row.id} onClick={() => void remove(row)}><Trash2 className="mr-2 h-4 w-4" />Permanent cleanup</Button></td>
            </tr>)}</tbody>
          </table>
          {!rows.length && <p className="py-8 text-center text-muted-foreground">No duplicate incidents recorded.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
