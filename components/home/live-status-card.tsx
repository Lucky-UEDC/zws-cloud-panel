"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { 
  Activity, 
  Gauge, 
  Signal, 
  ArrowDownToLine, 
  ArrowUpToLine, 
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Enhanced Live Status Card with interactive expandable metrics
 * 
 * Features:
 * - Larger card with improved visibility
 * - Click-to-expand metric tiles with mini line charts
 * - Trend indicators (up/down/stable)
 * - Analytics tracking for metric interactions
 * - History data for sparkline visualization
 */

// ---------- Types ----------
type MetricType = "ping" | "latency" | "download" | "upload"

type MetricData = {
  value: number
  history: number[]
  trend: "up" | "down" | "stable"
}

type Metrics = Record<MetricType, MetricData>

// ---------- Analytics Tracking ----------
async function trackMetricClick(metricType: MetricType, isExpanding: boolean) {
  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "interaction",
        event_name: "metric_click",
        properties: {
          metric_type: metricType,
          action: isExpanding ? "expand" : "collapse",
          timestamp: new Date().toISOString()
        }
      })
    })
  } catch {
    // Silent fail - analytics should not break UX
  }
}

// ---------- Simulation hooks ----------
const BOOT_TIMESTAMP = new Date("2024-06-01T00:00:00Z").getTime()
const HISTORY_LENGTH = 20

function useUptime() {
  // Start with null to avoid hydration mismatch
  const [uptime, setUptime] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null)

  useEffect(() => {
    // Calculate immediately on mount
    const calculateUptime = () => {
      const diff = Math.max(0, Date.now() - BOOT_TIMESTAMP)
      const days = Math.floor(diff / 86_400_000)
      const hours = Math.floor((diff % 86_400_000) / 3_600_000)
      const minutes = Math.floor((diff % 3_600_000) / 60_000)
      const seconds = Math.floor((diff % 60_000) / 1000)
      setUptime({ days, hours, minutes, seconds })
    }
    
    calculateUptime()
    const id = setInterval(calculateUptime, 1000)
    return () => clearInterval(id)
  }, [])

  // Return stable initial values during SSR
  return uptime ?? { days: 0, hours: 0, minutes: 0, seconds: 0 }
}

function randBetween(min: number, max: number, decimals = 1) {
  const v = Math.random() * (max - min) + min
  const p = 10 ** decimals
  return Math.round(v * p) / p
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v * 10) / 10))
}

function calculateTrend(history: number[]): "up" | "down" | "stable" {
  if (history.length < 3) return "stable"
  const recent = history.slice(-5)
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length
  const first = recent[0]
  const diff = avg - first
  const threshold = avg * 0.05 // 5% threshold
  if (diff > threshold) return "up"
  if (diff < -threshold) return "down"
  return "stable"
}

// Static initial values to avoid hydration mismatch
const INITIAL_METRICS: Metrics = {
  ping: { value: 2, history: [2, 2.1, 1.9, 2.2, 2], trend: "stable" },
  latency: { value: 18, history: [18, 19, 17, 20, 18], trend: "stable" },
  download: { value: 12.4, history: [12, 12.5, 11.8, 13, 12.4], trend: "stable" },
  upload: { value: 9.8, history: [9.5, 10, 9.2, 10.5, 9.8], trend: "stable" },
}

function useSimulatedMetricsWithHistory(interval = 1400) {
  const [metrics, setMetrics] = useState<Metrics>(INITIAL_METRICS)

  useEffect(() => {
    const id = setInterval(() => {
      setMetrics((prev) => {
        const newPing = clamp(prev.ping.value + randBetween(-0.6, 0.6, 1), 1, 5)
        const newLatency = clamp(prev.latency.value + randBetween(-3, 3, 0), 12, 45)
        const newDownload = clamp(prev.download.value + randBetween(-1.8, 1.8, 1), 1, 25)
        const newUpload = clamp(prev.upload.value + randBetween(-1.4, 1.4, 1), 1, 25)

        const pingHistory = [...prev.ping.history, newPing].slice(-HISTORY_LENGTH)
        const latencyHistory = [...prev.latency.history, newLatency].slice(-HISTORY_LENGTH)
        const downloadHistory = [...prev.download.history, newDownload].slice(-HISTORY_LENGTH)
        const uploadHistory = [...prev.upload.history, newUpload].slice(-HISTORY_LENGTH)

        return {
          ping: { value: newPing, history: pingHistory, trend: calculateTrend(pingHistory) },
          latency: { value: newLatency, history: latencyHistory, trend: calculateTrend(latencyHistory) },
          download: { value: newDownload, history: downloadHistory, trend: calculateTrend(downloadHistory) },
          upload: { value: newUpload, history: uploadHistory, trend: calculateTrend(uploadHistory) },
        }
      })
    }, interval)
    return () => clearInterval(id)
  }, [interval])

  return metrics
}

