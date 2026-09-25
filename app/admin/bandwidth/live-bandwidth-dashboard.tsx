"use client"

import Link from "next/link"
import { Activity, AlertTriangle, Download, Network, Server, TrendingUp } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { throttleStatusLabel } from "@/lib/live-bandwidth"

type DashboardData = {
  vms: any[]
  nodes: any[]
  alerts: any[]
  global: Record<string, any>
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatBytes(value: unknown) {
  const bytes = numberValue(value)
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}

function formatRate(value: unknown) {
  return `${formatBytes(value)}/s`
}

function mbpsFromBytesPerSecond(value: unknown) {
  return Number(((numberValue(value) * 8) / 1_000_000).toFixed(3))
}

function kbpsFromBytesPerSecond(value: unknown) {
  return Number(((numberValue(value) * 8) / 1_000).toFixed(1))
}

function formatMbps(value: unknown) {
  return numberValue(value).toFixed(3)
}

function formatKbps(value: unknown) {
  return numberValue(value).toFixed(1)
}

function liveState(row: any, now = Date.now()) {
  if (row.throttled) return "throttled"
  const sampledAt = row.sampledAt ? new Date(row.sampledAt).getTime() : 0
  if (!sampledAt || now - sampledAt > 5000) return "stale"
  return numberValue(row.rxRateBps) + numberValue(row.txRateBps) > 1024 ? "active" : "idle"
}

function mergeByKey(existing: any[], incoming: any[], keyName: string, mergeOnlyLive = false) {
  const byKey = new Map(existing.map((row) => [String(row[keyName] || row.nodeId || row.nodeName || ""), row]))
  for (const row of incoming || []) {
    const key = String(row[keyName] || row.nodeId || row.nodeName || "")
    if (!key) continue
    const previous = byKey.get(key) || {}
    byKey.set(key, mergeOnlyLive ? { ...previous, ...row } : row)
  }
  return Array.from(byKey.values())
}

function normalize(data: any): DashboardData {
  return {
    vms: Array.isArray(data?.vms) ? data.vms : [],
    nodes: Array.isArray(data?.nodes) ? data.nodes : [],
    alerts: Array.isArray(data?.alerts) ? data.alerts : [],
    global: data?.global || {},
  }
}

export function LiveBandwidthDashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState<DashboardData>(() => normalize(initialData))
  const [streamState, setStreamState] = useState<"connecting" | "live" | "stale" | "offline">("connecting")
  const [lastLiveAt, setLastLiveAt] = useState<number>(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const source = new EventSource("/api/admin/bandwidth/live/stream")
    source.addEventListener("ready", () => setStreamState("live"))
    source.addEventListener("initial", (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      setData(normalize(payload))
      setStreamState("live")
    })
    source.addEventListener("live", (event) => {
      const payload = JSON.parse((event as MessageEvent).data)
      setLastLiveAt(Date.now())
      setStreamState("live")
      setData((current) => ({
        ...current,
        vms: mergeByKey(current.vms, payload?.vms || [], "vpsInstanceId", true),
        nodes: mergeByKey(current.nodes, payload?.nodes || [], "nodeId", true),
      }))
    })
    source.addEventListener("heartbeat", () => setStreamState((state) => (state === "offline" ? state : "live")))
    source.onerror = () => setStreamState("offline")
    return () => source.close()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nextNow = Date.now()
      setNow(nextNow)
      if (lastLiveAt && nextNow - lastLiveAt > 5000) setStreamState("stale")
    }, 1000)
    return () => window.clearInterval(interval)
  }, [lastLiveAt])

  const vms = useMemo(() => data.vms.map((row) => ({ ...row, liveState: liveState(row, now) })), [data.vms, now])
  const nodes = data.nodes
  const alerts = data.alerts
  const global = data.global || {}
  const liveThroughputBps = nodes.reduce((sum: number, row: any) => sum + numberValue(row.rxRateBps) + numberValue(row.txRateBps), 0)
  const peakRate = Math.max(numberValue(global.peakRateBps), ...vms.map((row) => numberValue(row.peakRateBps)))
  const throttledCount = vms.filter((vm) => vm.throttled).length
  const overLimitCount = vms.filter((vm) => vm.overLimit).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-normal">Bandwidth Usage</h1>
            <LiveStreamBadge state={streamState} />
          </div>
          <p className="text-sm text-muted-foreground">Monthly accounting from rollups with 1-second live Proxmox throughput for current usage.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href="/api/admin/bandwidth?format=csv"><Download className="h-4 w-4" />CSV</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/api/admin/bandwidth?format=pdf"><Download className="h-4 w-4" />PDF</Link></Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard title="Monthly Transfer" value={formatBytes(global.monthlyTransferBytes)} detail={`Today ${formatBytes(global.dailyTransferBytes)}`} />
        <SummaryCard title="Download / Upload" value={`${formatBytes(global.monthlyRxBytes)} / ${formatBytes(global.monthlyTxBytes)}`} detail="Current billing month" />
        <SummaryCard title="Live Platform Rate" value={`${formatMbps(mbpsFromBytesPerSecond(liveThroughputBps))} Mbps`} detail={`Peak ${formatRate(peakRate)}`} />
        <SummaryCard title="Warnings" value={`${alerts.length}`} detail={`${overLimitCount} over limit / ${throttledCount} throttled`} warning={alerts.length > 0 || throttledCount > 0} />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" />Per VM Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[1400px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 pr-4">Customer</th>
                <th className="py-3 pr-4">VM</th>
                <th className="py-3 pr-4">Node</th>
                <th className="py-3 pr-4">Upload</th>
                <th className="py-3 pr-4">Download</th>
                <th className="py-3 pr-4">Total</th>
                <th className="py-3 pr-4">Limit</th>
                <th className="py-3 pr-4">Remaining</th>
                <th className="py-3 pr-4">Current</th>
                <th className="py-3 pr-4">Peak</th>
                <th className="py-3 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {vms.map((row: any) => (
                <tr key={row.vpsInstanceId || row.id} className="border-b last:border-0">
                  <td className="py-3 pr-4"><div>{row.customerName}</div><div className="text-xs text-muted-foreground">{row.customerEmail || "-"}</div></td>
                  <td className="py-3 pr-4"><div className="font-medium">{row.vmName}</div><div className="text-xs text-muted-foreground">VMID {row.vmid || "-"} / {row.ipAddress || "-"}</div></td>
                  <td className="py-3 pr-4">{row.nodeName}</td>
                  <td className="py-3 pr-4">{formatBytes(row.txBytes)}</td>
                  <td className="py-3 pr-4">{formatBytes(row.rxBytes)}</td>
                  <td className="py-3 pr-4">{formatBytes(row.totalBytes)}</td>
                  <td className="py-3 pr-4">{row.bandwidthLimitTb ? `${row.bandwidthLimitTb} TB` : "-"}</td>
                  <td className="py-3 pr-4">{formatBytes(row.remainingBytes)}</td>
                  <td className="py-3 pr-4"><CurrentCell row={row} /></td>
                  <td className="py-3 pr-4">{formatRate(row.peakRateBps)}</td>
                  <td className="py-3 pr-4"><StatusCell row={row} /></td>
                </tr>
              ))}
              {!vms.length ? <EmptyRow colSpan={11} label="No VM bandwidth rows yet." /> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4" />Per Node Totals</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="py-3 pr-4">Node</th>
                <th className="py-3 pr-4">Node Transfer</th>
                <th className="py-3 pr-4">Upload Throughput</th>
                <th className="py-3 pr-4">Download Throughput</th>
                <th className="py-3 pr-4">Active Mbps</th>
                <th className="py-3 pr-4">Peak Rate</th>
                <th className="py-3 pr-4">VMs</th>
                <th className="py-3 pr-4">Throttled</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((row: any) => (
                <tr key={row.nodeId || row.nodeName} className="border-b last:border-0">
                  <td className="py-3 pr-4"><div className="font-medium">{row.nodeName}</div><div className="text-xs text-muted-foreground">{row.sampledAt ? "Live sample active" : "Waiting for live sample"}</div></td>
                  <td className="py-3 pr-4">{formatBytes(row.totalBytes)}<div className="text-xs text-muted-foreground">RX {formatBytes(row.rxBytes)} / TX {formatBytes(row.txBytes)}</div></td>
                  <td className="py-3 pr-4">{formatRate(row.txRateBps)}</td>
                  <td className="py-3 pr-4">{formatRate(row.rxRateBps)}</td>
                  <td className="py-3 pr-4">{formatMbps(row.activeMbps ?? mbpsFromBytesPerSecond(numberValue(row.rxRateBps) + numberValue(row.txRateBps)))} Mbps<div className="text-xs text-muted-foreground">{formatKbps(row.currentKbps ?? kbpsFromBytesPerSecond(numberValue(row.rxRateBps) + numberValue(row.txRateBps)))} Kbps</div></td>
                  <td className="py-3 pr-4">{formatRate(row.peakRateBps)}</td>
                  <td className="py-3 pr-4">{row.activeVmCount}</td>
                  <td className="py-3 pr-4">{row.throttledVmCount}</td>
                </tr>
              ))}
              {!nodes.length ? <EmptyRow colSpan={8} label="No node bandwidth rows yet." /> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Warning Alerts</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr className="border-b"><th className="py-3 pr-4">Type</th><th className="py-3 pr-4">VM</th><th className="py-3 pr-4">Usage</th><th className="py-3 pr-4">Message</th><th className="py-3 pr-4">Last Seen</th></tr></thead>
            <tbody>
              {alerts.map((alert: any) => (
                <tr key={alert.id} className="border-b last:border-0">
                  <td className="py-3 pr-4">{alert.alertType}</td>
                  <td className="py-3 pr-4">{alert.vpsInstanceId}</td>
                  <td className="py-3 pr-4">{formatBytes(alert.currentBytes)} / {formatBytes(alert.thresholdBytes)}</td>
                  <td className="py-3 pr-4">{alert.message}</td>
                  <td className="py-3 pr-4">{alert.lastSeenAt ? new Date(alert.lastSeenAt).toLocaleString("en-IN") : "-"}</td>
                </tr>
              ))}
              {!alerts.length ? <EmptyRow colSpan={5} label="No open bandwidth alerts." /> : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

function LiveStreamBadge({ state }: { state: "connecting" | "live" | "stale" | "offline" }) {
  const className = state === "live" ? "bg-emerald-500" : state === "stale" ? "bg-slate-400" : state === "offline" ? "bg-red-500" : "bg-amber-500"
  const label = state === "live" ? "LIVE" : state === "stale" ? "STALE" : state === "offline" ? "OFFLINE" : "CONNECTING"
  return <Badge variant="outline" className="gap-2"><span className={`h-2 w-2 rounded-full ${className} ${state === "live" ? "animate-pulse" : ""}`} />{label}</Badge>
}

function LiveDot({ state }: { state: string }) {
  const color = state === "active" ? "bg-emerald-500" : state === "throttled" ? "bg-amber-500" : "bg-slate-400"
  return <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${color} ${state === "active" || state === "throttled" ? "animate-pulse" : ""}`} />
}

function CurrentCell({ row }: { row: any }) {
  const combinedBps = numberValue(row.rxRateBps) + numberValue(row.txRateBps)
  const currentMbps = row.currentMbps ?? mbpsFromBytesPerSecond(combinedBps)
  const currentKbps = row.currentKbps ?? kbpsFromBytesPerSecond(combinedBps)
  return (
    <div className="flex min-w-[180px] gap-2">
      <LiveDot state={row.liveState} />
      <div>
        <div className="font-medium tabular-nums">{formatMbps(currentMbps)} Mbps</div>
        <div className="text-xs text-muted-foreground tabular-nums">{formatKbps(currentKbps)} Kbps live</div>
        <div className="text-xs text-muted-foreground tabular-nums">Down {formatMbps(mbpsFromBytesPerSecond(row.rxRateBps))} Mbps / Up {formatMbps(mbpsFromBytesPerSecond(row.txRateBps))} Mbps</div>
      </div>
    </div>
  )
}

function StatusCell({ row }: { row: any }) {
  const label = row.throttled ? throttleStatusLabel(row) : row.overLimit ? "Over limit" : "Clear"
  return (
    <div className="space-y-1">
      <Badge variant={row.throttled ? "destructive" : row.overLimit ? "secondary" : "outline"}>{label}</Badge>
      {row.currentRateLimit != null ? <div className="text-xs text-muted-foreground">Proxmox rate={row.currentRateLimit}</div> : null}
    </div>
  )
}

function SummaryCard({ title, value, detail, warning = false }: { title: string; value: string; detail: string; warning?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-sm">{warning ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <Network className="h-4 w-4" />}{title}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></CardContent>
    </Card>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-muted-foreground">
        <Activity className="mx-auto mb-2 h-5 w-5" />
        {label}
      </td>
    </tr>
  )
}
