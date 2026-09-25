"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Activity, Gauge, Signal, ArrowDownToLine, ArrowUpToLine } from "lucide-react"

/**
 * Dynamic cloud terminal + dashboard hero panel.
 *
 * IMPORTANT — UI simulation only (no backend).
 * All values are driven by local timers and randomized within realistic
 * ranges. When Codex wires up the real API this component should swap
 * its simulation hooks (see useSimulatedMetrics / useSimulatedLogs) for
 * data fetched from the backend (WebSocket or SSE recommended).
 *
 * What renders:
 *  - Header bar with region, status pulse, and live uptime counter
 *  - Metric tiles: Ping, Latency, Download, Upload (all animated)
 *  - Rolling "terminal" log with syntax-colored status tags
 *
 * Design notes:
 *  - Full glass surface that sits over the global dot field
 *  - No horizontal divider rules (per the project-wide design rule)
 *  - Uses only the project color tokens + the accent teal for cyan glow
 */

// ---------- Simulation hooks ----------

// A fixed ISO timestamp used as the "system boot" moment. We compute the
// uptime delta live in the browser so the counter always advances from
// a stable reference rather than the mount time of the component.
const BOOT_TIMESTAMP = new Date("2024-06-01T00:00:00Z").getTime()

function useUptime() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return useMemo(() => {
    const diff = Math.max(0, now - BOOT_TIMESTAMP)
    const days = Math.floor(diff / 86_400_000)
    const hours = Math.floor((diff % 86_400_000) / 3_600_000)
    const minutes = Math.floor((diff % 3_600_000) / 60_000)
    const seconds = Math.floor((diff % 60_000) / 1000)
    return { days, hours, minutes, seconds }
  }, [now])
}

type Metrics = {
  ping: number // ms, 1–5
  latency: number // ms, realistic
  download: number // Gbps, 1–25
  upload: number // Gbps, 1–25
}

function randBetween(min: number, max: number, decimals = 1) {
  const v = Math.random() * (max - min) + min
  const p = 10 ** decimals
  return Math.round(v * p) / p
}

function useSimulatedMetrics(interval = 1400) {
  const [metrics, setMetrics] = useState<Metrics>({
    ping: 2,
    latency: 18,
    download: 12.4,
    upload: 9.8,
  })

  useEffect(() => {
    const id = setInterval(() => {
      setMetrics((prev) => ({
        // Ping drifts gently within 1–5 ms.
        ping: clamp(prev.ping + randBetween(-0.6, 0.6, 1), 1, 5),
        // Latency smooths around a target between 12–45 ms.
        latency: clamp(prev.latency + randBetween(-3, 3, 0), 12, 45),
        // Up/down speeds drift between 1–25 Gbps.
        download: clamp(prev.download + randBetween(-1.8, 1.8, 1), 1, 25),
        upload: clamp(prev.upload + randBetween(-1.4, 1.4, 1), 1, 25),
      }))
    }, interval)
    return () => clearInterval(id)
  }, [interval])

  return metrics
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v * 10) / 10))
}

type LogLevel = "info" | "ok" | "warn"
type LogLine = { id: number; level: LogLevel; tag: string; text: string }

const LOG_POOL: Array<Omit<LogLine, "id">> = [
  { level: "info", tag: "net", text: "Routing traffic through BGP anycast edge" },
  { level: "ok", tag: "sla", text: "SLA monitor heartbeat · 99.997% window" },
  { level: "info", tag: "prov", text: "Provisioning vps-4872 · region=bom · 4 vCPU" },
  { level: "ok", tag: "net", text: "Network active · IPv4+IPv6 attached" },
  { level: "info", tag: "edge", text: "Cache warm · 812 objects preloaded" },
  { level: "ok", tag: "ddos", text: "DDoS shield calibrated · 0 anomalies" },
  { level: "info", tag: "snap", text: "Snapshot committed · size=38.1 GB" },
  { level: "warn", tag: "scale", text: "Autoscaler queued: +1 node on pool-web" },
  { level: "ok", tag: "hc", text: "Health check OK · /api/status 200" },
  { level: "info", tag: "backup", text: "Encrypted backup rolled · retention=14d" },
  { level: "ok", tag: "peer", text: "Private mesh link up · lat=0.8ms" },
]

