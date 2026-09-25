"use client"

import { readJsonResponse } from "@/lib/client/safe-json"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type Block = { id: string; ip?: string; deviceFingerprint?: string; reason: string; attackType?: string; createdAt: string }
type EventRow = { id: string; eventType?: string; severity?: string; attackType?: string; ip?: string; route?: string; createdAt: string; actionTaken?: string }

export default function AdminSecurityPage() {
  const [ips, setIps] = useState<Block[]>([])
  const [devices, setDevices] = useState<Block[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [attacks, setAttacks] = useState<EventRow[]>([])
  const [failed, setFailed] = useState<EventRow[]>([])
  const [suspicious, setSuspicious] = useState<EventRow[]>([])
  const [report, setReport] = useState<any>(null)

  const load = useCallback(async () => {
    const [blocksRes, eventsRes, reportRes] = await Promise.all([
      fetch("/api/admin/security/blocks", { cache: "no-store" }),
      fetch("/api/admin/security/events", { cache: "no-store" }),
      fetch("/api/admin/security/report", { cache: "no-store" }),
    ])
    const blocks = await readJsonResponse<any>(blocksRes)
    const eventData = await readJsonResponse<any>(eventsRes)
    const reportData = await readJsonResponse<any>(reportRes).catch(() => null)
    if (blocksRes.ok) {
      setIps(blocks.ips || [])
      setDevices(blocks.devices || [])
    }
    if (eventsRes.ok) {
      setEvents(eventData.events || [])
      setAttacks(eventData.attacks || [])
      setFailed(eventData.failed || [])
      setSuspicious(eventData.suspicious || [])
    }
    if (reportRes.ok) setReport(reportData?.report || null)
  }, [])

  useEffect(() => { void load() }, [load])

  async function unblock(id: string) {
    const res = await fetch(`/api/admin/security/blocks/${id}/unblock`, { method: "POST" })
    if (!res.ok) return toast.error("Unable to unblock entry")
    toast.success("Block removed")
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Security Center</h1>
        <p className="mt-1 text-muted-foreground">Blocked IPs, suspicious devices, payload attacks, failed attempts, and abuse controls.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Blocked IPs" value={ips.length} />
        <Metric label="Blocked Devices" value={devices.length} />
        <Metric label="Attack Logs" value={attacks.length} />
        <Metric label="Suspicious Requests" value={suspicious.length} />
      </div>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Security Report</CardTitle><CardDescription>Host hardening recommendations, Cloudflare Tunnel validation, and secret scan status.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <ReportTile label="Fail2Ban Recommendations" value={report?.fail2ban?.recommended ? "Recommended" : "Unavailable"} />
          <ReportTile label="UFW Recommendations" value={report?.ufw?.cloudflareOnlyMode ? "Cloudflare-only" : "Review"} />
          <ReportTile label="Cloudflare Tunnel Validation" value={report?.cloudflareTunnel?.ok ? "Healthy" : "Attention"} />
          <ReportTile label="Open Ports" value={String(report?.openPorts?.length || 0)} />
          <ReportTile label="Exposed Services" value={String((report?.exposedServices || []).filter((row: any) => row.exposedInCloudflareOnlyMode).length)} />
          <ReportTile label="SSL Health" value={report?.sslHealth?.ok ? "Healthy" : "Attention"} />
          <ReportTile label="Secret Scanner" value={report?.secretScanner?.ok ? "Clean" : `${report?.secretScanner?.findings?.length || 0} findings`} />
        </CardContent>
      </Card>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Active Blocks</CardTitle><CardDescription>Permanent and temporary access denies.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {[...ips.map((item) => ({ ...item, type: "IP" })), ...devices.map((item) => ({ ...item, type: "Device" }))].map((item) => (
            <div key={`${item.type}-${item.id}`} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2"><Badge>{item.type}</Badge><span className="font-mono text-sm">{item.ip || item.deviceFingerprint}</span><span className="text-sm text-muted-foreground">{item.attackType || item.reason}</span></div>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => unblock(item.id)}>Unblock</Button>
            </div>
          ))}
          {!ips.length && !devices.length ? <p className="text-sm text-muted-foreground">No active blocks.</p> : null}
        </CardContent>
      </Card>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Recent Attacks</CardTitle><CardDescription>Rejected malicious payload attempts.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {attacks.map((row) => <LogRow key={row.id} row={row} label={row.attackType || "attack"} />)}
          {!attacks.length ? <p className="text-sm text-muted-foreground">No attack logs.</p> : null}
        </CardContent>
      </Card>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Security Events</CardTitle><CardDescription>Rate limits, block decisions, and security failures.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {events.map((row) => <LogRow key={row.id} row={row} label={row.eventType || "event"} />)}
          {!events.length ? <p className="text-sm text-muted-foreground">No security events.</p> : null}
        </CardContent>
      </Card>
      <Card className="glass border-border/40">
        <CardHeader><CardTitle>Suspicious Requests</CardTitle><CardDescription>Captcha, OTP, rate-limit, and spam signals.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {suspicious.map((row: any) => <LogRow key={row.id} row={row} label={row.reason || "suspicious"} />)}
          {!suspicious.length ? <p className="text-sm text-muted-foreground">No suspicious requests.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card className="glass border-border/40"><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></CardContent></Card>
}

function ReportTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/40 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>
}

function LogRow({ row, label }: { row: EventRow; label: string }) {
  return (
    <div className="rounded-lg border border-border/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{label}</Badge><span>{row.route || "unknown route"}</span><span className="text-muted-foreground">{row.ip || "unknown IP"}</span></div>
      <p className="mt-1 text-xs text-muted-foreground">{row.actionTaken || row.severity || "logged"} · {new Date(row.createdAt).toLocaleString()}</p>
    </div>
  )
}
