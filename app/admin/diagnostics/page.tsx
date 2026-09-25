import { prisma } from "@/lib/db"
import { safeAdminQuery } from "@/lib/admin-safe-query"
import { readProvisionWorkerHeartbeat } from "@/lib/provision-worker-status"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getIntegrityHealth } from "@/lib/integrity-health"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminDiagnosticsPage() {
  const [worker, integrity, queueCounts, failedJobs, nodes] = await Promise.all([
    readProvisionWorkerHeartbeat(),
    safeAdminQuery("diagnostics.integrity", getIntegrityHealth, null),
    safeAdminQuery("diagnostics.queue.counts", () => prisma.provisioningJob.groupBy({ by: ["status", "type"], _count: { _all: true } }), []),
    safeAdminQuery("diagnostics.queue.jobs", () => prisma.provisioningJob.findMany({
      where: { status: { in: ["failed", "waiting_for_admin", "running", "queued", "retrying"] } },
      select: { id: true, type: true, status: true, currentStep: true, error: true, updatedAt: true, orderId: true, vpsInstanceId: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }), []),
    safeAdminQuery("diagnostics.proxmox.nodes", () => prisma.proxmoxNode.findMany({
      select: { id: true, name: true, nodeName: true, host: true, status: true, lastCheckedAt: true, isActive: true },
      orderBy: { createdAt: "asc" },
    }), []),
  ])
  const queueWarning = queueCounts.warning || failedJobs.warning || nodes.warning

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div>
        <h1 className="text-3xl font-semibold">Diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">Runtime, worker, queue, and Proxmox health.</p>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Database Integrity</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <StatusBadge ok={Boolean(integrity.data?.healthy)} label={integrity.data?.healthy ? "Healthy" : "Repair required"} />
          {integrity.data ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(integrity.data).filter(([key]) => key !== "healthy").map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded border border-border/40 px-3 py-2">
                <span className="text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</span>
                <Badge variant={Number(value) > 0 ? "destructive" : "secondary"}>{String(value)}</Badge>
              </div>
            ))}
          </div> : <div className="text-destructive">{integrity.warning || "Integrity query failed"}</div>}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Provision Worker</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <StatusBadge ok={Boolean(worker?.healthy)} label={worker?.healthy ? "Healthy" : "Offline or stale"} />
            <div className="text-muted-foreground">Last heartbeat: {worker?.heartbeatAt ? new Date(worker.heartbeatAt).toLocaleString("en-IN") : "never"}</div>
            <div className="text-muted-foreground">Processed: {worker?.processed ?? 0} · Errors: {worker?.errors ?? 0}</div>
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
        <CardHeader><CardTitle>Queue</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
            {queueCounts.data.map((row) => (
              <div key={`${row.type}-${row.status}`} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{row.type} / {row.status}</span>
                <Badge variant="secondary">{row._count._all}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="glass border-border/40">
          <CardHeader><CardTitle>Proxmox Nodes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {nodes.data.map((node) => (
              <div key={node.id} className="min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium">{node.name}</span>
                  <StatusBadge ok={node.isActive && node.status === "connected"} label={node.status || "unknown"} />
                </div>
                <div className="truncate text-xs text-muted-foreground">{node.nodeName} · {node.host}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Active And Failed Jobs</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr><th className="py-2">Job</th><th>Type</th><th>Status</th><th>Step</th><th>Order</th><th>Updated</th><th>Error</th></tr>
            </thead>
            <tbody>
              {failedJobs.data.map((job) => (
                <tr key={job.id} className="border-b align-top">
                  <td className="py-2 font-mono text-xs">{job.id}</td>
                  <td>{job.type}</td>
                  <td><Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge></td>
                  <td>{job.currentStep || "-"}</td>
                  <td>{job.orderId || "-"}</td>
                  <td>{job.updatedAt.toLocaleString("en-IN")}</td>
                  <td className="max-w-sm truncate">{job.error || "-"}</td>
                </tr>
              ))}
              {!failedJobs.data.length ? <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{queueWarning || "No active or failed jobs."}</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "default" : "destructive"}>{label}</Badge>
}