function useSimulatedLogs(max = 5, tickMs = 1800) {
  const [logs, setLogs] = useState<LogLine[]>(() =>
    LOG_POOL.slice(0, max).map((l, i) => ({ ...l, id: i }))
  )
  const counter = useRef(max)

  useEffect(() => {
    const id = setInterval(() => {
      const next = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)]
      counter.current += 1
      setLogs((prev) => {
        const copy = [...prev, { ...next, id: counter.current }]
        return copy.slice(-max)
      })
    }, tickMs)
    return () => clearInterval(id)
  }, [max, tickMs])

  return logs
}

// ---------- Presentational ----------

export function TerminalDashboard({ brandLabel = "cloud" }: { brandLabel?: string }) {
  const uptime = useUptime()
  const metrics = useSimulatedMetrics()
  const logs = useSimulatedLogs()

  return (
    <div className="relative">
      {/* Ambient cyan glow behind the panel. */}
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--accent)_22%,transparent),transparent_70%)] blur-2xl" />

      <div className="glass glass-strong accent-glow relative overflow-hidden rounded-2xl">
        {/* Header: window chrome + region + live uptime */}
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-muted/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-muted/70" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-muted/70" aria-hidden />
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {brandLabel} · bom-edge-01
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="relative inline-flex items-center gap-1.5 text-accent">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="status-pulse absolute inset-0 rounded-full bg-accent" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              LIVE
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              up{" "}
              <span className="text-foreground">
                {uptime.days}d {pad(uptime.hours)}:{pad(uptime.minutes)}:{pad(uptime.seconds)}
              </span>
            </span>
          </div>
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
          <MetricTile
            icon={<Gauge className="h-3.5 w-3.5" />}
            label="Ping"
            value={metrics.ping.toFixed(1)}
            unit="ms"
          />
          <MetricTile
            icon={<Signal className="h-3.5 w-3.5" />}
            label="Latency"
            value={Math.round(metrics.latency).toString()}
            unit="ms"
          />
          <MetricTile
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label="Download"
            value={metrics.download.toFixed(1)}
            unit="Gbps"
            bar={metrics.download / 25}
          />
          <MetricTile
            icon={<ArrowUpToLine className="h-3.5 w-3.5" />}
            label="Upload"
            value={metrics.upload.toFixed(1)}
            unit="Gbps"
            bar={metrics.upload / 25}
          />
        </div>

        {/* Log panel */}
        <div className="mx-3 mb-3 rounded-xl bg-background/60 p-4 font-mono text-[12px] leading-relaxed">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-accent" />
              Live system log
            </span>
            <span>stream · tail -f</span>
          </div>
          <ul aria-live="polite" className="flex flex-col gap-1">
            {logs.map((l) => (
              <li key={l.id} className="row-in flex items-baseline gap-2">
                <span
                  className={
                    l.level === "ok"
                      ? "text-accent"
                      : l.level === "warn"
                        ? "text-foreground/80"
                        : "text-muted-foreground"
                  }
                >
                  {l.level === "ok" ? "✓" : l.level === "warn" ? "!" : "→"}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  [{l.tag}]
                </span>
                <span className="text-foreground/90">{l.text}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-0.5 text-muted-foreground">
              <span>$</span>
              <span className="caret-blink inline-block h-3 w-1.5 bg-foreground/70" />
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function pad(n: number) {
  return n.toString().padStart(2, "0")
}

function MetricTile({
  icon,
  label,
  value,
  unit,
  bar,
}: {
  icon: React.ReactNode
  label: string
  value: string
  unit: string
  bar?: number
}) {
  return (
    <div className="glass glass-hover rounded-xl p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5 text-accent">
          {icon}
          <span className="text-muted-foreground">{label}</span>
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground transition-all">
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {typeof bar === "number" && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-foreground/5">
          <div
            className="h-full rounded-full bg-accent/80 transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(4, Math.min(100, bar * 100))}%` }}
          />
        </div>
      )}
    </div>
  )
}
