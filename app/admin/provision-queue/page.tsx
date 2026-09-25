import Link from "next/link"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

export default async function ProvisionQueuePage() {
  const jobs = await prisma.provisioningJob.findMany({
    include: {
      order: { select: { orderNumber: true, status: true } },
      vpsInstance: { select: { id: true, name: true, status: true } },
      logs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Provision Queue</h1>
        <p className="mt-1 text-muted-foreground">Queued, running, failed, and completed VM provisioning jobs.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {["queued", "running", "failed", "completed"].map((status) => <Stat key={status} label={status} value={jobs.filter((job) => job.status === status).length} />)}
      </div>
      <Card className="glass border-border/40">
        <CardHeader>
          <CardTitle>Jobs</CardTitle>
          <CardDescription>Retry failed jobs from the VM detail page to preserve existing workflow safeguards.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr><th className="py-2">Job</th><th>Order</th><th>VM</th><th>Step</th><th>Status</th><th>Progress</th><th>Latest log</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b align-top">
                  <td className="py-2"><div className="font-mono text-xs">{job.id}</div><div className="text-xs text-muted-foreground">{job.createdAt.toLocaleString("en-IN")}</div></td>
                  <td>{job.order?.orderNumber || job.orderId || "-"}</td>
                  <td>{job.vpsInstance?.name || job.hostname || "-"}</td>
                  <td>{job.currentStep || "-"}</td>
                  <td><Badge variant={job.status === "failed" ? "destructive" : job.status === "completed" ? "default" : "secondary"}>{job.status}</Badge></td>
                  <td>{job.progress}%</td>
                  <td className="max-w-sm truncate">{job.error || job.logs[0]?.message || "-"}</td>
                  <td className="text-right">{job.vpsInstanceId ? <Button asChild size="sm" variant="outline"><Link href={`/admin/vms/${job.vpsInstanceId}`}>{job.status === "failed" ? "Retry" : "Manage"}</Link></Button> : "-"}</td>
                </tr>
              ))}
              {!jobs.length ? <tr><td colSpan={8} className="py-10 text-center text-muted-foreground">No provisioning jobs found.</td></tr> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="glass rounded-xl p-5"><div className="text-sm capitalize text-muted-foreground">{label}</div><div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div></div>
}
