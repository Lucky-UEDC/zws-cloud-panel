"use client"

import { useEffect, useCallback, createContext, useContext, ReactNode, Suspense, useMemo, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
    __ZWS_GA_ID?: string
  }
}

interface AnalyticsContextType {
  track: (eventName: string, properties?: Record<string, unknown>) => Promise<void>
  trackPageView: () => Promise<void>
}

const AnalyticsContext = createContext<AnalyticsContextType | null>(null)

function runtimeGaId() {
  return typeof window !== "undefined" ? window.__ZWS_GA_ID : ""
}

export function trackGaEvent(eventName: string, properties: Record<string, unknown> = {}) {
  const gaId = runtimeGaId()
  if (!gaId || typeof window === "undefined" || typeof window.gtag !== "function") return
  window.gtag("event", eventName, properties)
}

function trackGaPageView(pagePath: string) {
  const gaId = runtimeGaId()
  if (!gaId || typeof window === "undefined" || typeof window.gtag !== "function") return
  window.gtag("config", gaId, { page_path: pagePath })
}

export function useAnalytics() {
  const context = useContext(AnalyticsContext)
  if (!context) {
    throw new Error("useAnalytics must be used within AnalyticsProvider")
  }
  return context
}

interface AnalyticsProviderProps {
  children: ReactNode
}

function AnalyticsProviderInner({ children }: AnalyticsProviderProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastTrackedPagePath = useRef("")
  const pagePath = useMemo(() => {
    const query = searchParams.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])

  const track = useCallback(async (eventName: string, properties: Record<string, unknown> = {}) => {
    trackGaEvent(eventName, properties)
    try {
      await fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "custom",
          event_name: eventName,
          properties: {
            ...properties,
            page_path: pagePath,
            timestamp: new Date().toISOString(),
          },
        }),
      })
    } catch {
      // Silent fail - analytics should not break UX
    }
  }, [pagePath])

  const trackPageView = useCallback(async () => {
    if (lastTrackedPagePath.current === pagePath) return
    lastTrackedPagePath.current = pagePath
    trackGaPageView(pagePath)
    try {
      await fetch("/api/analytics/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "page_view",
          event_name: "page_view",
          properties: {
            page_path: pagePath,
            search_params: Object.fromEntries(searchParams.entries()),
            timestamp: new Date().toISOString(),
          },
        }),
      })
    } catch {
      // Silent fail
    }
  }, [pagePath, searchParams])

  // Track page views on route changes
  useEffect(() => {
    trackPageView()
  }, [trackPageView])

  return (
    <AnalyticsContext.Provider value={{ track, trackPageView }}>
      {children}
    </AnalyticsContext.Provider>
  )
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  return (
    <Suspense fallback={null}>
      <AnalyticsProviderInner>{children}</AnalyticsProviderInner>
    </Suspense>
  )
}
