"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, CircleOff } from "lucide-react"
import { formatByteRateDecimal, formatPercent, formatRateDecimal } from "@/lib/format-units"

export type VpsMetricPoint = {
  recordedAt: string
  cpuPercent: number
  ramPercent: number
  diskPercent: number
  diskReadBytes: number
  diskWriteBytes: number
  networkInBytes: number
  networkOutBytes: number
  diskReadBytesRate?: number
  diskWriteBytesRate?: number
  networkInBytesRate?: number
  networkOutBytesRate?: number
}

function chartTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
}

function MetricChart({ title, data, keys, paused, formatter = "percent" }: { title: string; data: VpsMetricPoint[]; keys: Array<{ key: keyof VpsMetricPoint; color: string; name: string }>; paused?: boolean; formatter?: "percent" | "byteRate" | "bitRate" }) {
  const formatValue = (value: number) => formatter === "bitRate" ? formatRateDecimal(value) : formatter === "byteRate" ? formatByteRateDecimal(value) : formatPercent(value)
  return (
    <div className="rounded-md border border-border/40 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{paused ? "Paused" : "Live"}</div>
      </div>
      <div className="h-56">
        {paused || !data.length ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/40 text-sm text-muted-foreground">{paused ? "Server offline" : "Waiting for data"}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="recordedAt" tickFormatter={chartTime} tick={{ fontSize: 11, fill: "currentColor" }} />
              <YAxis tick={{ fontSize: 11, fill: "currentColor" }} tickFormatter={(value) => formatter === "percent" ? `${Number(value).toFixed(0)}%` : formatValue(Number(value))} width={78} />
              <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} labelFormatter={(value) => chartTime(String(value))} formatter={(value: any, name: any) => [formatValue(Number(value)), name]} />
              {keys.map((item) => <Area key={item.key as string} type="monotone" dataKey={item.key as string} name={item.name} stroke={item.color} fill={`${item.color}22`} strokeWidth={2} isAnimationActive={false} />)}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export function VpsLiveUsageCharts({
  metrics,
  range,
  onRangeChange,
  isRunning,
}: {
  metrics: VpsMetricPoint[]
  range: "1h" | "24h"
  onRangeChange: (range: "1h" | "24h") => void
  isRunning: boolean
  isProvisioning: boolean
}) {
  if (!isRunning) {
    return (
      <Card className="border-border/40 bg-background/80">
        <CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
            <CircleOff className="h-5 w-5" />
          </span>
          <p className="font-medium">Server currently offline</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/40 bg-background/80">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Live usage</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Monitoring active</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={range === "1h" ? "default" : "outline"} onClick={() => onRangeChange("1h")}>1h</Button>
          <Button size="sm" variant={range === "24h" ? "default" : "outline"} onClick={() => onRangeChange("24h")}>24h</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <MetricChart title="CPU" data={metrics} keys={[{ key: "cpuPercent", color: "#22c55e", name: "CPU %" }]} paused={!isRunning} />
        <MetricChart title="RAM" data={metrics} keys={[{ key: "ramPercent", color: "#38bdf8", name: "RAM %" }]} paused={!isRunning} />
        <MetricChart title="Disk Usage" data={metrics} keys={[{ key: "diskPercent", color: "#f97316", name: "Disk %" }]} paused={!isRunning} />
        <MetricChart title="Disk IO" data={metrics} keys={[{ key: "diskReadBytesRate", color: "#a78bfa", name: "Read" }, { key: "diskWriteBytesRate", color: "#f59e0b", name: "Write" }]} paused={!isRunning} formatter="byteRate" />
        <MetricChart title="Network" data={metrics} keys={[{ key: "networkOutBytesRate", color: "#14b8a6", name: "Upload" }, { key: "networkInBytesRate", color: "#60a5fa", name: "Download" }]} paused={!isRunning} formatter="bitRate" />
      </CardContent>
    </Card>
  )
}
