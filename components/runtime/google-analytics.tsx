"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"
import type { RuntimeConfig } from "@/lib/runtime-config"

declare global {
  interface Window {
    __ZWS_GA_ID?: string
    __ZWS_RUNTIME_CONFIG_VERSION?: number
    __ZWS_RUNTIME_ANALYTICS?: RuntimeConfig["analytics"]
    dataLayer?: unknown[]
    gtag?: (...args: any[]) => void
    fbq?: (...args: any[]) => void
    _fbq?: unknown
    $crisp?: unknown[]
    CRISP_WEBSITE_ID?: string
    Tawk_API?: Record<string, unknown>
    Tawk_LoadStart?: Date
  }
}

const runtimeConfigEvent = "runtime-config"
const managedSelector = "script[data-zws-runtime-tracking='true']"
const customSelector = "[data-zws-custom-runtime-script='true']"

function gaScriptId(gaId: string) {
  return `zws-ga-${gaId.replace(/[^a-z0-9_-]/gi, "-")}`
}

function removeManagedScripts() {
  document.querySelectorAll(managedSelector).forEach((node) => node.remove())
}

function removeCustomScripts() {
  document.querySelectorAll(customSelector).forEach((node) => node.remove())
}

function appendScript({
  id,
  src,
  text,
  target = document.head,
  async = true,
}: {
  id: string
  src?: string
  text?: string
  target?: HTMLElement
  async?: boolean
}) {
  document.getElementById(id)?.remove()
  const script = document.createElement("script")
  script.id = id
  script.dataset.zwsRuntimeTracking = "true"
  script.async = async
  if (src) script.src = src
  if (text) script.text = text
  target.appendChild(script)
  return script
}

function appendCustomHtml(id: string, html: string, target: HTMLElement) {
  document.getElementById(id)?.remove()
  if (!html.trim()) return
  const container = document.createElement("div")
  container.id = id
  container.dataset.zwsCustomRuntimeScript = "true"
  container.hidden = true
  target.appendChild(container)
  const template = document.createElement("template")
  template.innerHTML = html
  for (const node of Array.from(template.content.childNodes)) {
    if (node.nodeName.toLowerCase() !== "script") {
      container.appendChild(node.cloneNode(true))
      continue
    }
    const source = node as HTMLScriptElement
    const script = document.createElement("script")
    for (const attribute of Array.from(source.attributes)) {
      script.setAttribute(attribute.name, attribute.value)
    }
    script.dataset.zwsCustomRuntimeScript = "true"
    script.text = source.text
    container.appendChild(script)
  }
}

function disablePreviousGa(nextGaId: string) {
  const previous = String(window.__ZWS_GA_ID || "")
  if (previous && previous !== nextGaId) {
    ;(window as any)[`ga-disable-${previous}`] = true
    document.getElementById(gaScriptId(previous))?.remove()
  }
}

function configureGa(gaId: string) {
  disablePreviousGa(gaId)
  window.__ZWS_GA_ID = gaId
  window.dataLayer = window.dataLayer || []
  window.gtag = window.gtag || function gtag() {
    window.dataLayer?.push(arguments)
  }
  if (!gaId) return
  ;(window as any)[`ga-disable-${gaId}`] = false
  appendScript({
    id: gaScriptId(gaId),
    src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`,
  })
  window.gtag("js", new Date())
  window.gtag("config", gaId, { send_page_view: false })
}

function configureMetaPixel(pixelId: string) {
  if (!pixelId) return
  appendScript({
    id: "zws-meta-pixel",
    text: `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', ${JSON.stringify(pixelId)});
fbq('track', 'PageView');
`,
  })
}

function configureTawk(propertyId: string) {
  if (!propertyId) return
  const path = propertyId.includes("/") ? propertyId : `${propertyId}/default`
  window.Tawk_API = window.Tawk_API || {}
  window.Tawk_LoadStart = new Date()
  appendScript({
    id: "zws-tawk",
    src: `https://embed.tawk.to/${path}`,
  })
}

function configureCrisp(websiteId: string) {
  if (!websiteId) return
  window.$crisp = []
  window.CRISP_WEBSITE_ID = websiteId
  appendScript({
    id: "zws-crisp",
    src: "https://client.crisp.chat/l.js",
  })
}