type LogLevel = "info" | "ok" | "warn"
type LogLine = { id: number; level: LogLevel; tag: string; text: string }

const LOG_POOL: Array<Omit<LogLine, "id">> = [
  // Health & Monitoring
  { level: "ok", tag: "hc", text: "Health check OK · /api/status 200ms" },
  { level: "ok", tag: "hc", text: "Container health: memory 62% · cpu 18%" },
  { level: "ok", tag: "sla", text: "SLA monitor heartbeat · 99.997% window" },
  { level: "ok", tag: "sla", text: "Service availability: 99.996% (30d avg)" },
  
  // Network & Routing
  { level: "info", tag: "net", text: "Routing traffic through BGP anycast edge" },
  { level: "info", tag: "net", text: "Network active · IPv4+IPv6 attached" },
  { level: "ok", tag: "net", text: "Border Gateway Protocol update received" },
  { level: "info", tag: "edge", text: "Rerouted through ams-edge (latency: 2.1ms)" },
  { level: "info", tag: "edge", text: "Cache warm · 812 objects preloaded" },
  { level: "ok", tag: "edge", text: "Edge node sync complete · 3 replicas" },
  { level: "info", tag: "peer", text: "Private mesh link up · lat=0.8ms" },
  { level: "ok", tag: "peer", text: "Peering established with dc-sg-02" },
  
  // Provisioning & Deployment
  { level: "info", tag: "prov", text: "Provisioning vps-4872 · region=bom · 4 vCPU" },
  { level: "info", tag: "prov", text: "Instance boot sequence initiated" },
  { level: "ok", tag: "prov", text: "Kernel loaded · boot completed in 8.2s" },
  { level: "info", tag: "deploy", text: "Container image pulled · sha256:a8f2c7..." },
  { level: "ok", tag: "deploy", text: "Service deployed · 5 replicas ready" },
  
  // Storage & Snapshots
  { level: "info", tag: "snap", text: "Snapshot committed · size=38.1 GB" },
  { level: "ok", tag: "snap", text: "Backup snapshot verified · hash match" },
  { level: "info", tag: "backup", text: "Encrypted backup rolled · retention=14d" },
  { level: "ok", tag: "backup", text: "Backup replication: 3/3 zones complete" },
  { level: "info", tag: "storage", text: "Storage sync completed · 2.4 GB in 12s" },
  { level: "ok", tag: "storage", text: "RAID-6 rebuild progress: 87.3%" },
  
  // Scaling & Auto-scaling
  { level: "warn", tag: "scale", text: "Autoscaler queued: +1 node on pool-web" },
  { level: "info", tag: "scale", text: "Scaling policy triggered · load avg 2.8" },
  { level: "ok", tag: "scale", text: "New instance spinup complete · ready" },
  { level: "info", tag: "scale", text: "Draining connections from old-node-42" },
  
  // DDoS & Security
  { level: "ok", tag: "ddos", text: "DDoS shield calibrated · 0 anomalies" },
  { level: "info", tag: "ddos", text: "DDoS alert: 2.1 Gbps inbound (mitigated)" },
  { level: "ok", tag: "sec", text: "SSL certificate renewed · expires 2026-08-14" },
  { level: "ok", tag: "sec", text: "Security scan: 0 vulnerabilities detected" },
  
  // Latency & Performance
  { level: "info", tag: "lat", text: "Edge peer latency sampled · 1.2ms avg" },
  { level: "ok", tag: "lat", text: "P99 latency: 18ms (baseline 15ms)" },
  { level: "info", tag: "perf", text: "Request rate: 12,400 req/s · healthy" },
  { level: "ok", tag: "perf", text: "Cache hit rate: 94.2% (excellent)" },
  
  // Database & Data
  { level: "info", tag: "db", text: "Database query: 245ms (slow log threshold)" },
  { level: "ok", tag: "db", text: "Database replication lag: 0.3ms" },
  { level: "info", tag: "cache", text: "Redis memory: 4.2 GB / 8.0 GB" },
  { level: "ok", tag: "cache", text: "Cache eviction policy: LRU working nominal" },
  
  // Configuration & Deployment
  { level: "info", tag: "config", text: "Configuration reload triggered" },
  { level: "ok", tag: "config", text: "Config validation passed · 0 errors" },
  { level: "info", tag: "cert", text: "Let's Encrypt renewal scheduled" },
  
  // Monitoring & Alerts
  { level: "ok", tag: "mon", text: "Monitoring agent online · telemetry normal" },
  { level: "info", tag: "alert", text: "Alert rule updated: cpu > 80%" },
  { level: "ok", tag: "audit", text: "Audit log rotation completed · 8 archives" },
]

