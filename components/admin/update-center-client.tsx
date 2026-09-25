"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react"

export type ClientRelease = {
  tagName: string
  version: string
  publishedAt: string | null
  invalidReason: string | null
  changelog: string
  migrations: string[]
}

type ApplyState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "done"; ok: boolean; message: string }
  | { phase: "pending"; message: string }

export function UpdateCenterClient({
  releases,
  lockHeld,
  configured,
}: {
  releases: ClientRelease[]
  lockHeld: boolean
  configured: boolean
}) {
  const [state, setState] = useState<ApplyState>({ phase: "idle" })
  const [busyVersion, setBusyVersion] = useState<string | null>(null)

  async function apply(version: string) {
    setState({ phase: "applying" })
    setBusyVersion(version)
    try {
      const response = await fetch("/api/admin/system/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      })
      const data = await response.json().catch(() => ({}))
      if (data.status === "apply_pending") {
        setState({ phase: "pending", message: data.reason || "Preflight passed. Host apply is pending." })
      } else if (response.ok && data.success) {
        setState({ phase: "done", ok: true, message: `v${version} applied successfully.` })
      } else if (data.status === "lock_busy") {
        setState({ phase: "done", ok: false, message: "Another update is already in progress." })
      } else if (data.status === "preflight_failed") {
        setState({ phase: "done", ok: false, message: data.reason || "Preflight checks failed." })
      } else {
        setState({ phase: "done", ok: false, message: data.reason || "Update could not be applied." })
      }
    } catch {
      setState({ phase: "done", ok: false, message: "Update request failed (network error)." })
    } finally {
      setBusyVersion(null)
    }
  }

  if (!configured) {
    return (
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
        <div>
          Updates are disabled. Set <code className="text-xs">UPDATE_GITHUB_REPO</code> in the environment to connect a trusted release source.
        </div>
      </div>
    )
  }

  const validReleases = releases.filter((r) => !r.invalidReason)

  return (
    <div className="space-y-4">
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No releases found in the configured repository.</p>
      ) : null}

      {validReleases.map((release) => (
        <div key={release.tagName} className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">v{release.version}</Badge>
                {release.publishedAt ? (
                  <span className="text-xs text-muted-foreground">{new Date(release.publishedAt).toLocaleDateString()}</span>
                ) : null}
              </div>
              {release.changelog ? <p className="mt-2 text-sm text-muted-foreground">{release.changelog.slice(0, 200)}</p> : null}
              {release.migrations.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {release.migrations.length} migration{release.migrations.length === 1 ? "" : "s"} included
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              disabled={state.phase === "applying" || lockHeld || busyVersion !== null}
              onClick={() => apply(release.version)}
            >
              {busyVersion === release.version ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Apply v{release.version}
            </Button>
          </div>
        </div>
      ))}

      {releases
        .filter((r) => r.invalidReason)
        .map((release) => (
          <div key={release.tagName} className="flex items-start gap-2 rounded-lg border border-dashed p-4 opacity-70">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
            <div className="text-sm">
              <div className="font-medium">v{release.version} — excluded</div>
              <p className="text-xs text-muted-foreground">{release.invalidReason}</p>
            </div>
          </div>
        ))}

      {state.phase === "applying" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Running preflight and applying…
        </p>
      ) : null}

      {state.phase === "done" ? (
        <p className={`flex items-center gap-2 text-sm ${state.ok ? "text-emerald-300" : "text-destructive"}`}>
          {state.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {state.message}
        </p>
      ) : null}

      {state.phase === "pending" ? (
        <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3 text-sm text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> Host apply pending
          </div>
          <p className="mt-1 text-xs text-amber-200/80">{state.message}</p>
        </div>
      ) : null}
    </div>
  )
}