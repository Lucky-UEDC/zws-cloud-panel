"use client"

import { useEffect } from "react"

type FrontendDiagnostics = {
  hydrationErrors: string[]
  chunkErrors: string[]
  resourceErrors: string[]
  cssReloadAttempted: boolean
  lastUpdatedAt: string
}

declare global {
  interface Window {
    __ZWS_FRONTEND_DIAGNOSTICS__?: FrontendDiagnostics
  }
}

function getDiagnostics() {
  if (!window.__ZWS_FRONTEND_DIAGNOSTICS__) {
    window.__ZWS_FRONTEND_DIAGNOSTICS__ = {
      hydrationErrors: [],
      chunkErrors: [],
      resourceErrors: [],
      cssReloadAttempted: false,
      lastUpdatedAt: new Date().toISOString(),
    }
  }
  return window.__ZWS_FRONTEND_DIAGNOSTICS__
}

function pushUnique(list: string[], value: string) {
  if (!value || list.includes(value)) return
  list.push(value)
  if (list.length > 25) list.shift()
}

function hasLoadedStylesheet() {
  return Array.from(document.styleSheets).some((sheet) => {
    const href = sheet.href || ""
    return href.includes("/_next/static/") && href.endsWith(".css")
  })
}

function showCssFailureScreen() {
  if (document.getElementById("zws-css-failure-screen")) return
  const screen = document.createElement("div")
  screen.id = "zws-css-failure-screen"
  screen.setAttribute("role", "alert")
  screen.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:24px",
    "background:#0a0b0d",
    "color:#f5f5f4",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  ].join(";")
  screen.innerHTML = `<div style="max-width:520px"><h1 style="margin:0 0 12px;font-size:22px">Frontend assets failed to load</h1><p style="margin:0;color:#a3a3a3;line-height:1.5">The latest stylesheet did not load. Retrying with a fresh asset request.</p></div>`
  document.body.appendChild(screen)
}

export function FrontendDiagnosticsCollector() {
  useEffect(() => {
    const diagnostics = getDiagnostics()

    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      const message = args.map((arg) => (typeof arg === "string" ? arg : "")).join(" ")
      if (/hydration|did not match|server rendered HTML|text content/i.test(message)) {
        pushUnique(diagnostics.hydrationErrors, message.slice(0, 500))
        diagnostics.lastUpdatedAt = new Date().toISOString()
      }
      originalConsoleError(...args)
    }

    function onError(event: ErrorEvent) {
      const target = event.target as HTMLElement | null
      const url = target instanceof HTMLScriptElement || target instanceof HTMLImageElement
        ? target.src
        : target instanceof HTMLLinkElement
          ? target.href
          : ""
      if (url.includes("/_next/static/")) {
        if (url.endsWith(".js")) pushUnique(diagnostics.chunkErrors, url)
        else pushUnique(diagnostics.resourceErrors, url)
        diagnostics.lastUpdatedAt = new Date().toISOString()
      }
      const message = String(event.message || "")
      if (/hydration|ChunkLoadError|Loading chunk/i.test(message)) {
        pushUnique(message.includes("hydration") ? diagnostics.hydrationErrors : diagnostics.chunkErrors, message.slice(0, 500))
        diagnostics.lastUpdatedAt = new Date().toISOString()
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      const message = String(event.reason?.message || event.reason || "")
      if (/ChunkLoadError|Loading chunk|hydration/i.test(message)) {
        pushUnique(message.includes("hydration") ? diagnostics.hydrationErrors : diagnostics.chunkErrors, message.slice(0, 500))
        diagnostics.lastUpdatedAt = new Date().toISOString()
      }
    }

    function verifyCss() {
      if (!location.pathname.startsWith("/admin")) return
      if (hasLoadedStylesheet()) return
      const key = "frontend-css-retry"
      if (sessionStorage.getItem(key)) {
        showCssFailureScreen()
        return
      }
      diagnostics.cssReloadAttempted = true
      diagnostics.lastUpdatedAt = new Date().toISOString()
      sessionStorage.setItem(key, "1")
      const url = new URL(location.href)
      url.searchParams.set("_asset_refresh", String(Date.now()))
      location.replace(url.toString())
    }

    window.addEventListener("error", onError, true)
    window.addEventListener("unhandledrejection", onUnhandledRejection)
    window.addEventListener("load", () => window.setTimeout(verifyCss, 500), { once: true })
    window.setTimeout(verifyCss, 3000)

    return () => {
      console.error = originalConsoleError
      window.removeEventListener("error", onError, true)
      window.removeEventListener("unhandledrejection", onUnhandledRejection)
    }
  }, [])

  return null
}