// Static initial logs to avoid hydration mismatch
const INITIAL_LOGS: LogLine[] = LOG_POOL.slice(0, 6).map((l, i) => ({ ...l, id: i }))

function useSimulatedLogs(max = 6, tickMs = 1800) {
  const [logs, setLogs] = useState<LogLine[]>(INITIAL_LOGS)
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

// ---------- Mini Sparkline Chart ----------
function Sparkline({ 
  data, 
  color = "var(--accent)",
  height = 32 
}: { 
  data: number[]
  color?: string
  height?: number 
}) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  
  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * 100
    const y = 100 - ((value - min) / range) * 100
    return `${x},${y}`
  }).join(" ")

  return (
    <svg 
      viewBox="0 0 100 100" 
      preserveAspectRatio="none"
      className="w-full overflow-visible"
      style={{ height }}
    >
      <defs>
        <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <polygon
        points={`0,100 ${points} 100,100`}
        fill="url(#sparkline-gradient)"
      />
      {/* Line */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Current value dot */}
      <circle
        cx="100"
        cy={100 - ((data[data.length - 1] - min) / range) * 100}
        r="3"
        fill={color}
        className="animate-pulse"
      />
    </svg>
  )
}

// ---------- Trend Indicator ----------
function TrendIndicator({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") {
    return (
      <span className="flex items-center gap-0.5 text-emerald-400 text-[10px]">
        <TrendingUp className="h-3 w-3" />
      </span>
    )
  }
  if (trend === "down") {
    return (
      <span className="flex items-center gap-0.5 text-amber-400 text-[10px]">
        <TrendingDown className="h-3 w-3" />
      </span>
    )
  }
  return (
    <span className="flex items-center gap-0.5 text-muted-foreground text-[10px]">
      <Minus className="h-3 w-3" />
    </span>
  )
}

