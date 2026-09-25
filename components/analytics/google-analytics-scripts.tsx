"use client"

import Script from "next/script"
import { usePathname } from "next/navigation"

declare global {
  interface Window {
    __ZWS_GA_ID?: string
  }
}

export function GoogleAnalyticsScripts({
  enabled,
  measurementId,
  allowAdmin,
}: {
  enabled: boolean
  measurementId?: string | null
  allowAdmin?: boolean
}) {
  const pathname = usePathname()
  const gaId = String(measurementId || "").trim()
  if (!enabled || !gaId) return null
  if (pathname?.startsWith("/admin") && !allowAdmin) return null

  return (
    <>
      <Script id="zws-ga-runtime-id" strategy="afterInteractive">{`window.__ZWS_GA_ID=${JSON.stringify(gaId)};`}</Script>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive" />
      <Script id="zws-ga-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('js', new Date());
gtag('config', ${JSON.stringify(gaId)}, { send_page_view: false });
`}
      </Script>
    </>
  )
}
