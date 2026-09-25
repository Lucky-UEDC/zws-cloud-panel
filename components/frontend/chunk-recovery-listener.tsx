"use client"

import { useEffect } from "react"

function isChunkFailure(value: unknown) {
  const text = value instanceof Error ? `${value.name} ${value.message}` : String(value || "")
  return /chunkloaderror|loading chunk|failed to fetch dynamically imported module|module script|\/_next\/static\/chunks\//i.test(text)
}

function recoveryKey() {
  const buildId = document.querySelector<HTMLScriptElement>("script[src*='/_next/static/']")?.src.match(/\/_next\/static\/([^/]+)\//)?.[1] || "unknown"
  return `chunk-recovery:${buildId}:${window.location.pathname}`
}

function reloadOnce() {
  const key = recoveryKey()
  if (sessionStorage.getItem(key) === "1") return
  sessionStorage.setItem(key, "1")
  window.location.reload()
}

export function ChunkRecoveryListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const target = event.target as HTMLElement | null
      const src = target && "getAttribute" in target ? target.getAttribute("src") || target.getAttribute("href") || "" : ""
      if (isChunkFailure(event.error) || isChunkFailure(event.message) || isChunkFailure(src)) reloadOnce()
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkFailure(event.reason)) reloadOnce()
    }
    window.addEventListener("error", onError, true)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError, true)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  return null
}
