"use client"

import { useEffect, useState } from "react"

type HealthState = "checking" | "operational" | "degraded" | "unavailable"

const labels: Record<HealthState, string> = {
  checking: "Checking live status",
  operational: "All monitored systems operational",
  degraded: "Some monitored systems are degraded",
  unavailable: "Status monitoring is unavailable",
}

const descriptions: Record<HealthState, string> = {
  checking: "Requesting the latest platform health check.",
  operational: "The platform health endpoint is reporting normally.",
  degraded: "The platform health endpoint detected one or more failing checks.",
  unavailable: "The latest platform health check could not be completed.",
}

export function LivePlatformStatus() {
  const [state, setState] = useState<HealthState>("checking")
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" })
        const body = await response.json().catch(() => null)
        if (cancelled) return
        setState(response.ok && body?.status === "ok" ? "operational" : "degraded")
      } catch {
        if (!cancelled) setState("unavailable")
      } finally {
        if (!cancelled) setCheckedAt(new Date())
      }
    }

    void refresh()
    const interval = window.setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const healthy = state === "operational"
  const checking = state === "checking"
  const indicatorClass = healthy ? "bg-accent" : checking ? "bg-muted-foreground" : "bg-destructive"
  const statusClass = healthy ? "text-accent" : checking ? "text-muted-foreground" : "text-destructive"

  return (
    <div className="flex flex-col gap-10" aria-live="polite">
      <div className="glass accent-glow relative flex flex-col gap-3 overflow-hidden rounded-2xl p-6">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${indicatorClass}`} aria-hidden="true" />
          <h2 className="text-lg font-semibold">{labels[state]}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{descriptions[state]}</p>
        <p className="text-xs text-muted-foreground">
          {checkedAt ? `Last checked ${checkedAt.toLocaleTimeString()}` : "Waiting for the first health response"}
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Component status</h2>
        <ul className="glass mt-8 flex flex-col gap-1 rounded-2xl p-2">
          <li className="flex items-center justify-between rounded-xl px-4 py-3 text-sm">
            <span className="font-medium">Platform health</span>
            <span className={`inline-flex items-center gap-2 ${statusClass}`}>
              <span className={`inline-flex h-1.5 w-1.5 rounded-full ${indicatorClass}`} aria-hidden="true" />
              {state === "operational" ? "Operational" : state === "checking" ? "Checking" : state === "degraded" ? "Degraded" : "Unavailable"}
            </span>
          </li>
        </ul>
      </div>

      <div>
        <h2 className="text-xl font-semibold">Recent incidents</h2>
        <div className="glass mt-8 rounded-2xl p-5 text-sm text-muted-foreground">
          No public incident feed is configured. Live platform health is shown above.
        </div>
      </div>
    </div>
  )
}
