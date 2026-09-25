"use client"

import { useEffect, useId, useRef, useState } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"

declare global {
  interface Window {
    turnstile?: {
      render: (target: string | HTMLElement, options: Record<string, unknown>) => string
      execute?: (id?: string) => void
      reset: (id?: string) => void
      remove: (id?: string) => void
    }
  }
}

export type TurnstileMode = "managed" | "invisible" | "non_interactive"
export type TurnstileSurface = "login" | "signup" | "register" | "forgotPassword" | "contact" | "checkout" | "tickets" | "support" | "orders" | "adminLogin"
type TurnstileProtectionFlags = Record<TurnstileSurface, boolean>

type TurnstileConfig = {
  enabled: boolean
  siteKey: string
  mode: TurnstileMode
  protect: TurnstileProtectionFlags
  loading: boolean
}

export function useTurnstileConfig(): TurnstileConfig {
  const [config, setConfig] = useState<TurnstileConfig>({
    enabled: false,
    siteKey: "",
    mode: "managed",
    protect: {
      login: true,
      signup: true,
      register: true,
      forgotPassword: true,
      contact: true,
      checkout: true,
      tickets: true,
      support: true,
      orders: true,
      adminLogin: true,
    },
    loading: true,
  })

  useEffect(() => {
    let cancelled = false
    fetch("/api/security/turnstile/config", { cache: "no-store" })
      .then(async (response) => {
        const data = await readJsonResponse<{ enabled?: boolean; siteKey?: string; mode?: TurnstileMode; protect?: Partial<TurnstileProtectionFlags> }>(response)
        if (!cancelled) {
          const register = data?.protect?.register ?? data?.protect?.signup
          const support = data?.protect?.support ?? data?.protect?.tickets
          setConfig({
            enabled: Boolean(response.ok && data?.enabled && data?.siteKey),
            siteKey: response.ok ? String(data?.siteKey || "") : "",
            mode: data?.mode === "invisible" || data?.mode === "non_interactive" ? data.mode : "managed",
            protect: {
              login: data?.protect?.login !== false,
              signup: register !== false,
              register: register !== false,
              forgotPassword: data?.protect?.forgotPassword !== false,
              contact: data?.protect?.contact !== false,
              checkout: data?.protect?.checkout !== false,
              tickets: support !== false,
              support: support !== false,
              orders: data?.protect?.orders !== false,
              adminLogin: data?.protect?.adminLogin !== false,
            },
            loading: false,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({
            enabled: false,
            siteKey: "",
            mode: "managed",
            protect: {
              login: true,
              signup: true,
              register: true,
              forgotPassword: true,
              contact: true,
              checkout: true,
              tickets: true,
              support: true,
              orders: true,
              adminLogin: true,
            },
            loading: false,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}

export function TurnstileWidget({
  value,
  onChange,
  action,
  enabled,
  siteKey,
  mode,
  surface,
  resetKey,
}: {
  value?: string
  onChange: (token: string) => void
  action?: string
  enabled?: boolean
  siteKey?: string
  mode?: TurnstileMode
  surface?: TurnstileSurface
  resetKey?: string | number
}) {
  const config = useTurnstileConfig()
  const surfaceProtected = surface ? config.protect[surface] !== false : true
  const active = enabled ?? (config.enabled && surfaceProtected)
  const activeSiteKey = siteKey ?? config.siteKey
  const activeMode = mode ?? config.mode
  const id = useId().replace(/:/g, "")
  const widgetRef = useRef<string>("")

  useEffect(() => {
    if (!active || !activeSiteKey) {
      onChange("")
      return
    }
    let cancelled = false
    let timer: number | undefined
    const render = () => {
      if (cancelled || !window.turnstile || widgetRef.current) return
      const renderOptions: Record<string, unknown> = {
        sitekey: activeSiteKey,
        action: action || "form",
        callback: (token: string) => onChange(token),
        "expired-callback": () => onChange(""),
        "error-callback": () => onChange(""),
      }
      if (activeMode === "invisible") {
        renderOptions.appearance = "execute"
        renderOptions.execution = "execute"
      } else if (activeMode === "non_interactive") {
        renderOptions.appearance = "always"
        renderOptions.execution = "render"
        renderOptions.theme = "auto"
      }
      widgetRef.current = window.turnstile.render(`#${id}`, {
        ...renderOptions,
      })
      if (activeMode === "invisible") window.turnstile.execute?.(widgetRef.current)
    }

    if (!document.querySelector('script[data-zws-turnstile="true"]')) {
      const script = document.createElement("script")
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
      script.async = true
      script.defer = true
      script.dataset.zwsTurnstile = "true"
      script.onload = render
      document.head.appendChild(script)
    } else {
      timer = window.setInterval(() => {
        if (window.turnstile) {
          if (timer !== undefined) window.clearInterval(timer)
          render()
        }
      }, 100)
    }

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      if (widgetRef.current && window.turnstile) {
        window.turnstile.remove(widgetRef.current)
        widgetRef.current = ""
      }
    }
  }, [action, active, activeMode, activeSiteKey, id, onChange, resetKey])

  if (!active || !activeSiteKey) return null
  return <div id={id} data-mode={activeMode} data-token-present={value ? "true" : "false"} />
}