function applyRuntimeAnalytics(analytics: RuntimeConfig["analytics"], includeOnPath: boolean) {
  window.__ZWS_RUNTIME_ANALYTICS = analytics
  window.__ZWS_RUNTIME_CONFIG_VERSION = Number(analytics.version || 0)
  removeManagedScripts()
  removeCustomScripts()
  if (!includeOnPath) return
  configureGa(String(analytics.gaId || ""))
  configureMetaPixel(String(analytics.metaPixelId || ""))
  configureTawk(String(analytics.tawkPropertyId || ""))
  configureCrisp(String(analytics.crispWebsiteId || ""))
  appendCustomHtml("zws-custom-head-script", String(analytics.customHeadScript || ""), document.head)
  appendCustomHtml("zws-custom-body-script", String(analytics.customBodyScript || ""), document.body)
  window.dispatchEvent(new CustomEvent("zws:runtime-analytics-updated", { detail: analytics }))
}

async function fetchRuntimeConfig() {
  const response = await fetch("/api/runtime/config", { cache: "no-store" })
  if (!response.ok) throw new Error("Failed to load runtime config")
  return readJsonResponse<RuntimeConfig>(response) as Promise<RuntimeConfig>
}

export function RuntimeGoogleAnalytics({
  initialConfig,
  allowAdmin = false,
}: {
  initialConfig: RuntimeConfig
  allowAdmin?: boolean
}) {
  const pathname = usePathname()
  const includeOnPath = allowAdmin || !pathname?.startsWith("/admin")
  const lastVersion = useRef<number>(0)
  const initialAnalytics = initialConfig.analytics
  const initialGaId = String(initialAnalytics.gaId || "")

  const refresh = useCallback(async () => {
    const config = await fetchRuntimeConfig()
    const version = Number(config.version || config.analytics.version || 0)
    if (version && version === lastVersion.current) return
    lastVersion.current = version
    applyRuntimeAnalytics(config.analytics, includeOnPath)
  }, [includeOnPath])

  useEffect(() => {
    lastVersion.current = Number(initialConfig.version || initialAnalytics.version || 0)
    applyRuntimeAnalytics(initialAnalytics, includeOnPath)
  }, [includeOnPath, initialAnalytics, initialConfig.version])

  useEffect(() => {
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(runtimeConfigEvent) : null
    channel?.addEventListener("message", refresh)
    const onFocus = () => refresh().catch(() => null)
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(runtimeConfigEvent, onFocus)
    return () => {
      channel?.close()
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(runtimeConfigEvent, onFocus)
    }
  }, [refresh])

  useEffect(() => {
    if (!("EventSource" in window)) return
    const source = new EventSource("/api/runtime/config/stream")
    source.addEventListener("runtime-config", () => refresh().catch(() => null))
    source.onerror = () => undefined
    return () => source.close()
  }, [refresh])

  const initialInline = useMemo(() => {
    return `
window.__ZWS_GA_ID=${JSON.stringify(initialGaId)};
window.__ZWS_RUNTIME_CONFIG_VERSION=${JSON.stringify(initialConfig.version || initialAnalytics.version || 0)};
window.__ZWS_RUNTIME_ANALYTICS=${JSON.stringify(initialAnalytics)};
window.dataLayer=window.dataLayer||[];
window.gtag=window.gtag||function(){window.dataLayer.push(arguments);};
`
  }, [initialAnalytics, initialConfig.version, initialGaId])

  if (!includeOnPath) return null

  return (
    <>
      <Script id="zws-runtime-analytics-state" strategy="afterInteractive">{initialInline}</Script>
      {initialGaId ? (
        <>
          <Script id={gaScriptId(initialGaId)} src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(initialGaId)}`} strategy="afterInteractive" data-zws-runtime-tracking="true" />
          <Script id="zws-ga-init" strategy="afterInteractive" data-zws-runtime-tracking="true">
            {`gtag('js', new Date());gtag('config', ${JSON.stringify(initialGaId)}, { send_page_view: false });`}
          </Script>
        </>
      ) : null}
    </>
  )
}
