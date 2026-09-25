"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { readJsonResponse } from "@/lib/client/safe-json"

type FrontendHealth = {
  success?: boolean
  checkedAt?: string
  manifests?: {
    ready?: boolean
    routeStatus?: Array<{ route: string; inManifest: boolean; serverFileExists: boolean }>
  }
  assets?: {
    cssChunkCount?: number
    jsChunkCount?: number
    ready?: boolean
  }
}

declare global {
  interface Window {
    __ZWS_FRONTEND_DIAGNOSTICS__?: {
      hydrationErrors: string[]
      chunkErrors: string[]
      resourceErrors: string[]
      cssReloadAttempted: boolean
      lastUpdatedAt: string
    }
  }
}

function StatusBadge({ ok, good = "OK", bad = "Problem" }: { ok: boolean; good?: string; bad?: string }) {
  return <Badge variant={ok ? "default" : "destructive"}>{ok ? good : bad}</Badge>
}

export function FrontendHealthPanel() {
  const [health, setHealth] = useState<FrontendHealth>({})
  const [loadedCssCount, setLoadedCssCount] = useState(0)
  const [loadedJsCount, setLoadedJsCount] = useState(0)
  const [diagnostics, setDiagnostics] = useState<Window["__ZWS_FRONTEND_DIAGNOSTICS__"]>()
  const [counts, setCounts] = useState({ adminShells: 0, panelShells: 0, desktopSidebars: 0, mobileSidebars: 0 })

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/admin/system/frontend-health", { cache: "no-store" })
      const body = await readJsonResponse<FrontendHealth>(response).catch(() => null) || { success: false }
      setHealth(body)
    }
    void load()
  }, [])

  useEffect(() => {
    function collectRuntime() {
      setLoadedCssCount(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').length)
      setLoadedJsCount(document.querySelectorAll<HTMLScriptElement>("script[src]").length)
      setDiagnostics(window.__ZWS_FRONTEND_DIAGNOSTICS__)
      setCounts({
        adminShells: document.querySelectorAll("[data-admin-shell]").length,
        panelShells: document.querySelectorAll("[data-panel-shell]").length,
        desktopSidebars: document.querySelectorAll('[data-admin-sidebar="desktop"]').length,
        mobileSidebars: document.querySelectorAll('[data-admin-sidebar="mobile"]').length,
      })
    }
    collectRuntime()
    const timer = window.setInterval(collectRuntime, 10000)
    return () => window.clearInterval(timer)
  }, [])

  const manifestOk = Boolean(health.manifests?.ready)
  const routesOk = (health.manifests?.routeStatus || []).every((route) => route.inManifest && route.serverFileExists)
  const assetsOk = Boolean(health.assets?.ready && loadedCssCount && loadedJsCount)
  const layoutOk = counts.adminShells === 1 && counts.panelShells === 1 && counts.desktopSidebars === 1 && counts.mobileSidebars === 1
  const hydrationOk = !diagnostics?.hydrationErrors?.length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Frontend Health</h1>
        <p className="mt-1 text-sm text-muted-foreground">Application assets, rendering, and admin layout diagnostics.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card><CardHeader><CardTitle>Application</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><StatusBadge ok={manifestOk && routesOk} /><div>Required pages: {routesOk ? "available" : "attention needed"}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Assets</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><StatusBadge ok={assetsOk} /><div>Stylesheets: {loadedCssCount}</div><div>Scripts: {loadedJsCount}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Rendering</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><StatusBadge ok={hydrationOk} /><div>Rendering errors: {diagnostics?.hydrationErrors.length || 0}</div><div>Asset errors: {(diagnostics?.chunkErrors.length || 0) + (diagnostics?.resourceErrors.length || 0)}</div><div>Refresh attempted: {diagnostics?.cssReloadAttempted ? "yes" : "no"}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Layout</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><StatusBadge ok={layoutOk} /><div>Admin shells: {counts.adminShells}</div><div>Panel shells: {counts.panelShells}</div><div>Desktop sidebars: {counts.desktopSidebars}</div><div>Mobile sidebars: {counts.mobileSidebars}</div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Admin Routes</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(health.manifests?.routeStatus || []).map((route) => (
              <div key={route.route} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs">{route.route}</span>
                <StatusBadge ok={route.inManifest && route.serverFileExists} />
              </div>
            ))}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}
