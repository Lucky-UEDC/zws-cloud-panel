"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock, Copy, ExternalLink, Loader2, Server, TerminalSquare } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"

type Deployment = {
  orderId: string
  orderNumber: string
  status: string
  serviceStatus?: string | null
  automationState: string
  currentStage: string
  displayStatus: string
  progress: number
  retryState?: { attempts: number; maxAttempts: number; nextRetryAt?: string | null; retryCountdownSeconds?: number | null }
  failure?: { reason: string; code?: string | null; suggestedFix?: string | null } | null
  vm: { id?: string | null; instanceId?: string | null; hostname?: string | null; ipAddress?: string | null; os?: string | null; plan?: string | null; status?: string | null }
  network: { status: string; ipAssigned: boolean; infrastructureZone?: string | null }
  stages: Array<{ key: string; title: string; status: string }>
  logs: Array<{ id: string; createdAt: string; level: string; title?: string; message: string }>
  createdAt: string
  updatedAt: string
}

function statusVariant(value: string) {
  const text = value.toLowerCase()
  if (text.includes("failed")) return "destructive" as const
  if (text.includes("completed") || text.includes("active")) return "default" as const
  return "secondary" as const
}

export default function ClientDeploymentTrackerPage() {
  const params = useParams<{ id: string }>()
  const id = String(params?.id || "")
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch(`/api/client/deployments/${id}`, { cache: "no-store" })
    const data = await readJsonResponse<any>(res)
    if (!res.ok) throw new Error(data?.error || "Deployment not found")
    setDeployment(data)
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (!id) return
    void load().catch((error) => {
      setLoading(false)
      toast.error(error.message || "Unable to load deployment")
    })
    const source = new EventSource(`/api/client/deployments/${id}/stream`)
    source.addEventListener("deployment", (message) => {
      const next = JSON.parse(String((message as MessageEvent).data || "{}"))
      setDeployment(next)
      setLoading(false)
    })
    source.onerror = () => source.close()
    return () => source.close()
  }, [id, load])

  const ready = String(deployment?.status || deployment?.serviceStatus || "").toUpperCase() === "ACTIVE"
  const failed = Boolean(deployment?.failure)
  const retryLabel = useMemo(() => {
    const seconds = deployment?.retryState?.retryCountdownSeconds
    if (seconds === null || seconds === undefined) return null
    if (seconds <= 0) return "Retry available now"
    const mins = Math.floor(seconds / 60)
    return mins > 0 ? `Retry in ${mins} min` : `Retry in ${seconds}s`
  }, [deployment?.retryState?.retryCountdownSeconds])

  const [redirected, setRedirected] = useState(false)

  useEffect(() => {
    if (ready && deployment?.vm?.id && !redirected) {
      setRedirected(true)
      window.setTimeout(() => {
        window.location.href = `/client-area/vps/${deployment.vm.id}`
      }, 1500)
    }
  }, [ready, deployment?.vm?.id, redirected])

  if (loading && !deployment) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">Deployment Tracking</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{deployment?.vm.hostname || deployment?.orderNumber || "Cloud deployment"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{deployment?.displayStatus || "Deploying"} · Order {deployment?.orderNumber}</p>
        </div>
        <div className="flex gap-2">
          {deployment?.vm.id ? <Button asChild><Link href={`/client-area/vps/${deployment.vm.id}`}>Open instance <ExternalLink className="ml-2 h-4 w-4" /></Link></Button> : null}
          <Button variant="outline" onClick={() => void load()}>Refresh</Button>
        </div>
      </div>

      <Card className="glass border-border/40">
        <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(deployment?.automationState || "")}>{deployment?.automationState || "pending"}</Badge>
              <Badge variant={ready ? "default" : failed ? "destructive" : "secondary"}>{ready ? "Your cloud server is ready" : failed ? "Manual intervention required" : "Automation active"}</Badge>
              {retryLabel ? <Badge variant="outline">{retryLabel}</Badge> : null}
            </div>
            <Progress value={deployment?.progress || 0} />
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Instance Status" value={deployment?.vm.status || deployment?.status || "-"} />
              <Metric label="Network" value={deployment?.network.ipAssigned ? "IP assigned" : "Waiting for IP"} />
              <Metric label="Infrastructure Zone" value={deployment?.network.infrastructureZone || "Default zone"} />
              <Metric label="Instance ID" value={deployment?.vm.instanceId || deployment?.vm.id || deployment?.orderId || "-"} />
            </div>
          </div>
          <div className="rounded-md border border-border/40 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><Server className="h-4 w-4" /> Instance profile</div>
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="Plan" value={deployment?.vm.plan || "-"} />
              <Row label="OS" value={deployment?.vm.os || "-"} />
              <Row label="IP Address" value={deployment?.vm.ipAddress || "-"} copyValue={deployment?.vm.ipAddress || ""} />
              <Row label="Started" value={deployment?.createdAt ? new Date(deployment.createdAt).toLocaleString() : "-"} />
            </dl>
          </div>
        </CardContent>
      </Card>

      {deployment?.failure ? (
        <Card className="border-red-500/30 bg-red-500/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-100"><AlertTriangle className="h-5 w-5" /> Deployment status</CardTitle>
            <CardDescription className="text-red-100/80">{deployment.failure.reason}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-2">
            <Metric label="Status Code" value={deployment.failure.code || "-"} />
            <Metric label="Current Status" value={deployment.status || "-"} />
            <div className="md:col-span-2 rounded-md border border-red-400/30 p-3 text-red-100">{deployment.failure.suggestedFix || "Open logs or contact support."}</div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle>Deployment timeline</CardTitle>
            <CardDescription>Live stages from order acceptance to service ready.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(deployment?.stages || []).map((stage) => (
              <div key={stage.key} className="flex items-center gap-3 rounded-md border border-border/40 p-3">
                {stage.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : stage.status === "running" ? <Loader2 className="h-5 w-5 animate-spin text-sky-400" /> : stage.status === "failed" ? <AlertTriangle className="h-5 w-5 text-red-400" /> : <Clock className="h-5 w-5 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{stage.title}</div>
                  <div className="text-xs capitalize text-muted-foreground">{stage.status}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TerminalSquare className="h-5 w-5" /> Live deployment logs</CardTitle>
            <CardDescription>Deployment events update automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-[520px] space-y-2 overflow-auto rounded-md bg-black/30 p-3 font-mono text-xs">
              {(deployment?.logs || []).map((log) => (
                <div key={log.id} className="border-b border-white/10 pb-2">
                  <div className="text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString()} · {log.level}</div>
                  <div>{log.message}</div>
                </div>
              ))}
              {!deployment?.logs?.length ? <div className="text-muted-foreground">Waiting for deployment events...</div> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border/40 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-all text-sm font-medium">{value}</div></div>
}

function Row({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-right font-medium">
        <span className="truncate">{value}</span>
        {copyValue ? <button type="button" onClick={() => navigator.clipboard.writeText(copyValue)}><Copy className="h-3.5 w-3.5" /></button> : null}
      </dd>
    </div>
  )
}
