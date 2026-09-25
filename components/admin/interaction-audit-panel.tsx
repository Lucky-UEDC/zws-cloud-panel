"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { RefreshCw, Search, MousePointerClick, Layers, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type ElementRecord = {
  tag: string
  label: string
  className: string
  pointerEvents: string
  position: string
  zIndex: string
  rect: string
}

type AuditState = {
  overlays: ElementRecord[]
  pointerNone: ElementRecord[]
  buttons: Array<ElementRecord & { coveredBy: string }>
  scrollLocks: string[]
  warnings: string[]
}

function elementLabel(element: Element) {
  const text = element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80)
  return element.getAttribute("aria-label") || element.getAttribute("title") || text || element.id || ""
}

function record(element: Element): ElementRecord {
  const style = window.getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  return {
    tag: element.tagName.toLowerCase(),
    label: elementLabel(element),
    className: typeof element.className === "string" ? element.className.slice(0, 180) : "",
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
  }
}

function isFullscreen(rect: DOMRect) {
  return rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.85
}

function describeElement(element: Element | null) {
  if (!element) return "none"
  const id = element.id ? `#${element.id}` : ""
  const classes = typeof element.className === "string" && element.className ? `.${element.className.split(/\s+/).slice(0, 3).join(".")}` : ""
  return `${element.tagName.toLowerCase()}${id}${classes}`
}

export function InteractionAuditPanel() {
  const [audit, setAudit] = useState<AuditState | null>(null)
  const [clickLogging, setClickLogging] = useState(false)
  const [lastClick, setLastClick] = useState("No clicks recorded")

  const runAudit = useCallback(() => {
    const all = Array.from(document.body.querySelectorAll("*"))
    const overlays: ElementRecord[] = []
    const pointerNone: ElementRecord[] = []
    const buttons: AuditState["buttons"] = []
    const warnings: string[] = []

    for (const element of all) {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      const className = typeof element.className === "string" ? element.className : ""
      const z = Number.parseInt(style.zIndex || "0", 10)
      const highStack = Number.isFinite(z) && z >= 50
      const fixedOrAbsolute = style.position === "fixed" || style.position === "absolute"
      const looksOverlay = fixedOrAbsolute && (isFullscreen(rect) || highStack || className.includes("inset-0") || className.includes("backdrop"))

      if (style.pointerEvents === "none") pointerNone.push(record(element))
      if (looksOverlay) overlays.push(record(element))
    }

    const clickables = Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])"))
    for (const element of clickables) {
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue
      const top = document.elementFromPoint(cx, cy)
      const covered = top && top !== element && !element.contains(top)
      buttons.push({ ...record(element), coveredBy: covered ? describeElement(top) : "" })
      if (covered) warnings.push(`${describeElement(element)} is covered by ${describeElement(top)}`)
    }

    const htmlStyle = window.getComputedStyle(document.documentElement)
    const bodyStyle = window.getComputedStyle(document.body)
    const scrollLocks = [
      htmlStyle.overflowY === "hidden" ? "html overflow-y:hidden" : "",
      bodyStyle.overflowY === "hidden" ? "body overflow-y:hidden" : "",
      document.body.style.overflow ? `body inline overflow:${document.body.style.overflow}` : "",
    ].filter(Boolean)

    setAudit({
      overlays: overlays.slice(0, 80),
      pointerNone: pointerNone.slice(0, 80),
      buttons: buttons.slice(0, 120),
      scrollLocks,
      warnings: Array.from(new Set(warnings)).slice(0, 40),
    })
  }, [])

  useEffect(() => {
    runAudit()
  }, [runAudit])

  useEffect(() => {
    if (!clickLogging) return
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? describeElement(event.target) : String(event.target)
      setLastClick(target)
      console.log("CLICK TARGET:", event.target)
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [clickLogging])

  const blockedButtons = useMemo(() => audit?.buttons.filter((button) => button.coveredBy) || [], [audit])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Interaction Audit</h1>
          <p className="text-sm text-muted-foreground">Inspect z-index, overlays, pointer-events, scroll locks, and blocked click targets.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setClickLogging((value) => !value)} className="gap-2">
            <MousePointerClick className="h-4 w-4" />
            {clickLogging ? "Disable click log" : "Enable click log"}
          </Button>
          <Button type="button" onClick={runAudit} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Rescan
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Overlays" value={audit?.overlays.length || 0} icon={<Layers className="h-4 w-4" />} />
        <Metric title="Pointer none" value={audit?.pointerNone.length || 0} icon={<Search className="h-4 w-4" />} />
        <Metric title="Blocked targets" value={blockedButtons.length} icon={<AlertTriangle className="h-4 w-4" />} tone={blockedButtons.length ? "danger" : "default"} />
        <Metric title="Scroll locks" value={audit?.scrollLocks.length || 0} icon={<AlertTriangle className="h-4 w-4" />} tone={audit?.scrollLocks.length ? "danger" : "default"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Click Logger</CardTitle>
          <CardDescription>Dev/admin gated replacement for the temporary global click logger.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          Last click target: <span className="font-mono text-accent">{lastClick}</span>
        </CardContent>
      </Card>

      {audit?.warnings.length ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Blocked Click Regions</CardTitle>
            <CardDescription>Visible interactive elements whose center point is covered by another element.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {audit.warnings.map((warning) => <p key={warning} className="font-mono text-xs text-destructive">{warning}</p>)}
          </CardContent>
        </Card>
      ) : null}

      <ElementTable title="Fullscreen / High Z-Index Layers" rows={audit?.overlays || []} />
      <ElementTable title="Pointer Events None Elements" rows={audit?.pointerNone || []} />
      <ElementTable title="Clickable Target Probe" rows={audit?.buttons || []} showCovered />
    </div>
  )
}

function Metric({ title, value, icon, tone = "default" }: { title: string; value: number; icon: ReactNode; tone?: "default" | "danger" }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
        <Badge variant={tone === "danger" ? "destructive" : "outline"}>{icon}</Badge>
      </CardContent>
    </Card>
  )
}

function ElementTable({ title, rows, showCovered = false }: { title: string; rows: Array<ElementRecord & { coveredBy?: string }>; showCovered?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{rows.length ? `${rows.length} sampled elements` : "No matching elements found."}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Element</th>
              <th className="py-2">Pointer</th>
              <th className="py-2">Position</th>
              <th className="py-2">z</th>
              <th className="py-2">Rect</th>
              {showCovered ? <th className="py-2">Covered by</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.tag}-${row.rect}-${index}`} className="border-t border-border/40 align-top">
                <td className="max-w-[280px] py-2">
                  <div className="font-mono">{row.tag} {row.label}</div>
                  <div className="truncate text-muted-foreground">{row.className}</div>
                </td>
                <td className="py-2 font-mono">{row.pointerEvents}</td>
                <td className="py-2 font-mono">{row.position}</td>
                <td className="py-2 font-mono">{row.zIndex}</td>
                <td className="py-2 font-mono">{row.rect}</td>
                {showCovered ? <td className="py-2 font-mono text-destructive">{row.coveredBy}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
