"use client"

import { useEffect, useState } from "react"
import { readJsonResponse } from "@/lib/client/safe-json"

export type OperationView = {
  operationId: string
  kind: string
  vpsInstanceId: string
  status: "queued" | "running" | "completed" | "failed" | "timedout" | "gone"
  headline: string
  startedAt: string
  finishedAt: string | null
  percent: number | null
  phase: string | null
  transferredLabel: string | null
  totalLabel: string | null
  speedLabel: string | null
  elapsedSeconds: number
  logTail: string[]
  verified: boolean
  error: string | null
}

const TERMINAL_STATUSES = ["completed", "failed", "timedout", "gone"]

export function useOperationProgress(operationId: string | null, enabled = true) {
  const [operation, setOperation] = useState<OperationView | null>(null)

  useEffect(() => {
    if (!operationId || !enabled) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (delay: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void tick(), delay)
    }

    const tick = async () => {
      if (!active) return
      try {
        const res = await fetch(`/api/client/operations/${operationId}`, { cache: "no-store" })
        if (!active) return
        const data = await readJsonResponse<any>(res)
        if (res.status === 404) {
          setOperation((current) => current ? { ...current, status: "gone" } : current)
          return
        }
        const op = data.operation as OperationView
        setOperation(op)
        if (TERMINAL_STATUSES.includes(op.status)) return
        schedule(2000)
      } catch {
        if (!active) return
        schedule(3000)
      }
    }

    schedule(0)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [operationId, enabled])

  const operationValue = operation
  const terminal = operationValue ? TERMINAL_STATUSES.includes(operationValue.status) : false
  return { operation: operationValue, terminal }
}

export function formatElapsed(seconds?: number | null) {
  const value = Math.max(0, Number(seconds || 0))
  if (value < 60) return `${value}s`
  const m = Math.floor(value / 60)
  const s = Math.floor(value % 60)
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}