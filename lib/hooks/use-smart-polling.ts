"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export function useSmartPolling(callback: () => Promise<void> | void, active: boolean, deps: unknown[] = []) {
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const run = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return
    await callbackRef.current()
    setLastUpdatedAt(new Date())
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!active) {
      const onFocus = () => void run()
      const onVisibility = () => {
        if (!document.hidden) void run()
      }
      window.addEventListener("focus", onFocus)
      document.addEventListener("visibilitychange", onVisibility)
      return () => {
        cancelled = true
        window.removeEventListener("focus", onFocus)
        document.removeEventListener("visibilitychange", onVisibility)
      }
    }
    const interval = 30_000

    const tick = async () => {
      if (cancelled) return
      await run()
      if (!cancelled) timer = setTimeout(tick, interval)
    }

    void tick()

    const onFocus = () => void run()
    const onVisibility = () => {
      if (!document.hidden) void run()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, run, ...deps])

  return { lastUpdatedAt, refresh: run }
}

export function formatLastUpdated(lastUpdatedAt: Date | null) {
  if (!lastUpdatedAt) return "Last updated from database"
  const seconds = Math.floor((Date.now() - lastUpdatedAt.getTime()) / 1000)
  if (seconds < 5) return "Last updated just now"
  if (seconds < 60) return `Last updated ${seconds}s ago`
  return `Last updated ${Math.floor(seconds / 60)}m ago`
}