// ---------- Interactive Metric Tile ----------
function InteractiveMetricTile({
  icon,
  label,
  metricType,
  data,
  unit,
  max,
  isExpanded,
  onToggle,
}: {
  icon: React.ReactNode
  label: string
  metricType: MetricType
  data: MetricData
  unit: string
  max: number
  isExpanded: boolean
  onToggle: () => void
}) {
  const handleClick = useCallback(() => {
    trackMetricClick(metricType, !isExpanded)
    onToggle()
  }, [metricType, isExpanded, onToggle])

  const barValue = data.value / max

  return (
    <button
      onClick={handleClick}
      className={cn(
        "glass glass-hover rounded-xl p-4 text-left transition-all duration-300 w-full",
        "hover:scale-[1.02] active:scale-[0.98]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        isExpanded && "ring-1 ring-accent/30"
      )}
      aria-expanded={isExpanded}
      aria-label={`${label}: ${data.value} ${unit}. Click to ${isExpanded ? "collapse" : "expand"} details.`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span className="text-accent">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <TrendIndicator trend={data.trend} />
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </div>
      
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular-nums text-foreground transition-all">
          {metricType === "latency" ? Math.round(data.value) : data.value.toFixed(1)}
        </span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>

      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-foreground/5">
        <div
          className="h-full rounded-full bg-accent/80 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(4, Math.min(100, barValue * 100))}%` }}
        />
      </div>

      {/* Expandable content with chart */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          isExpanded ? "grid-rows-[1fr] opacity-100 mt-5" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-foreground/5 pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Last {data.history.length} readings
              </span>
              <span className="text-[10px] text-muted-foreground">
                avg: {(data.history.reduce((a, b) => a + b, 0) / data.history.length).toFixed(1)} {unit}
              </span>
            </div>
            <Sparkline data={data.history} height={48} />
            <div className="flex justify-between mt-3 text-[10px] text-muted-foreground">
              <span>min: {Math.min(...data.history).toFixed(1)}</span>
              <span>max: {Math.max(...data.history).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}

// ---------- Main Component ----------
export function LiveStatusCard({ brandLabel = "cloud" }: { brandLabel?: string }) {
  const uptime = useUptime()
  const metrics = useSimulatedMetricsWithHistory()
  const logs = useSimulatedLogs()
  const [expandedMetric, setExpandedMetric] = useState<MetricType | null>(null)

  const toggleMetric = useCallback((metric: MetricType) => {
    setExpandedMetric((prev) => (prev === metric ? null : metric))
  }, [])

  return (
    <div className="relative">
      {/* Ambient cyan glow behind the panel */}
      <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--accent)_25%,transparent),transparent_70%)] blur-3xl" />

      <div className="glass glass-strong accent-glow relative overflow-hidden rounded-2xl">
        {/* Header: window chrome + region + live uptime */}
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-muted/70" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-muted/70" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-muted/70" aria-hidden />
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {brandLabel} · bom-edge-01
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="relative inline-flex items-center gap-2 text-accent">
              <span className="relative inline-flex h-2 w-2">
                <span className="status-pulse absolute inset-0 rounded-full bg-accent" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              LIVE
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              uptime{" "}
              <span className="text-foreground font-medium" suppressHydrationWarning>
                {uptime.days}d {pad(uptime.hours)}:{pad(uptime.minutes)}:{pad(uptime.seconds)}
              </span>
            </span>
          </div>
        </div>

        {/* Interactive Metric tiles - Unified grid with aligned expansion */}
        <div className="px-4 pb-2">
          <div 
            className={cn(
              "grid gap-3 transition-all duration-300",
              expandedMetric 
                ? "grid-cols-1 lg:grid-cols-2" 
                : "grid-cols-2 lg:grid-cols-4"
            )}
          >
            <InteractiveMetricTile
              icon={<Gauge className="h-4 w-4" />}
              label="Ping"
              metricType="ping"
              data={metrics.ping}
              unit="ms"
              max={5}
              isExpanded={expandedMetric === "ping"}
              onToggle={() => toggleMetric("ping")}
            />
            <InteractiveMetricTile
              icon={<Signal className="h-4 w-4" />}
              label="Latency"
              metricType="latency"
              data={metrics.latency}
              unit="ms"
              max={50}
              isExpanded={expandedMetric === "latency"}
              onToggle={() => toggleMetric("latency")}
            />
            <InteractiveMetricTile
              icon={<ArrowDownToLine className="h-4 w-4" />}
              label="Download"
              metricType="download"
              data={metrics.download}
              unit="Gbps"
              max={25}
              isExpanded={expandedMetric === "download"}
              onToggle={() => toggleMetric("download")}
            />
            <InteractiveMetricTile
              icon={<ArrowUpToLine className="h-4 w-4" />}
              label="Upload"
              metricType="upload"
              data={metrics.upload}
              unit="Gbps"
              max={25}
              isExpanded={expandedMetric === "upload"}
              onToggle={() => toggleMetric("upload")}
            />
          </div>
        </div>

        {/* Log panel */}
        <div className="mx-4 mb-4 mt-2 rounded-xl bg-background/60 p-5 font-mono text-[13px] leading-relaxed">
          <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-accent" />
              Live system log
            </span>
            <span>stream · tail -f</span>
          </div>
          <ul aria-live="polite" className="flex flex-col gap-1.5">
            {logs.map((l) => (
              <li key={l.id} className="row-in flex items-baseline gap-2.5">
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
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  [{l.tag}]
                </span>
                <span className="text-foreground/90">{l.text}</span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-1 text-muted-foreground">
              <span>$</span>
              <span className="caret-blink inline-block h-3.5 w-2 bg-foreground/70" />
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
