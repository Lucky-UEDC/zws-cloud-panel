"use client"

import { useCallback, useEffect, useState } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"
import { dedupedAdminErrorToast } from "@/lib/client/admin-toast"
import { useSmartPolling } from "@/lib/hooks/use-smart-polling"

export function useAdminVmQuery<T>(input: {
  endpoint: string
  pollActive: boolean
  deps?: unknown[]
  fallbackErrorMessage?: string
  toastSilentErrors?: boolean
  initialData?: T | null
}) {
  const [data, setData] = useState<T | null>(input.initialData || null)
  const [loading, setLoading] = useState(!input.initialData)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true
    if (!silent) setLoading(true)

    try {
      const response = await fetch(input.endpoint, { cache: "no-store" })
      const payload = (await readJsonResponse<any>(response)) || {}
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || input.fallbackErrorMessage || "Unable to load admin data")
      }
      setData(payload as T)
      setError(null)
    } catch (err: any) {
      const message = err?.message || input.fallbackErrorMessage || "Unable to load admin data"
      setError(message)
      if (!silent || input.toastSilentErrors === true) {
        dedupedAdminErrorToast({ message, key: `${input.endpoint}:${message}` })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [input.endpoint, input.fallbackErrorMessage, input.toastSilentErrors])

  useEffect(() => {
    void load({ silent: false })
  }, [load])

  const { lastUpdatedAt, refresh } = useSmartPolling(
    () => load({ silent: true }),
    input.pollActive,
    [load],
  )

  const reload = useCallback(async () => {
    await load({ silent: false })
  }, [load])

  return {
    data,
    loading,
    error,
    reload,
    refresh,
    lastUpdatedAt,
  }
}
