"use client"

import { useState } from "react"
import { Trash2, Archive, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const targetOptions = [
  ["messageLogs", "Clean Message Logs"],
  ["webhookLogs", "Clean Webhook Logs"],
  ["notificationLogs", "Clean Notification Logs"],
  ["diagnostics", "Clean Diagnostics"],
  ["retryLogs", "Clean Failed Retries"],
  ["expiredSessions", "Clean Expired Sessions"],
]

export default function MaintenancePage() {
  const [windowKey, setWindowKey] = useState("30d")
  const [mode, setMode] = useState<"archive" | "delete">("archive")
  const [targets, setTargets] = useState<string[]>(targetOptions.map(([key]) => key))
  const [result, setResult] = useState<any>(null)
  const [running, setRunning] = useState(false)

  function toggleTarget(key: string) {
    setTargets((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  async function run(dryRun: boolean) {
    setRunning(true)
    const response = await fetch("/api/admin/maintenance/log-cleanup", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ window: windowKey, mode, targets, dryRun }),
    })
    setResult(await response.json().catch(() => ({})))
    setRunning(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Maintenance</h1>
        <p className="mt-1 text-sm text-muted-foreground">Archive or permanently delete old operational logs without touching orders, customers, VMs, invoices, or payments.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <label className="text-sm font-medium">Retention</label>
            <Select value={windowKey} onValueChange={setWindowKey}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 days</SelectItem>
                <SelectItem value="30d">30 days</SelectItem>
                <SelectItem value="90d">90 days</SelectItem>
                <SelectItem value="1y">1 year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Action</label>
            <Select value={mode} onValueChange={(value) => setMode(value === "delete" ? "delete" : "archive")}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="archive">Archive Old Logs</SelectItem>
                <SelectItem value="delete">Delete Permanently</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run(true)} disabled={running || !targets.length}>
              <PlayCircle className="mr-2 h-4 w-4" />
              Dry Run
            </Button>
            <Button variant={mode === "delete" ? "destructive" : "default"} onClick={() => run(false)} disabled={running || !targets.length}>
              {mode === "delete" ? <Trash2 className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
              Apply
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {targetOptions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleTarget(key)}
                className={`rounded-lg border p-4 text-left text-sm ${targets.includes(key) ? "border-primary bg-primary/10" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <pre className="max-h-[460px] overflow-auto rounded-lg border bg-muted p-4 text-xs">{JSON.stringify(result || { status: "not_run" }, null, 2)}</pre>
        </div>
      </div>
    </div>
  )
}
